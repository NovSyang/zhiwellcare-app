import { describe, expect, it, vi } from 'vitest'
import release from '../release-version.json'
import config from '../release-config.json'
import signing from '../release-signing.json'
import { parseArgs, validateAssetUrl, validateSigning } from '../scripts/release/common.mjs'
import { assertApkIdentity, parseApkBadging } from '../scripts/release/check-inputs.mjs'
import { anonymousGet, validateManifests } from '../scripts/release/verify-published-assets.mjs'

// 模拟清单只验证字段契约，真实签名验证由发布工具的原生工具执行。
const prefix = `https://gitee.com/Syang03/zhiwell-care/releases/download/v${release.productVersion}/ZhiWellCare-${release.productVersion}`
const signature = Buffer.from('untrusted comment: test fixture\nfixture-only').toString('base64')
const android = { schemaVersion: 1, version: release.productVersion, displayVersion: release.displayVersion, versionCode: release.android.versionCode, publishedAt: '2026-10-14T01:00:00Z', notes: [], apk: { url: `${prefix}-android.apk`, sha256: 'a'.repeat(64), size: 3 } }
const tauri = { version: release.productVersion, notes: '', pub_date: android.publishedAt, platforms: { 'windows-x86_64': { url: `${prefix}-windows-x64-setup.exe`, signature } } }

describe('发布清单与最终包校验', () => {
  it('拒绝未知、缺值及重复参数', () => {
    expect(() => parseArgs(['--bogus', 'x'], ['apk'])).toThrow('未知')
    expect(() => parseArgs(['--apk'], ['apk'])).toThrow('缺少值')
    expect(() => parseArgs(['--apk', 'a', '--apk', 'b'], ['apk'])).toThrow('重复')
  })

  it('拒绝旧仓库、凭据、临时 URL、不同 tag 与文件版本', () => {
    const identity = { version: release.productVersion, platform: 'android' }
    // 真实发布源以后会递增，错误标签样例不能固定替换 0.1.0。
    const otherVersion = release.productVersion === '0.1.0' ? '0.1.1' : '0.1.0'
    expect(() => validateAssetUrl(android.apk.url, config, identity)).not.toThrow()
    for (const url of [android.apk.url.replace('https:', 'http:'), android.apk.url.replace('gitee.com', 'github.com'), `${android.apk.url}?token=x`, android.apk.url.replace(`v${release.productVersion}`, `v${otherVersion}`), android.apk.url.replace('-android.apk', '-wrong.apk'), android.apk.url.replace('https://', 'https://user:password@')]) {
      expect(() => validateAssetUrl(url, config, identity)).toThrow()
    }
  })

  it('公开身份拒绝全零证书及任意 Base64 公钥', () => {
    expect(() => validateSigning(signing)).not.toThrow()
    expect(() => validateSigning({ ...signing, android: { ...signing.android, certificateSha256: '0'.repeat(64) } })).toThrow()
    expect(() => validateSigning({ ...signing, tauri: { publicKey: Buffer.alloc(200).toString('base64') } })).toThrow()
  })

  it('核对 APK 真实版本、debuggable、包名和全部证书指纹', () => {
    const metadata = parseApkBadging(`package: name='com.zhiwellcare.app' versionCode='${release.android.versionCode}' versionName='${release.productVersion}'\napplication-label:'ZhiWellCare'`)
    const certificate = { certificateMd5: signing.android.certificateMd5, certificateSha1: signing.android.certificateSha1, certificateSha256: signing.android.certificateSha256 }
    expect(() => assertApkIdentity(metadata, [certificate], release, signing)).not.toThrow()
    for (const patch of [{ versionName: '9.0.0' }, { versionCode: 1000 }, { applicationId: 'other.app' }, { debuggable: true }]) {
      expect(() => assertApkIdentity({ ...metadata, ...patch }, [certificate], release, signing)).toThrow()
    }
    expect(() => assertApkIdentity(metadata, [{ ...certificate, certificateSha256: 'b'.repeat(64) }], release, signing)).toThrow('证书')
    expect(() => assertApkIdentity(metadata, [certificate, certificate], release, signing)).toThrow('一个')
  })

  it('清单拒绝空签名、签名路径、错版本和不一致发布时间', () => {
    expect(() => validateManifests(android, tauri, release, config)).not.toThrow()
    for (const invalid of ['', '/tmp/app.exe.sig', 'https://example.com/app.sig']) {
      expect(() => validateManifests(android, { ...tauri, platforms: { 'windows-x86_64': { ...tauri.platforms['windows-x86_64'], signature: invalid } } }, release, config)).toThrow('签名')
    }
    expect(() => validateManifests({ ...android, versionCode: 999 }, tauri, release, config)).toThrow('版本')
    expect(() => validateManifests(android, { ...tauri, pub_date: '2026-10-14T02:00:00Z' }, release, config)).toThrow('时间')
  })
})

describe('匿名完整 GET', () => {
  it('完整读取字节、计算摘要且不附带登录态', async () => {
    const fetcher = vi.fn(async () => new Response('abc', { headers: { 'content-length': '3' } }))
    const result = await anonymousGet(android.apk.url, { maxBytes: 3, fetcher })
    expect(result).toMatchObject({ size: 3, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' })
    expect(fetcher).toHaveBeenCalledWith(android.apk.url, expect.objectContaining({ credentials: 'omit', redirect: 'manual' }))
  })

  it('拒绝 200 HTML、错误状态和流式超限', async () => {
    await expect(anonymousGet(android.apk.url, { maxBytes: 3, fetcher: async () => new Response('<html>', { headers: { 'content-type': 'text/html' } }) })).rejects.toThrow('HTML')
    for (const status of [403, 404, 429, 500]) await expect(anonymousGet(android.apk.url, { maxBytes: 3, fetcher: async () => new Response('', { status }) })).rejects.toThrow(`HTTP ${status}`)
    await expect(anonymousGet(android.apk.url, { maxBytes: 2, fetcher: async () => new Response('abc') })).rejects.toThrow('超限')
  })

  it('逐次拒绝 HTTPS 降级、凭据、未知主机和重定向循环', async () => {
    for (const location of ['http://gitee.com/a', 'https://user:pass@gitee.com/a', 'https://unapproved.example/a', android.apk.url]) {
      const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { location } }))
      await expect(anonymousGet(android.apk.url, { maxBytes: 3, fetcher })).rejects.toThrow()
      expect(fetcher).toHaveBeenCalledOnce()
    }
  })
})
