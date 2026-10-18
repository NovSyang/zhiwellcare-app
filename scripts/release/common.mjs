import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

/** 参数必须显式声明，避免拼错参数后悄悄使用默认值。 */
export function parseArgs(args, valueNames, flagNames = []) {
  const result = {}
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index]
    if (!key?.startsWith('--') || Object.hasOwn(result, key.slice(2))) throw new Error(`发布参数无效或重复：${key}`)
    const name = key.slice(2)
    if (flagNames.includes(name)) result[name] = true
    else if (valueNames.includes(name) && args[index + 1] && !args[index + 1].startsWith('--')) result[name] = args[++index]
    else throw new Error(`未知参数或缺少值：${key}`)
  }
  return result
}

export function requireArgs(options, names) {
  for (const name of names) if (!options[name]) throw new Error(`缺少参数：--${name}`)
}

export async function readJson(path) {
  return JSON.parse((await readFile(resolve(root, path), 'utf8')).replace(/^\uFEFF/, ''))
}

export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export async function exists(path) {
  try { await access(path); return true } catch { return false }
}

/** 发布版本使用整数分段比较，禁止浮点数造成 0.10 与 0.2 比较错误。 */
export function compareVersions(left, right) {
  if (!semverPattern.test(left) || !semverPattern.test(right)) throw new Error('版本必须是合法三段 SemVer。')
  const a = left.split('.').map(BigInt)
  const b = right.split('.').map(BigInt)
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1
  return 0
}

export function validateVersionFile(value) {
  if (value?.schemaVersion !== 1 || !semverPattern.test(value.productVersion)
    || value.desktop?.version !== value.productVersion || value.android?.versionName !== value.productVersion
    || !Number.isSafeInteger(value.android?.versionCode) || value.android.versionCode < 1 || value.android.versionCode > 2100000000
    || typeof value.displayVersion !== 'string' || !/^\d+\.\d+(?:\.\d+)?$/.test(value.displayVersion)) {
    throw new Error('release-version.json 格式无效，平台版本必须一致。')
  }
  const expected = value.productVersion.endsWith('.0') ? value.productVersion.slice(0, -2) : value.productVersion
  if (value.displayVersion !== expected) throw new Error(`显示版本应为 ${expected}，不含 V。`)
  return value
}

export function assertVersionAdvance(release, publishedAndroid, publishedTauri, firstRelease = false) {
  validateVersionFile(release)
  if (firstRelease) {
    if (publishedAndroid || publishedTauri) throw new Error('首次发布模式不能同时传入已发布清单。')
    if (release.productVersion !== '0.1.0' || release.android.versionCode !== 1) throw new Error('首次 stable 发布必须是 0.1.0 / code 1。')
    return
  }
  if (!publishedAndroid || !publishedTauri) throw new Error('必须取得两端已发布清单；网络失败不能视为首次发布。')
  if (!Number.isSafeInteger(publishedAndroid.versionCode) || publishedAndroid.versionCode < 1
    || compareVersions(publishedAndroid.version, publishedTauri.version) !== 0) throw new Error('两端已发布版本无效或不一致。')
  if (release.android.versionCode <= publishedAndroid.versionCode || compareVersions(release.productVersion, publishedTauri.version) <= 0) {
    throw new Error('新版本及 Android versionCode 必须严格高于已发布版本。')
  }
}

export function validatePublishedAt(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || !Number.isFinite(Date.parse(value))) throw new Error('发布时间必须是有效 RFC3339 时间。')
  return value
}

export function validateSigning(signing) {
  if (signing?.schemaVersion !== 1 || signing.android?.applicationId !== 'com.zhiwellcare.app'
    || signing.android.keyAlias !== 'zhiwellcare' || signing.android.keyStoreType !== 'PKCS12'
    || signing.android.certificateMd5?.toLowerCase() !== '4ee1e429da8e011eb75b49ebdb03b6a4'
    || signing.android.certificateSha1?.toLowerCase() !== 'e3f49e91e89d0e84ae8029b490860c0e64d5d6f1'
    || !/^[a-f\d]{64}$/i.test(signing.android.certificateSha256 ?? '')
    || /^0+$/.test(signing.android.certificateSha256)
    || typeof signing.tauri?.publicKey !== 'string' || !/^[A-Za-z\d+/=]+$/.test(signing.tauri.publicKey)
    ) throw new Error('公开签名配置缺失、格式错误或仍有占位值。')
  const publicKeyText = Buffer.from(signing.tauri.publicKey, 'base64').toString('utf8').trim().split(/\r?\n/)
  const key = Buffer.from(publicKeyText[1] ?? '', 'base64')
  if (publicKeyText.length !== 2 || !publicKeyText[0].startsWith('untrusted comment:') || key.length !== 42
    || key.subarray(0, 2).toString('ascii') !== 'Ed' || key.subarray(10).every((byte) => byte === 0)) throw new Error('Tauri 公钥不是有效 Minisign 公共身份。')
  return signing
}

