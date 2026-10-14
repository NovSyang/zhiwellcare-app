import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import config from '../release-config.json'
import signing from '../release-signing.json'
import tauri from '../src-tauri/tauri.conf.json'
import { UPDATE_CHANNEL } from '../src/platform/update/UpdateEndpoints'

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

  it('前端仅公开 Tauri 构建环境字段', () => {
    // 这个边界防止 Prepare 注入的私钥和密码进入安装包内的网页代码。
    const vite = readFileSync(resolve(root, 'vite.config.ts'), 'utf8')
    expect(vite).toContain("envPrefix: ['VITE_', 'TAURI_ENV_']")
  })
})
