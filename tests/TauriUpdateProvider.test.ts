import { describe, expect, it, vi } from 'vitest'
import type { Update } from '@tauri-apps/plugin-updater'
import { TauriUpdateProvider } from '../src/platform/tauri/TauriUpdateProvider'

// Fake Update 模拟官方插件资源，测试不会访问真实更新端点。
describe('TauriUpdateProvider', () => {
  it('映射更新信息、下载进度并在安全调用时安装', async () => {
    const update = {
      currentVersion: '0.8.0', version: '0.8.1', body: '第一项\n第二项', date: '2026-08-26T00:00:00Z',
      download: vi.fn(async (callback) => {
        callback({ event: 'Started', data: { contentLength: 100 } })
        callback({ event: 'Progress', data: { chunkLength: 40 } })
        callback({ event: 'Progress', data: { chunkLength: 60 } })
      }),
      install: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    } as unknown as Update
    const provider = new TauriUpdateProvider(async () => update, async () => '0.8.0')
    const progress: Array<number | null> = []
    const info = await provider.checkForUpdate()
    expect(info).toMatchObject({ latestVersion: '0.8.1', notes: ['第一项', '第二项'] })
    await provider.download(info!, (event) => progress.push(event.percent))
    await provider.install()
    await provider.dispose()
    expect(progress).toEqual([0, 40, 100])
    expect(update.install).toHaveBeenCalledOnce()
    expect(update.close).toHaveBeenCalledOnce()
  })

  it('官方 check 返回 null 时表示已是最新版本', async () => {
    const provider = new TauriUpdateProvider(async () => null, async () => '0.8.0')
    await expect(provider.checkForUpdate()).resolves.toBeNull()
  })
})
