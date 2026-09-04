import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const writeMode = process.argv.includes('--write')
const checkMode = process.argv.includes('--check')

if (writeMode === checkMode) {
  throw new Error('请使用 --write 或 --check 其中一个参数。')
}

const versionFile = await readJson('release-version.json')
validateVersionFile(versionFile)

const packageJson = await readJson('package.json')
const packageLock = await readJson('package-lock.json')
const tauriConfig = await readJson('src-tauri/tauri.conf.json')
const androidBuild = await readText('android/app/build.gradle')

packageJson.version = versionFile.productVersion
packageLock.version = versionFile.productVersion
if (packageLock.packages?.['']) packageLock.packages[''].version = versionFile.productVersion
tauriConfig.version = versionFile.desktop.version

const nextAndroidBuild = androidBuild
  .replace(/versionCode\s+\d+/, `versionCode ${versionFile.android.versionCode}`)
  .replace(/versionName\s+"[^"]+"/, `versionName "${versionFile.android.versionName}"`)

const targets = [
  ['package.json', `${JSON.stringify(packageJson, null, 2)}\n`],
  ['package-lock.json', `${JSON.stringify(packageLock, null, 2)}\n`],
  ['src-tauri/tauri.conf.json', `${JSON.stringify(tauriConfig, null, 2)}\n`],
  ['android/app/build.gradle', nextAndroidBuild],
]

const drifted = []
for (const [path, expected] of targets) {
  const current = await readText(path)
  if (current === expected) continue
  if (writeMode) await writeFile(resolve(root, path), expected, 'utf8')
  else drifted.push(path)
}

if (drifted.length > 0) {
  throw new Error(`版本配置不一致，请先执行 npm run version:sync：${drifted.join(', ')}`)
}

console.log(writeMode ? `版本已同步为 ${versionFile.productVersion}` : `版本配置一致：${versionFile.productVersion}`)

async function readText(path) {
  return readFile(resolve(root, path), 'utf8')
}

async function readJson(path) {
  return JSON.parse(await readText(path))
}

/** 发布版本只接受三段 SemVer，Android code 必须是永久递增的正整数。 */
function validateVersionFile(value) {
  const semver = /^\d+\.\d+\.\d+$/
  if (value?.schemaVersion !== 1
    || !semver.test(value.productVersion)
    || !semver.test(value.desktop?.version)
    || !semver.test(value.android?.versionName)
    || typeof value.displayVersion !== 'string'
    || !Number.isInteger(value.android?.versionCode)
    || value.android.versionCode <= 0) {
    throw new Error('release-version.json 格式无效。')
  }
  if (value.productVersion !== value.desktop.version || value.productVersion !== value.android.versionName) {
    throw new Error('Product、Desktop 与 Android versionName 必须保持一致。')
  }
}
