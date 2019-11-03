const temp = require('temp')
const fs = require('fs')
const path = require('path')
const childProcess = require('child_process')
const GitHubApi = require('github')
const request = require('request')
const rootPackageJson = require('../package.json')

const github = new GitHubApi({
  // debug: true,
  headers: { 'User-Agent': 'electron-npm-publisher' },
  followRedirects: false
})

let tempDir
temp.track()   // track and cleanup files at exit

const files = [
  'cli.js',
  'index.js',
  'install.js',
  'package.json',
  'README.md',
  'LICENSE'
]

const jsonFields = [
  'name',
  'version',
  'repository',
  'description',
  'license',
  'author',
  'keywords'
]

let npmTag = 'latest'

new Promise((resolve, reject) => {
  console.log('cleaning temporary directory')
  temp.mkdir('electron-npm', (err, dirPath) => {
    if (err) {
      reject(err)
    } else {
      resolve(dirPath)
    }
  })
})
.then((dirPath) => {
  console.log('copying files to the temp directory')
  tempDir = dirPath
  files.forEach((name) => {
    const noThirdSegment = name === 'README.md' || name === 'LICENSE'
    fs.writeFileSync(
      path.join(tempDir, name),
      fs.readFileSync(path.join(__dirname, '..', noThirdSegment ? '' : 'npm', name))
    )
  })
  // copy from root package.json to temp/package.json
  const packageJson = require(path.join(tempDir, 'package.json'))
  jsonFields.forEach((fieldName) => {
    packageJson[fieldName] = rootPackageJson[fieldName]
  })
  fs.writeFileSync(
    path.join(tempDir, 'package.json'),
    JSON.stringify(packageJson, null, 2)
  )

  console.log('getting the releases from GitHub')
  return github.repos.getReleases({
    owner: 'postmanlabs',
    repo: 'electron'
  })
})
.then((releases) => {
  // download electron.d.ts from release
  const release = releases.data.find(
    (release) => release.tag_name === `v${rootPackageJson.version}`
  )
  if (!release) {
    throw new Error(`cannot find release with tag v${rootPackageJson.version}`)
  }
  return release
})
.then((release) => {
  console.log('downloading electron.d.ts from the release from GitHub')
  const tsdAsset = release.assets.find((asset) => asset.name === 'electron.d.ts')
  if (!tsdAsset) {
    throw new Error(`cannot find electron.d.ts from v${rootPackageJson.version} release assets`)
  }
  return new Promise((resolve, reject) => {
    request.get({
      url: tsdAsset.url,
      headers: {
        'accept': 'application/octet-stream',
        'user-agent': 'electron-npm-publisher'
      }
    }, (err, response, body) => {
      if (err || response.statusCode !== 200) {
        reject(err || new Error('Cannot download electron.d.ts'))
      } else {
        fs.writeFileSync(path.join(tempDir, 'electron.d.ts'), body)
        resolve(release)
      }
    })
  })
})
.then(() => {
  console.log('running npm pack')
  childProcess.execSync('npm pack', { cwd: tempDir })
})
.then(() => {
  console.log('testing that the package can install electron prebuilt from github release')
  const sanitizedPackageName = rootPackageJson.name.replace(/\//g, '-').replace(/@/g, '')
  const tarballPath = path.join(tempDir, `${sanitizedPackageName}-${rootPackageJson.version}.tgz`)
  return new Promise((resolve, reject) => {
    childProcess.execSync(`npm install ${tarballPath} --force --silent`, {
      env: Object.assign({}, process.env, { electron_config_cache: tempDir }),
      cwd: tempDir
    })
    resolve(tarballPath)
  })
})
.then((tarballPath) => {
  console.log('running npm publish')
  childProcess.execSync(`npm publish ${tarballPath} --tag ${npmTag}`)
})
.catch((err) => {
  console.error(`Error: ${err}`)
  process.exit(1)
})
