import { assertVersionAdvance, isMain, parseArgs, readJson, validateReleaseConfig, validateVersionFile } from './common.mjs'
import { anonymousGet } from './verify-published-assets.mjs'

/** 网络失败、403 和验证码不能当成空仓库，首次初始化也须明确指定。 */
export async function checkPublishedVersion(options) {
  const channel = options.channel ?? 'stable'
  const config = validateReleaseConfig(await readJson(options.config ?? 'release-config.json'))
  const release = validateVersionFile(await readJson(options['version-file'] ?? 'release-version.json'))
  if (!['stable', 'staging'].includes(channel)) throw new Error('未知发布通道。')
  const urls = [config.channels[channel].androidManifestUrl, config.channels[channel].tauriManifestUrl]
  const manifests = []
  for (const url of urls) {
    try {
      const response = await anonymousGet(url, { allowedHosts: config.allowedDownloadHosts ?? ['gitee.com'], maxBytes: 1024 * 1024 })
      manifests.push(JSON.parse(response.bytes.toString('utf8')))
    } catch (error) {
      if (options['first-release'] && error.message === '远端匿名 GET 失败：HTTP 404。') manifests.push(null)
      else throw error
    }
  }
  if (options['first-release'] && manifests.some(Boolean)) throw new Error('通道已存在清单，禁止使用首次初始化模式覆盖。')
  assertVersionAdvance(release, manifests[0], manifests[1], options['first-release'])
  return { passed: true, channel, version: release.productVersion, firstRelease: Boolean(options['first-release']) }
}

if (isMain(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2), ['channel', 'config', 'version-file'], ['first-release'])
  console.log(JSON.stringify(await checkPublishedVersion(options), null, 2))
}
