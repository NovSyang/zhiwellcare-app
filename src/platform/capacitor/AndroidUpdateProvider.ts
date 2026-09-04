import type { IUpdateProvider, UpdateInstallPermission } from '../../core/update/IUpdateProvider'
import type { UpdateInfo, UpdateProgress } from '../../core/update/UpdateInfo'
import { UPDATE_ENDPOINTS } from '../update/UpdateEndpoints'
import { AndroidApkUpdater, type AndroidUpdaterBridge } from './AndroidApkUpdaterPlugin'

export interface AndroidUpdateManifest {
  schemaVersion: 1
  version: string
  displayVersion: string
  versionCode: number
  publishedAt: string | null
  notes: string[]
  apk: {
    url: string
    sha256: string
    size: number
  }
}

type FetchFunction = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/**
 * 通过 globalThis 调用原生 Fetch，保留 Android WebView 要求的 Window 上下文。
 * 测试仍可向 Provider 注入普通 FetchFunction，不影响现有业务测试。
 */
export const defaultAndroidUpdateFetcher: FetchFunction = (input, init) => globalThis.fetch(input, init)

/** Android 使用 versionCode 比较，避免把版本字符串按浮点数处理。 */
export class AndroidUpdateProvider implements IUpdateProvider {
  readonly platform = 'android' as const
  readonly supported = true
  private currentVersionCode = 0
  private currentVersionName = ''
  private manifest: AndroidUpdateManifest | null = null
  private removeProgressListener: (() => Promise<void>) | null = null

  constructor(
    private readonly bridge: AndroidUpdaterBridge = AndroidApkUpdater,
    private readonly fetcher: FetchFunction = defaultAndroidUpdateFetcher,
    private readonly endpoint = UPDATE_ENDPOINTS.android,
  ) {}

  async getCurrentVersion(): Promise<string> {
    const current = await this.bridge.getCurrentVersion()
    this.currentVersionCode = current.versionCode
    this.currentVersionName = current.versionName
    return current.versionName
  }

  async checkForUpdate(): Promise<UpdateInfo | null> {
    if (!this.currentVersionName) await this.getCurrentVersion()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    try {
      const response = await this.fetcher(this.endpoint, {
        cache: 'no-store',
        redirect: 'follow',
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`更新服务器返回 HTTP ${response.status}。`)
      const manifest = validateAndroidUpdateManifest(await response.json())
      if (manifest.versionCode <= this.currentVersionCode) {
        this.manifest = null
        return null
      }
      this.manifest = manifest
      return {
        currentVersion: this.currentVersionName,
        latestVersion: manifest.version,
        displayVersion: manifest.displayVersion,
        notes: [...manifest.notes],
        publishedAt: manifest.publishedAt,
        sizeBytes: manifest.apk.size,
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw new Error('检查更新超时，请稍后重试。')
      // Fetch 在离线、DNS 或服务器不可达时通常抛出 TypeError，转换为用户可理解的提示。
      if (error instanceof TypeError) throw new Error('无法连接更新服务器，请检查网络后重试。')
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  async download(_update: UpdateInfo, onProgress?: (progress: UpdateProgress) => void): Promise<void> {
    const manifest = this.manifest
    if (!manifest) throw new Error('Android 更新清单尚未准备。')
    await this.removeProgressListener?.()
    const handle = await this.bridge.addListener('updateDownloadProgress', (event) => {
      onProgress?.({
        downloadedBytes: safeNonNegative(event.downloadedBytes),
        totalBytes: safeNullableNumber(event.totalBytes),
        percent: safeNullablePercent(event.percent),
      })
    })
    this.removeProgressListener = () => handle.remove()
    try {
      await this.bridge.downloadApk({
        url: manifest.apk.url,
        sha256: manifest.apk.sha256,
        expectedPackageName: 'com.zhiwellcare.app',
        expectedVersionCode: manifest.versionCode,
        expectedSizeBytes: manifest.apk.size,
      })
    } finally {
      await this.removeProgressListener?.()
      this.removeProgressListener = null
    }
  }

  async install(): Promise<void> {
    await this.bridge.installDownloadedApk()
  }

  async getInstallPermission(): Promise<UpdateInstallPermission> {
    const permission = await this.bridge.getInstallPermission()
    return !permission.required ? 'not-required' : permission.granted ? 'granted' : 'denied'
  }

  openInstallPermissionSettings(): Promise<void> {
    return this.bridge.openInstallPermissionSettings()
  }

  async dispose(): Promise<void> {
    await this.removeProgressListener?.()
    this.removeProgressListener = null
    await this.bridge.clearDownloadedUpdate()
  }
}

/** 拒绝损坏清单，避免不可信字段进入 Native 下载层。 */
export function validateAndroidUpdateManifest(value: unknown): AndroidUpdateManifest {
  if (!isObject(value) || value.schemaVersion !== 1
    || !isSemver(value.version) || typeof value.displayVersion !== 'string'
    || !Number.isInteger(value.versionCode) || Number(value.versionCode) <= 0
    || !(value.publishedAt === null || typeof value.publishedAt === 'string')
    || !Array.isArray(value.notes) || !value.notes.every((item) => typeof item === 'string')
    || !isObject(value.apk) || !isHttpsUrl(value.apk.url)
    || typeof value.apk.sha256 !== 'string' || !/^[a-f\d]{64}$/i.test(value.apk.sha256)
    || !Number.isFinite(value.apk.size) || Number(value.apk.size) <= 0) {
    throw new Error('Android 更新清单格式无效。')
  }
  return {
    schemaVersion: 1,
    version: value.version,
    displayVersion: value.displayVersion,
    versionCode: Number(value.versionCode),
    publishedAt: value.publishedAt,
    notes: [...value.notes],
    apk: { url: value.apk.url, sha256: value.apk.sha256.toLowerCase(), size: Number(value.apk.size) },
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSemver(value: unknown): value is string {
  return typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value)
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try { return new URL(value).protocol === 'https:' } catch { return false }
}

function safeNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function safeNullableNumber(value: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function safeNullablePercent(value: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null
}
