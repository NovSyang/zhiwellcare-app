import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { isMain, parseArgs, readJson, requireArgs, root, validateAssetUrl, validatePublishedAt, validateVersionFile, writeJson } from './release/common.mjs'
import { verifyWindows } from './release/check-inputs.mjs'

/** EXE 的最终字节及对应 updater 签名通过验证后，才允许建立公开清单。 */
export async function generateTauriManifest(options) {
  requireArgs(options, ['artifact', 'signature', 'artifact-url', 'version-file', 'notes', 'published-at', 'output'])
  const release = validateVersionFile(await readJson(options['version-file']))
  const config = await readJson(options.config ?? 'release-config.json')
  const signing = await readJson(options.signing ?? 'release-signing.json')
  validateAssetUrl(options['artifact-url'], config, { version: release.productVersion, channel: options.channel ?? config.defaultChannel, platform: 'windows' })
  validatePublishedAt(options['published-at'])
  const verified = await verifyWindows(resolve(root, options.artifact), resolve(root, options.signature), release, signing)
  const manifest = {
    version: release.productVersion, notes: (await readFile(resolve(root, options.notes), 'utf8')).trim(),
    pub_date: options['published-at'],
    platforms: { 'windows-x86_64': { url: options['artifact-url'], signature: verified.signature } },
  }
  await writeJson(resolve(root, options.output), manifest)
  return manifest
}

if (isMain(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2), ['artifact', 'signature', 'artifact-url', 'version-file', 'notes', 'published-at', 'output', 'config', 'signing', 'channel'])
  await generateTauriManifest(options)
  console.log('Tauri 更新清单已由最终验签产物生成。')
}
