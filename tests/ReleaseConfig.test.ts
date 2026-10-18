import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import config from '../release-config.json'
import signing from '../release-signing.json'
import tauri from '../src-tauri/tauri.conf.json'
import { UPDATE_CHANNEL } from '../src/platform/update/UpdateEndpoints'
import { anonymousGet } from '../scripts/release/verify-published-assets.mjs'
import { validateAssetUrl } from '../scripts/release/common.mjs'

const root = resolve(import.meta.dirname, '..')

/** 通过真实脚本入口验证公开配置，避免测试重复实现同一套校验逻辑。 */
function validate(candidate: unknown, identity: unknown = signing) {
  execFileSync(process.execPath, ['--input-type=module', '-e',
    "import {validateReleaseConfig} from './scripts/sync-release-config.mjs'; validateReleaseConfig(JSON.parse(process.argv[1]),JSON.parse(process.argv[2]));",
    JSON.stringify(candidate), JSON.stringify(identity),
  ], { cwd: root, stdio: 'pipe' })
}

describe('统一发布配置', () => {
  it('当前构建通道、公钥和原生入口保持一致', () => {
    // 检查真实 --check 命令不会修改工作区，同时确认客户端使用同一份配置。
    // staging 工作树也要运行这项检查，测试不能强行把它视为 stable。
    const channel = config.channels[UPDATE_CHANNEL]
    expect(() => execFileSync(process.execPath, ['scripts/sync-release-config.mjs', '--check', '--channel', UPDATE_CHANNEL], { cwd: root, stdio: 'pipe' })).not.toThrow()
    expect(tauri.plugins.updater.endpoints).toEqual([channel.tauriManifestUrl])
    expect(tauri.plugins.updater.pubkey).toBe(signing.tauri.publicKey)
    expect(JSON.parse(readFileSync(resolve(root, 'android/update-config.json'), 'utf8')).manifestUrl).toBe(channel.androidManifestUrl)
  })

  it('拒绝旧更新源、错仓库和混入 stable 的 staging 入口', () => {
    for (const url of ['https://github.com/NovSyang/zhiwellcare-app/latest.json', 'http://gitee.com/latest.json', config.channels.staging.tauriManifestUrl]) {
      const candidate = structuredClone(config)
      candidate.channels.stable.tauriManifestUrl = url
      expect(() => validate(candidate)).toThrow()
    }
  })

  it('未登记证书或把私钥内容填入公钥时拒绝发布', () => {
    const placeholder = structuredClone(signing)
    placeholder.android.certificateSha256 = '<待填写>'
    expect(() => validate(config, placeholder)).toThrow()
    const privateKey = structuredClone(signing)
    privateKey.tauri.publicKey = Buffer.from('untrusted comment: minisign encrypted secret key\nsecret').toString('base64')
    expect(() => validate(config, privateKey)).toThrow()
  })

  it('拒绝任意代理主机、通配符和含凭据的主机配置', () => {
    for (const host of ['*.gitee.com', 'user:password@gitee.com', 'gitee.com/path']) {
      expect(() => validate({ ...config, allowedDownloadHosts: ['gitee.com', host] })).toThrow()
    }
  })

  it('原生白名单同步实测 Gitee 主机，长期入口仍位于指定仓库', () => {
    // 白名单仅登记已实测的跳转主机，不将临时 CDN 地址写为长期入口。
    expect(config.allowedDownloadHosts).toEqual(expect.arrayContaining(['gitee.com', 'raw.giteeusercontent.com', 'foruda.gitee.com']))
    const native = JSON.parse(readFileSync(resolve(root, 'android/update-config.json'), 'utf8'))
    expect(native.allowedDownloadHosts).toEqual(config.allowedDownloadHosts)
    expect(config.publishRepository).toBe('https://gitee.com/Syang03/zhiwell-care.git')
    for (const channel of Object.values(config.channels)) {
      expect(new URL(channel.androidManifestUrl).hostname).toBe('gitee.com')
      expect(new URL(channel.tauriManifestUrl).hostname).toBe('gitee.com')
    }
    expect(() => validate(config)).not.toThrow()
  })

  it.each(['raw.giteeusercontent.com', 'foruda.gitee.com'])('逐跳允许已登记主机 %s', async (host) => {
    // 使用受控响应测试白名单，不把它当作六个实际附件的网络验收。
    const entry = config.channels.stable.androidManifestUrl
    const target = `https://${host}/fixture/response`
    const fetcher = vi.fn(async (url: string) => url === entry
      ? new Response(null, { status: 302, headers: { location: target } })
      : new Response('{"fixture":true}', { headers: { 'content-type': 'application/json' } }))
    const result = await anonymousGet(entry, { allowedHosts: config.allowedDownloadHosts, maxBytes: 100, fetcher })
    expect(result.bytes.toString('utf8')).toBe('{"fixture":true}')
    expect(fetcher).toHaveBeenNthCalledWith(2, target, expect.objectContaining({ credentials: 'omit', redirect: 'manual' }))
  })

  it('新增主机不会放宽 HTTPS、仓库及未批准主机边界', async () => {
    const entry = config.channels.stable.androidManifestUrl
    for (const target of ['http://raw.giteeusercontent.com/fixture', 'https://unapproved.example/fixture', 'https://user:password@foruda.gitee.com/fixture']) {
      const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { location: target } }))
      await expect(anonymousGet(entry, { allowedHosts: config.allowedDownloadHosts, maxBytes: 100, fetcher })).rejects.toThrow()
      expect(fetcher).toHaveBeenCalledOnce()
    }
    const identity = { version: '0.1.0', platform: 'android' }
    const filename = 'ZhiWellCare-0.1.0-android.apk'
    expect(() => validateAssetUrl(`https://gitee.com/Other/repo/releases/download/v0.1.0/${filename}`, config, identity)).toThrow()
    // 跳转主机批准不等于允许把 CDN 地址直接作为发布清单的安装包永久 URL。
    expect(() => validateAssetUrl(`https://foruda.gitee.com/releases/download/v0.1.0/${filename}`, config, identity)).toThrow()
  })

  it('前端仅公开 Tauri 构建环境字段', () => {
    // 这个边界防止 Prepare 注入的私钥和密码进入安装包内的网页代码。
    const vite = readFileSync(resolve(root, 'vite.config.ts'), 'utf8')
    expect(vite).toContain("envPrefix: ['VITE_', 'TAURI_ENV_']")
  })
})
