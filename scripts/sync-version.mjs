import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertVersionAdvance, parseArgs, validateVersionFile } from './release/common.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// 版本同步保留原命令，同时提供发布前的显式首次初始化/递增检查。
const options = parseArgs(process.argv.slice(2), ['published-android', 'published-tauri'], ['write', 'check', 'first-release', 'require-published'])
const writeMode = Boolean(options.write)
const checkMode = Boolean(options.check)

if (writeMode === checkMode) {
  throw new Error('请使用 --write 或 --check 其中一个参数。')
}

const versionFile = await readJson('release-version.json')
validateVersionFile(versionFile)
if (options['first-release'] || options['require-published'] || options['published-android'] || options['published-tauri']) {
  assertVersionAdvance(versionFile,
    options['published-android'] ? await readJson(options['published-android']) : null,
    options['published-tauri'] ? await readJson(options['published-tauri']) : null, options['first-release'])
}

const packageJson = await readJson('package.json')
const packageLock = await readJson('package-lock.json')
const tauriConfig = await readJson('src-tauri/tauri.conf.json')
const androidBuild = await readText('android/app/build.gradle')
const cargoToml = await readText('src-tauri/Cargo.toml')
const cargoLock = await readText('src-tauri/Cargo.lock')

packageJson.version = versionFile.productVersion
packageLock.version = versionFile.productVersion
if (packageLock.packages?.['']) packageLock.packages[''].version = versionFile.productVersion
tauriConfig.version = versionFile.desktop.version

const nextAndroidBuild = androidBuild
  .replace(/versionCode\s+\d+/, `versionCode ${versionFile.android.versionCode}`)
  .replace(/versionName\s+"[^"]+"/, `versionName "${versionFile.android.versionName}"`)

// 只同步应用自有 Rust 包，不触碰 updater 或其他锁定依赖版本。
const nextCargoToml = cargoToml.replace(/(\[package\][\s\S]*?\nversion\s*=\s*)"[^"]+"/, `$1"${versionFile.desktop.version}"`)
const ownPackage = /(\[\[package\]\]\r?\nname = "zhiwellcare-app"\r?\nversion = )"[^"]+"/
if (!ownPackage.test(cargoLock)) throw new Error('Cargo.lock 缺少 zhiwellcare-app 自有包。')
const nextCargoLock = cargoLock.replace(ownPackage, `$1"${versionFile.desktop.version}"`)

const targets = [
  ['package.json', `${JSON.stringify(packageJson, null, 2)}\n`],
  ['package-lock.json', `${JSON.stringify(packageLock, null, 2)}\n`],
  ['src-tauri/tauri.conf.json', `${JSON.stringify(tauriConfig, null, 2)}\n`],
  ['android/app/build.gradle', nextAndroidBuild],
  ['src-tauri/Cargo.toml', nextCargoToml],
  ['src-tauri/Cargo.lock', nextCargoLock],
]

const drifted = []
for (const [path, expected] of targets) {
  const current = await readText(path)
  // Git 在 Windows 新工作树会转换为 CRLF，换行差异不属于版本漂移。
  if (current.replace(/\r\n/g, '\n') === expected.replace(/\r\n/g, '\n')) continue
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
