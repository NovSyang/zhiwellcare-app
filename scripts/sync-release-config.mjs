import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 公开配置只允许本次选定的发布仓库；下载 CDN 需要现场核验后明确登记。 */
export function validateReleaseConfig(config, signing) {
  if (config?.schemaVersion !== 1 || config.publishRepository !== 'https://gitee.com/Syang03/zhiwell-care.git'
    || config.publishBranch !== 'main' || config.defaultChannel !== 'stable') {
    throw new Error('发布仓库、分支或默认通道不符合统一发布基准。')
  }
  if (!Array.isArray(config.allowedDownloadHosts) || !config.allowedDownloadHosts.includes('gitee.com')
    || config.allowedDownloadHosts.some(host => typeof host !== 'string' || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}$/.test(host))) {
    throw new Error('下载主机必须是已登记的完整域名，不接受通配符或凭据。')
  }
  for (const channel of ['stable', 'staging']) {
    for (const [key, file] of [['androidManifestUrl', 'android-latest.json'], ['tauriManifestUrl', 'latest.json']]) {
      const expected = `https://gitee.com/Syang03/zhiwell-care/raw/main/channels/${channel}/${file}`
      if (config.channels?.[channel]?.[key] !== expected) throw new Error(`${channel} 的 ${key} 地址无效。`)
    }
  }
  if (signing?.schemaVersion !== 1 || signing.android?.applicationId !== 'com.zhiwellcare.app'
    || signing.android.keyAlias !== 'zhiwellcare' || signing.android.keyStoreType !== 'PKCS12') {
    throw new Error('Android 包名、证书别名或密钥库格式不符合团队基准。')
  }
  for (const [key, length] of [['certificateMd5', 32], ['certificateSha1', 40], ['certificateSha256', 64]]) {
    if (!new RegExp(`^[a-f0-9]{${length}}$`).test(signing.android[key] ?? '') || /^0+$/.test(signing.android[key])) {
      throw new Error(`公开证书 ${key} 尚未登记有效指纹。`)
    }
  }
  // 已登记的 MD5/SHA-1 是原签名文档基准，不能把另一证书自动登记为可信。
  if (signing.android.certificateMd5 !== '4ee1e429da8e011eb75b49ebdb03b6a4'
    || signing.android.certificateSha1 !== 'e3f49e91e89d0e84ae8029b490860c0e64d5d6f1') {
    throw new Error('Android 证书不符合用户指定的原签名身份。')
  }
  // Tauri 保存的是整个 Minisign 公钥文本的 Base64，不能放入私钥或文件路径。
  const key = signing.tauri?.publicKey
  if (typeof key !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(key)) throw new Error('Tauri 公钥编码无效。')
  const decoded = Buffer.from(key, 'base64').toString('utf8').trim().split(/\r?\n/)
  const minisignKey = Buffer.from(decoded[1] ?? '', 'base64')
  if (decoded.length !== 2 || !decoded[0].startsWith('untrusted comment: minisign public key:')
    || minisignKey.length !== 42 || minisignKey.subarray(0, 2).toString('ascii') !== 'Ed'
    || minisignKey.subarray(10).every(byte => byte === 0)) {
    throw new Error('Tauri 公钥必须是有效的 Minisign 公钥。')
  }
}

/** 同一通道生成三端镜像，--check 只比较文件，绝不修改构建配置。 */
export async function syncReleaseConfig({ root, write = false, channel = 'stable' }) {
  if (!['stable', 'staging'].includes(channel)) throw new Error('通道只能为 stable 或 staging。')
  const readJson = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'))
  const config = await readJson('release-config.json')
  const signing = await readJson('release-signing.json')
  validateReleaseConfig(config, signing)
  const endpoints = config.channels[channel]
  const tauri = await readJson('src-tauri/tauri.conf.json')
  tauri.plugins.updater.pubkey = signing.tauri.publicKey
  tauri.plugins.updater.endpoints = [endpoints.tauriManifestUrl]
  if (tauri.identifier !== signing.android.applicationId || !tauri.bundle.targets.includes('nsis')
    || tauri.bundle.createUpdaterArtifacts !== true || tauri.plugins.updater.windows.installMode !== 'passive') {
    throw new Error('Tauri 包标识、NSIS 产物或官方更新安装模式发生漂移。')
  }
  const source = `// 此文件由 release-config.json 生成；Windows 实际入口还需同步 Tauri 配置。\n`
    + `export const UPDATE_CHANNEL: 'stable' | 'staging' = '${channel}'\n\n`
    + `export const UPDATE_ENDPOINTS = {\n  tauri: '${endpoints.tauriManifestUrl}',\n  android: '${endpoints.androidManifestUrl}',\n} as const\n`
  const android = {
    channel, manifestUrl: endpoints.androidManifestUrl,
    downloadBaseUrl: config.publishRepository.replace(/\.git$/, '') + '/releases/download/',
    allowedDownloadHosts: config.allowedDownloadHosts,
  }
  const targets = [
    ['src/platform/update/UpdateEndpoints.ts', source],
    ['android/update-config.json', JSON.stringify(android, null, 2) + '\n'],
    ['src-tauri/tauri.conf.json', JSON.stringify(tauri, null, 2) + '\n'],
  ]
  const drifted = []
  for (const [path, expected] of targets) {
    let current = ''
    try { current = await readFile(resolve(root, path), 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error }
    // 新检出的 Windows 工作树可能使用 CRLF，配置内容相同则不要求重写。
    if (current.replace(/\r\n/g, '\n') !== expected.replace(/\r\n/g, '\n')) {
      if (write) await writeFile(resolve(root, path), expected, 'utf8')
      else drifted.push(path)
    }
  }
  if (drifted.length) throw new Error(`发布配置不一致，请先同步 ${channel}：${drifted.join(', ')}`)
  return channel
}

// 主入口严格拒绝未知参数，防止拼错参数后生成错误发布通道。
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2)
    let write = false, mode = null, channel = 'stable'
    for (let index = 0; index < args.length; index++) {
      const arg = args[index]
      if (arg === '--write' || arg === '--check') {
        if (mode) throw new Error('必须且只能选择一个 --write 或 --check。')
        mode = arg; write = arg === '--write'
      } else if (arg === '--channel') {
        channel = args[++index]
        if (!channel || channel.startsWith('--')) throw new Error('--channel 缺少值。')
      } else throw new Error(`未知参数：${arg}`)
    }
    if (!mode) throw new Error('需要 --write 或 --check。')
    const root = fileURLToPath(new URL('../', import.meta.url))
    await syncReleaseConfig({ root, write, channel })
    console.log(`发布配置${write ? '已同步' : '一致'}：${channel}`)
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