/** 只接受公开仓库的长期下载路由，不保存临时 CDN 地址或访问凭据。 */
export function validateReleaseConfig(config) {
  if (config?.schemaVersion !== 1 || config.publishRepository !== 'https://gitee.com/Syang03/zhiwell-care.git'
    || config.publishBranch !== 'main' || !['stable', 'staging'].includes(config.defaultChannel)
    || !Array.isArray(config.allowedDownloadHosts) || !config.allowedDownloadHosts.includes('gitee.com')
    || config.allowedDownloadHosts.some((host) => typeof host !== 'string' || !/^[a-z\d.-]+$/i.test(host))) throw new Error('公开发布仓库配置无效。')
  for (const channel of ['stable', 'staging']) {
    const prefix = `https://gitee.com/Syang03/zhiwell-care/raw/main/channels/${channel}/`
    if (config.channels?.[channel]?.androidManifestUrl !== `${prefix}android-latest.json`
      || config.channels?.[channel]?.tauriManifestUrl !== `${prefix}latest.json`) throw new Error('通道清单地址与指定公开仓库不一致。')
  }
  // 额外下载路由也必须经过配置校验，不能直接把任意字符串当成可信前缀。
  assetUrlPrefixes(config)
  return config
}

export function validateAssetUrl(value, config, identity) {
  const url = permanentAssetUrl(value)
  validateReleaseConfig(config)
  // URL 会先规范化 ../ 和编码的点段；只比较规范化后的 origin/path，避免字符串前缀绕过。
  const prefix = assetUrlPrefixes(config).find((entry) => url.origin === entry.origin && url.pathname.startsWith(entry.pathname))
  if (!prefix) throw new Error('安装包 URL 不属于公开配置批准的发布仓库。')
  const pieces = url.pathname.slice(prefix.pathname.length).split('/')
  // 附件路由只接受 tag/file 两段；逐段解码后拒绝分隔符和双重编码。
  if (pieces.length !== 2) throw new Error('安装包附件路由必须只有标签和文件名两段。')
  const [tag, filename] = pieces.map(assetPathSegment)
  if (identity) {
    const { version, channel = 'stable', platform } = identity
    if (!semverPattern.test(version) || !['stable', 'staging'].includes(channel) || !['android', 'windows', 'signature'].includes(platform)) throw new Error('附件版本/通道身份无效。')
    const suffix = platform === 'android' ? 'android.apk' : platform === 'windows' ? 'windows-x64-setup.exe' : 'windows-x64-setup.exe.sig'
    if (channel === 'stable' && (tag !== `v${version}` || filename !== `ZhiWellCare-${version}-${suffix}`)) throw new Error('stable 附件标签/文件名必须与本次版本完全一致。')
    // staging 文件名与 release.ps1 输出保持一致，运行标识不能为空或混入其它路径。
    if (channel === 'staging' && (!tag.startsWith(`test-v${version}-`) || !/^[A-Za-z\d-]+$/.test(tag.slice(`test-v${version}-`.length))
      || filename !== `ZhiWellCare-${version}-staging-${suffix}`)) throw new Error('staging 附件必须带本次版本、测试标签与 staging 标识。')
  }
  return url
}

/** 永久附件地址不含认证、查询串、片段、特殊端口或容易被不同解析器解释的字符。 */
function permanentAssetUrl(value) {
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f\\]/.test(value)) throw new Error('安装包 URL 格式无效。')
  let url
  try { url = new URL(value) } catch { throw new Error('安装包 URL 格式无效。') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.port) throw new Error('安装包 URL 必须是无凭据的永久 HTTPS 地址。')
  return url
}

/** 解码后的单段不能再变成路径，防止服务端二次解码把附件跳到其它仓库。 */
function assetPathSegment(value) {
  let decoded
  try { decoded = decodeURIComponent(value) } catch { throw new Error('安装包附件路径编码无效。') }
  if (!/^[A-Za-z\d._-]+$/.test(decoded) || decoded === '.' || decoded === '..') throw new Error('安装包附件路径段无效。')
  return decoded
}

/** 默认路由固定在用户仓库；额外 CDN 路由需要同时配置主机和明确的目录边界。 */
function assetUrlPrefixes(config) {
  const repository = new URL(config.publishRepository.replace(/\.git$/, ''))
  const primary = new URL(`${repository.pathname}/releases/download/`, repository.origin)
  const extras = config.approvedAssetUrlPrefixes
  if (extras !== undefined && !Array.isArray(extras)) throw new Error('批准的附件路由必须是 URL 数组。')
  const allowedHosts = config.allowedDownloadHosts.map((host) => host.toLowerCase())
  const result = [primary]
  for (const value of extras ?? []) {
    const prefix = permanentAssetUrl(value)
    if (prefix.href !== value || !prefix.pathname.endsWith('/') || prefix.pathname === '/'
      || !allowedHosts.includes(prefix.hostname)) throw new Error('批准的附件路由必须是白名单主机上的规范目录 URL。')
    prefix.pathname.slice(1, -1).split('/').forEach(assetPathSegment)
    // Gitee 的扩展项不能扩大到其他仓库；其他主机必须经过上面的显式批准。
    if (prefix.origin === repository.origin && prefix.pathname !== primary.pathname) throw new Error('Gitee 附件路由只能使用指定发布仓库。')
    result.push(prefix)
  }
  return result
}

/** 大文件按流计算摘要，避免将整个 APK/EXE 读入内存。 */
export async function hashFile(path) {
  const info = await stat(path)
  if (!info.isFile() || info.size <= 0) throw new Error(`产物为空或不是文件：${path}`)
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return { size: info.size, sha256: hash.digest('hex') }
}

export function isMain(url) {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(url)
}
