import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PluginListenerHandle } from '@capacitor/core'
import { AndroidUpdateProvider, defaultAndroidUpdateFetcher, validateAndroidUpdateManifest } from '../src/platform/capacitor/AndroidUpdateProvider'
import type { AndroidDownloadProgress, AndroidUpdaterBridge } from '../src/platform/capacitor/AndroidApkUpdaterPlugin'

const manifest = {
  schemaVersion: 1,
  version: '0.8.1',
  displayVersion: '0.8.1',
  versionCode: 9,
  publishedAt: '2026-08-26T00:00:00Z',
  notes: ['修复 Android'],
  apk: { url: 'https://github.com/NovSyang/ZhiWellCare/releases/download/v0.8.1/ZhiWellCare.apk', sha256: 'a'.repeat(64), size: 100 },
}

function bridge() {
  let progress: ((event: AndroidDownloadProgress) => void) | null = null
  const value = {
    getCurrentVersion: vi.fn(async () => ({ packageName: 'com.zhiwellcare.app', versionName: '0.8.0', versionCode: 8 })),
    getInstallPermission: vi.fn(async () => ({ required: true, granted: true })),
    openInstallPermissionSettings: vi.fn(async () => undefined),
    downloadApk: vi.fn(async () => ({ sizeBytes: 100, sha256: 'a'.repeat(64) })),
    installDownloadedApk: vi.fn(async () => ({ status: 'success' })),
    clearDownloadedUpdate: vi.fn(async () => undefined),
    addListener: vi.fn(async (_event, callback) => { progress = callback; return { remove: vi.fn(async () => undefined) } as PluginListenerHandle }),
  }
  return { value: value as AndroidUpdaterBridge, emitProgress: (event: AndroidDownloadProgress) => progress?.(event), spies: value }
}

function response(value: unknown, ok = true): Promise<Response> {
  return Promise.resolve({ ok, status: ok ? 200 : 500, json: async () => value } as Response)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AndroidUpdateProvider', () => {
  it('默认 Fetch 适配器通过 globalThis 保留原生调用上下文', async () => {
    const fetcher = vi.fn(function (this: typeof globalThis) {
      expect(this).toBe(globalThis)
      return response(manifest)
    })
    vi.stubGlobal('fetch', fetcher)

    await expect(defaultAndroidUpdateFetcher('https://example.com/update.json')).resolves.toMatchObject({ ok: true })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('仅当远端 versionCode 更大时返回更新', async () => {
    const fake = bridge()
    const provider = new AndroidUpdateProvider(fake.value, () => response(manifest))
    await provider.getCurrentVersion()
    await expect(provider.checkForUpdate()).resolves.toMatchObject({ latestVersion: '0.8.1', sizeBytes: 100 })

    const sameProvider = new AndroidUpdateProvider(fake.value, () => response({ ...manifest, versionCode: 8 }))
    await sameProvider.getCurrentVersion()
    await expect(sameProvider.checkForUpdate()).resolves.toBeNull()
  })

  it('拒绝非 HTTPS、错误 SHA 或损坏字段', () => {
    expect(() => validateAndroidUpdateManifest({ ...manifest, apk: { ...manifest.apk, url: 'http://example.com/app.apk' } })).toThrow('格式无效')
    expect(() => validateAndroidUpdateManifest({ ...manifest, apk: { ...manifest.apk, sha256: 'bad' } })).toThrow('格式无效')
    expect(() => validateAndroidUpdateManifest({ ...manifest, versionCode: 0 })).toThrow('格式无效')
  })

  it('Native 下载参数包含包名、版本和 SHA，并转发进度', async () => {
    const fake = bridge()
    const provider = new AndroidUpdateProvider(fake.value, () => response(manifest))
    const progress: number[] = []
    await provider.getCurrentVersion()
    const info = await provider.checkForUpdate()
    // Native 下载只会在 Listener 注册完成后开始，因此在下载实现内部发布进度。
    fake.spies.downloadApk.mockImplementation(async () => {
      fake.emitProgress({ downloadedBytes: 50, totalBytes: 100, percent: 50 })
      return { sizeBytes: 100, sha256: 'a'.repeat(64) }
    })
    await provider.download(info!, (event) => progress.push(event.percent ?? -1))
    expect(progress).toEqual([50])
    expect(fake.spies.downloadApk).toHaveBeenCalledWith(expect.objectContaining({
      expectedPackageName: 'com.zhiwellcare.app', expectedVersionCode: 9, sha256: 'a'.repeat(64),
    }))
  })

  it('映射安装权限并保留 Native 校验错误', async () => {
    const fake = bridge()
    fake.spies.getInstallPermission.mockResolvedValue({ required: true, granted: false })
    const provider = new AndroidUpdateProvider(fake.value, () => response(manifest))
    await expect(provider.getInstallPermission()).resolves.toBe('denied')
    await provider.openInstallPermissionSettings()
    expect(fake.spies.openInstallPermissionSettings).toHaveBeenCalledOnce()

    await provider.getCurrentVersion()
    const info = await provider.checkForUpdate()
    fake.spies.downloadApk.mockRejectedValue(new Error('APK 签名证书与当前应用不一致。'))
    await expect(provider.download(info!)).rejects.toThrow('签名证书')
  })

  it('网络 Fetch 失败时返回可读中文提示', async () => {
    const fake = bridge()
    const provider = new AndroidUpdateProvider(fake.value, async () => {
      throw new TypeError('Failed to fetch')
    })
    await provider.getCurrentVersion()
    await expect(provider.checkForUpdate()).rejects.toThrow('无法连接更新服务器，请检查网络后重试。')
  })
})
