import { createHash } from 'node:crypto'
import { mkdtemp, open, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { hashFile, isMain, parseArgs, readJson, requireArgs, root, semverPattern, validateAssetUrl, validatePublishedAt, validateReleaseConfig, validateSigning, validateVersionFile, writeJson } from './common.mjs'
import { verifyApk, verifyWindows } from './check-inputs.mjs'

/** 每个跳转都重新检查 HTTPS/凭据/主机，匿名客户端不携带登录态。 */
export async function anonymousGet(url, { allowedHosts = ['gitee.com'], maxBytes, timeoutMs = 15000, output, fetcher = globalThis.fetch, openFile = open } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('匿名下载必须明确设置正整数大小上限。')
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647) throw new Error('匿名下载超时必须是有效的正整数毫秒数。')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const visited = new Set()
  let current = url
  let handle
  let body
  let ownsOutput = false
  let completed = false
  try {
    for (let redirect = 0; redirect <= 5; redirect += 1) {
      const target = new URL(current)
      if (target.protocol !== 'https:' || target.username || target.password || !allowedHosts.includes(target.hostname)) throw new Error('远端跳转违反 HTTPS、匿名访问或下载主机白名单。')
      if (visited.has(target.href)) throw new Error('远端重定向循环。')
      visited.add(target.href)
      const response = await fetcher(target.href, { redirect: 'manual', credentials: 'omit', signal: controller.signal, headers: { Accept: output ? 'application/octet-stream' : 'application/json', 'Cache-Control': 'no-cache' } })
      // 从响应到达起就记录正文，文件创建或元数据检查失败也必须回收连接。
      body = response.body
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await cancelBody(body)
        body = null
        const location = response.headers.get('location')
        if (!location || redirect === 5) throw new Error('远端跳转缺少地址或超过上限。')
        current = new URL(location, target).href
        continue
      }
      if (!response.ok) throw new Error(`远端匿名 GET 失败：HTTP ${response.status}。`)
      const length = response.headers.get('content-length')
      if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new Error('远端响应大小超限。')
      const type = response.headers.get('content-type') ?? ''
      if (/text\/html/i.test(type)) throw new Error('远端返回 HTML，可能需要登录或验证码。')
      if (!body) throw new Error('远端响应缺少正文。')
      if (output) {
        handle = await openFile(output, 'wx')
        ownsOutput = true
      }
      const chunks = []
      const digest = createHash('sha256')
      let size = 0
      for await (const chunk of body) {
        const bytes = Buffer.from(chunk)
        size += bytes.length
        if (size > maxBytes) throw new Error('远端响应大小超限。')
        digest.update(bytes)
        if (handle) await writeAllBytes(handle, bytes)
        else chunks.push(bytes)
      }
      await handle?.close()
      handle = null
      if (size === 0) throw new Error('远端响应为空。')
      completed = true
      return { size, sha256: digest.digest('hex'), bytes: output ? undefined : Buffer.concat(chunks) }
    }
  } catch (error) {
    // open('wx')、流读取、写入及跳转校验的失败都终止本次网络请求。
    controller.abort()
    throw error
  } finally {
    clearTimeout(timer)
    await cancelBody(body)
    await handle?.close().catch(() => undefined)
    // 只删除本次成功创建的坏文件；wx 失败时绝不删除原有文件。
    if (!completed && ownsOutput) await rm(output, { force: true }).catch(() => undefined)
  }
}

/** 正文可能已经读完或处于失败状态，回收异常不能覆盖最初的业务错误。 */
async function cancelBody(body) {
  if (body) await body.cancel().catch(() => undefined)
}

/** FileHandle.write 允许部分写入，必须循环直至当前块全部落盘。 */
async function writeAllBytes(handle, bytes) {
  for (let offset = 0; offset < bytes.length;) {
    const remaining = bytes.length - offset
    const { bytesWritten } = await handle.write(bytes, offset, remaining, null)
    if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0 || bytesWritten > remaining) throw new Error('远端附件写入未完成。')
    offset += bytesWritten
  }
}

export function validateManifests(android, tauri, release, config, channel = config.defaultChannel) {
  validateVersionFile(release)
  if (android?.schemaVersion !== 1 || android.version !== release.productVersion || android.displayVersion !== release.displayVersion
    || android.versionCode !== release.android.versionCode || !Array.isArray(android.notes) || android.notes.some((line) => typeof line !== 'string')
    || !/^[a-f\d]{64}$/i.test(android.apk?.sha256 ?? '') || !Number.isSafeInteger(android.apk?.size) || android.apk.size <= 0) throw new Error('Android 清单字段或版本无效。')
  const windows = tauri?.platforms?.['windows-x86_64']
  if (!semverPattern.test(tauri?.version ?? '') || tauri.version !== release.productVersion || typeof tauri.notes !== 'string'
    || typeof windows?.signature !== 'string' || !/^[A-Za-z\d+/=]+$/.test(windows.signature)
    || !Buffer.from(windows.signature, 'base64').toString('utf8').startsWith('untrusted comment:')) throw new Error('Windows 清单字段、版本或签名内容无效。')
  validatePublishedAt(android.publishedAt)
  validatePublishedAt(tauri.pub_date)
  if (android.publishedAt !== tauri.pub_date) throw new Error('两端清单必须使用同一批次发布时间。')
  validateAssetUrl(android.apk.url, config, { version: release.productVersion, channel, platform: 'android' })
  validateAssetUrl(windows.url, config, { version: release.productVersion, channel, platform: 'windows' })
  return windows
}

