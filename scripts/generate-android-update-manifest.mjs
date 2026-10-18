import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { hashFile, isMain, parseArgs, readJson, requireArgs, root, validateAssetUrl, validatePublishedAt, validateVersionFile, writeJson } from './release/common.mjs'
import { verifyApk } from './release/check-inputs.mjs'

/** 清单必须来自最终验签 APK，摘要列表由两端完成后的聚合步骤统一生成。 */
export async function generateAndroidManifest(options) {
  requireArgs(options, ['apk', 'apk-url', 'version-file', 'notes', 'published-at', 'output'])
  const release = validateVersionFile(await readJson(options['version-file']))
  const config = await readJson(options.config ?? 'release-config.json')
  const signing = await readJson(options.signing ?? 'release-signing.json')
  validateAssetUrl(options['apk-url'], config, { version: release.productVersion, channel: options.channel ?? config.defaultChannel, platform: 'android' })
  validatePublishedAt(options['published-at'])
  const apk = resolve(root, options.apk)
  await verifyApk(apk, release, signing)
  const digest = await hashFile(apk)
  const notes = (await readFile(resolve(root, options.notes), 'utf8')).split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const manifest = {
    schemaVersion: 1, version: release.productVersion, displayVersion: release.displayVersion,
    versionCode: release.android.versionCode, publishedAt: options['published-at'], notes,
    apk: { url: options['apk-url'], ...digest },
  }
  await writeJson(resolve(root, options.output), manifest)
  return manifest
}

if (isMain(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2), ['apk', 'apk-url', 'version-file', 'notes', 'published-at', 'output', 'config', 'signing', 'channel'])
  await generateAndroidManifest(options)
  console.log('Android 更新清单已由最终验签产物生成。')
}
