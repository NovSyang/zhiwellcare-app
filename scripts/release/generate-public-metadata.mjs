import { readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { hashFile, isMain, parseArgs, readJson, requireArgs, root, validateVersionFile, writeJson } from './common.mjs'
import { validateManifests } from './verify-published-assets.mjs'

/** 汇总两端及签名摘要，避免某个生成器覆盖另一端的 SHA256SUMS。 */
export async function generatePublicMetadata(options) {
  requireArgs(options, ['channel', 'public-dir', 'artifacts-dir', 'notes'])
  if (!['stable', 'staging'].includes(options.channel)) throw new Error('未知发布通道。')
  const release = validateVersionFile(await readJson(options['version-file'] ?? 'release-version.json'))
  const config = await readJson(options.config ?? 'release-config.json')
  const publicDir = resolve(root, options['public-dir'])
  const android = await readJson(resolve(publicDir, 'android-latest.json'))
  const tauri = await readJson(resolve(publicDir, 'latest.json'))
  const windows = validateManifests(android, tauri, release, config, options.channel)
  const names = [android.apk.url, windows.url].map((url) => decodeURIComponent(new URL(url).pathname.split('/').at(-1)))
  names.push(`${names[1]}.sig`)
  const assets = []
  for (const name of names) {
    if (basename(name) !== name || /[\\/\r\n]/.test(name)) throw new Error('附件文件名无效。')
    assets.push({ name, ...await hashFile(resolve(root, options['artifacts-dir'], name)) })
  }
  if (assets[0].sha256 !== android.apk.sha256 || assets[0].size !== android.apk.size) throw new Error('APK 摘要与最终清单不一致。')
  if ((await readFile(resolve(root, options['artifacts-dir'], names[2]), 'utf8')).trim() !== windows.signature) throw new Error('签名文件与清单不同。')
  await writeFile(resolve(publicDir, 'release-notes.md'), await readFile(resolve(root, options.notes), 'utf8'), 'utf8')
  await writeFile(resolve(publicDir, 'SHA256SUMS.txt'), assets.map(({ name, sha256 }) => `${sha256}  ${name}\n`).join(''), 'utf8')
  const info = { schemaVersion: 1, channel: options.channel, version: release.productVersion, displayVersion: release.displayVersion, versionCode: release.android.versionCode, publishedAt: android.publishedAt, assets }
  await writeJson(resolve(publicDir, 'release-info.json'), info)
  return info
}

if (isMain(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2), ['channel', 'public-dir', 'artifacts-dir', 'notes', 'version-file', 'config'])
  console.log(JSON.stringify(await generatePublicMetadata(options), null, 2))
}
