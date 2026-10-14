import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PluginListenerHandle } from '@capacitor/core'
import { AndroidUpdateProvider, validateAndroidUpdateManifest } from '../src/platform/capacitor/AndroidUpdateProvider'
import type { AndroidDownloadProgress, AndroidUpdaterBridge } from '../src/platform/capacitor/AndroidApkUpdaterPlugin'
import { UPDATE_ENDPOINTS } from '../src/platform/update/UpdateEndpoints'

const manifest = {
  schemaVersion: 1,
  version: '0.8.1',
  displayVersion: '0.8.1',
  versionCode: 9,
  publishedAt: '2026-08-26T00:00:00Z',
  notes: ['修复 Android'],
  apk: { url: 'https://gitee.com/Syang03/zhiwell-care/releases/download/v0.8.1/ZhiWellCare.apk', sha256: 'a'.repeat(64), size: 100 },
}

function bridge() {
  let progress: ((event: AndroidDownloadProgress) => void) | null = null
  const value = {
    getCurrentVersion: vi.fn(async () => ({ packageName: 'com.zhiwellcare.app', versionName: '0.8.0', versionCode: 8 })),
    // 模拟原生清单响应，生产检查不调用 WebView Fetch。
    fetchUpdateManifest: vi.fn(async ({ url }: { url: string }) => ({ body: JSON.stringify(manifest), finalUrl: url })),
    getInstallPermission: vi.fn(async () => ({ required: true, granted: true })),
    openInstallPermissionSettings: vi.fn(async () => undefined),
    downloadApk: vi.fn(async () => ({ sizeBytes: 100, sha256: 'a'.repeat(64) })),
    installDownloadedApk: vi.fn(async () => ({ status: 'success' })),
    clearDownloadedUpdate: vi.fn(async () => undefined),
    addListener: vi.fn(async (_event, callback) => { progress = callback; return { remove: vi.fn(async () => undefined) } as PluginListenerHandle }),
  }
  return { value: value as AndroidUpdaterBridge, emitProgress: (event: AndroidDownloadProgress) => progress?.(event), spies: value }
}