/** 完整清单和实际签名地址共同绑定；仅调整 JSON 键顺序不会改变语义摘要。 */
export function manifestBindingSha256(android, tauri, signatureUrl = `${tauri?.platforms?.['windows-x86_64']?.url}.sig`) {
  const canonical = (value) => Array.isArray(value) ? value.map(canonical)
    : value !== null && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
      : value
  return createHash('sha256').update(JSON.stringify(canonical({ schemaVersion: 1, android, tauri, signatureUrl }))).digest('hex')
}

/** 可用本地清单验证已上传附件；只有 --remote-manifests 才读取正式通道指针。 */
export async function verifyPublishedAssets(options) {
  let reportPath
  try {
    if (options?.output) {
      reportPath = resolve(root, options.output)
      // 先撤销旧成功再做任何参数或文件检查，失败不能留下可被 StagePublic 复用的旧报告。
      await rm(reportPath, { force: true })
      await writeJson(reportPath, { schemaVersion: 1, verified: false, status: 'pending', checkedAt: new Date().toISOString() })
    }
    return await verifyPublishedAssetsInternal(options)
  } catch (error) {
    if (reportPath) {
      try {
        await writeJson(reportPath, { schemaVersion: 1, verified: false, status: 'failed', checkedAt: new Date().toISOString() })
      } catch {
        // 写入失败时改为删除旧报告；两种方式都不能保留 verified:true。
        await rm(reportPath, { force: true })
      }
    }
    throw error
  }
}

/** 只有所有字节、真实产物及签名通过后才写成功报告；外层统一处理所有失败。 */
async function verifyPublishedAssetsInternal(options) {
  requireArgs(options, ['channel', 'public-dir', 'artifacts-dir'])
  const config = validateReleaseConfig(await readJson(options.config ?? 'release-config.json'))
  if (!['stable', 'staging'].includes(options.channel) || !config.channels?.[options.channel]) throw new Error('未知发布通道。')
  const release = validateVersionFile(await readJson(options['version-file'] ?? 'release-version.json'))
  const signing = validateSigning(await readJson(options.signing ?? 'release-signing.json'))
  const publicDir = resolve(root, options['public-dir'])
  const artifactsDir = resolve(root, options['artifacts-dir'])
  let android = await readJson(resolve(publicDir, 'android-latest.json'))
  let tauri = await readJson(resolve(publicDir, 'latest.json'))
  const expectedAndroid = android
  const expectedTauri = tauri
  // 注入 Fetch 仅供故障测试；CLI 仍使用默认匿名网络请求和真实产物验签。
  const network = { allowedHosts: config.allowedDownloadHosts ?? ['gitee.com'], fetcher: options.fetcher ?? globalThis.fetch }
  if (options['remote-manifests']) {
    const channel = config.channels[options.channel]
    android = JSON.parse((await anonymousGet(channel.androidManifestUrl, { ...network, maxBytes: 1024 * 1024 })).bytes.toString('utf8'))
    tauri = JSON.parse((await anonymousGet(channel.tauriManifestUrl, { ...network, maxBytes: 1024 * 1024 })).bytes.toString('utf8'))
    if (JSON.stringify(android) !== JSON.stringify(expectedAndroid) || JSON.stringify(tauri) !== JSON.stringify(expectedTauri)) throw new Error('远端通道清单与本次预期内容不同。')
  }
  const windows = validateManifests(android, tauri, release, config, options.channel)
  const signatureUrl = options['signature-url'] ?? `${windows.url}.sig`
  validateAssetUrl(signatureUrl, config, { version: release.productVersion, channel: options.channel, platform: 'signature' })
  const temporary = await mkdtemp(join(tmpdir(), 'zhiwellcare-release-'))
  const assets = []
  try {
    // 完整下载三份附件并逐字节摘要比对，不能以 HEAD 或网页可见代替验收。
    for (const url of [android.apk.url, windows.url, signatureUrl]) {
      const name = decodeURIComponent(new URL(url).pathname.split('/').at(-1))
      if (name !== basename(name) || /[\\/\r\n]/.test(name)) throw new Error('远端附件文件名无效。')
      const local = await hashFile(resolve(artifactsDir, name))
      const remotePath = join(temporary, name)
      const remote = await anonymousGet(url, { ...network, maxBytes: local.size, timeoutMs: 300000, output: remotePath })
      if (remote.size !== local.size || remote.sha256 !== local.sha256) throw new Error(`远端附件与本地最终字节不一致：${name}。`)
      assets.push({ name, ...local })
    }
    const apkName = assets[0].name
    const exeName = assets[1].name
    const sigName = assets[2].name
    if (assets[0].sha256 !== android.apk.sha256 || assets[0].size !== android.apk.size) throw new Error('远端 APK 与清单大小/摘要不一致。')
    if ((await readFile(join(temporary, sigName), 'utf8')).trim() !== windows.signature) throw new Error('远端 EXE.sig 与清单签名不同。')
    await verifyApk(join(temporary, apkName), release, signing)
    await verifyWindows(join(temporary, exeName), join(temporary, sigName), release, signing)
    // 报告同时绑定内容和访问地址，后续改清单必须重新做完整远端验收。
    const report = { schemaVersion: 1, verified: true, channel: options.channel, version: release.productVersion, mode: options['remote-manifests'] ? 'remote-manifests' : 'local-manifests', checkedAt: new Date().toISOString(), assets, manifestBindingSha256: manifestBindingSha256(android, tauri, signatureUrl) }
    if (options.output) await writeJson(resolve(root, options.output), report)
    return report
  } finally {
    // 仅清理本次 mkdtemp 创建的临时目录，绝不操作用户源码或 Keys。
    await rm(temporary, { recursive: true, force: true })
  }
}

if (isMain(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2), ['channel', 'public-dir', 'artifacts-dir', 'config', 'signing', 'version-file', 'signature-url', 'output'], ['remote-manifests'])
  console.log(JSON.stringify(await verifyPublishedAssets(options), null, 2))
}