/** 注入加载器直接返回原始文本，让测试覆盖 JSON 解析和重定向结果检查。 */
function response(value: unknown) {
  return Promise.resolve({ body: JSON.stringify(value), finalUrl: UPDATE_ENDPOINTS.android })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AndroidUpdateProvider', () => {
  it('默认清单加载通过原生桥接，不调用 WebView Fetch', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const fake = bridge()
    const provider = new AndroidUpdateProvider(fake.value)
    await expect(provider.checkForUpdate()).resolves.toMatchObject({ latestVersion: '0.8.1' })
    expect(fake.spies.fetchUpdateManifest).toHaveBeenCalledWith({ url: UPDATE_ENDPOINTS.android })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('仅当远端 versionCode 更大时返回更新', async () => {
    const fake = bridge()
    const provider = new AndroidUpdateProvider(fake.value, () => response(manifest))
    await provider.getCurrentVersion()
    await expect(provider.checkForUpdate()).resolves.toMatchObject({ latestVersion: '0.8.1', sizeBytes: 100 })

    const sameProvider = new AndroidUpdateProvider(fake.value, () => response({ ...manifest, versionCode: 8 }))
    await sameProvider.getCurrentVersion()
    await expect(sameProvider.checkForUpdate()).resolves.toBeNull()
    const lowerProvider = new AndroidUpdateProvider(fake.value, () => response({ ...manifest, versionCode: 7 }))
    await expect(lowerProvider.checkForUpdate()).resolves.toBeNull()
  })

  it('拒绝非 HTTPS、错误 SHA 或损坏字段', () => {
    expect(() => validateAndroidUpdateManifest({ ...manifest, apk: { ...manifest.apk, url: 'http://example.com/app.apk' } })).toThrow('格式无效')
    expect(() => validateAndroidUpdateManifest({ ...manifest, apk: { ...manifest.apk, sha256: 'bad' } })).toThrow('格式无效')
    expect(() => validateAndroidUpdateManifest({ ...manifest, versionCode: 0 })).toThrow('格式无效')
  })

  // 拒绝数值溢出、伪造展示号和含凭据 URL，保护原生下载边界。
  it.each([
    { ...manifest, versionCode: Number.MAX_SAFE_INTEGER + 1 },
    { ...manifest, versionCode: 9.5 },
    { ...manifest, version: '00.8.1' },
    { ...manifest, version: '0.8' },
    { ...manifest, displayVersion: 'V0.8.1' },
    { ...manifest, publishedAt: 'not-a-date' },
    { ...manifest, apk: { ...manifest.apk, size: 100.5 } },
    { ...manifest, apk: { ...manifest.apk, size: Number.MAX_SAFE_INTEGER + 1 } },
    { ...manifest, apk: { ...manifest.apk, url: 'https://user:password@gitee.com/app.apk' } },
  ])('拒绝严格清单校验中的非法字段 %#', (value) => {
    expect(() => validateAndroidUpdateManifest(value)).toThrow('格式无效')
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

  it('HTTP 失败与 200 HTML 都是服务错误，不返回已是最新', async () => {
    const fake = bridge()
    fake.spies.fetchUpdateManifest.mockRejectedValue(new Error('更新服务器返回 HTTP 404。'))
    await expect(new AndroidUpdateProvider(fake.value).checkForUpdate()).rejects.toThrow('HTTP 404')
    const htmlProvider = new AndroidUpdateProvider(fake.value, async () => ({ body: '<html>login</html>', finalUrl: UPDATE_ENDPOINTS.android }))
    await expect(htmlProvider.checkForUpdate()).rejects.toThrow('有效的 JSON')
  })

  it('拒绝响应超限与重定向降级', async () => {
    const fake = bridge()
    const large = new AndroidUpdateProvider(fake.value, async () => ({ body: ' '.repeat(1024 * 1024 + 1), finalUrl: UPDATE_ENDPOINTS.android }))
    await expect(large.checkForUpdate()).rejects.toThrow('大小')
    const insecure = new AndroidUpdateProvider(fake.value, async () => ({ body: JSON.stringify(manifest), finalUrl: 'http://gitee.com/update.json' }))
    await expect(insecure.checkForUpdate()).rejects.toThrow('响应格式无效')
  })

  it('重查失败后作废旧候选，不能继续下载或安装', async () => {
    const fake = bridge()
    const provider = new AndroidUpdateProvider(fake.value)
    const oldInfo = await provider.checkForUpdate()
    fake.spies.fetchUpdateManifest.mockRejectedValue(new Error('HTTP 500'))
    await expect(provider.checkForUpdate()).rejects.toThrow('HTTP 500')
    await expect(provider.download(oldInfo!)).rejects.toThrow('清单尚未准备')
    await expect(provider.install()).rejects.toThrow('先下载并校验')
    expect(fake.spies.downloadApk).not.toHaveBeenCalled()
    expect(fake.spies.installDownloadedApk).not.toHaveBeenCalled()
  })

  it('下载返回摘要与清单不一致时清理坏包', async () => {
    const fake = bridge()
    const provider = new AndroidUpdateProvider(fake.value)
    const info = await provider.checkForUpdate()
    fake.spies.downloadApk.mockResolvedValue({ sizeBytes: 101, sha256: 'a'.repeat(64) })
    const clearsBefore = fake.spies.clearDownloadedUpdate.mock.calls.length
    await expect(provider.download(info!)).rejects.toThrow('校验结果')
    expect(fake.spies.clearDownloadedUpdate.mock.calls.length).toBe(clearsBefore + 1)
    await expect(provider.install()).rejects.toThrow('先下载并校验')
  })

  it('销毁等待下载结束，重复下载只有一份进度订阅且文件不会竞争删除', async () => {
    const fake = bridge()
    let finish: (() => void) | undefined
    fake.spies.downloadApk.mockImplementation(async () => {
      await new Promise<void>((resolve) => { finish = resolve })
      return { sizeBytes: 100, sha256: 'a'.repeat(64) }
    })
    const provider = new AndroidUpdateProvider(fake.value)
    const info = await provider.checkForUpdate()
    const first = provider.download(info!)
    const repeated = provider.download(info!)
    await vi.waitFor(() => expect(fake.spies.downloadApk).toHaveBeenCalledOnce())
    const clearsBefore = fake.spies.clearDownloadedUpdate.mock.calls.length
    const disposing = provider.dispose()
    await Promise.resolve()
    expect(fake.spies.clearDownloadedUpdate.mock.calls.length).toBe(clearsBefore)
    expect(fake.spies.addListener).toHaveBeenCalledOnce()
    finish!()
    await Promise.all([first, repeated, disposing])
    expect(fake.spies.clearDownloadedUpdate.mock.calls.length).toBe(clearsBefore + 1)
    await expect(provider.checkForUpdate()).rejects.toThrow('已关闭')
  })
})
