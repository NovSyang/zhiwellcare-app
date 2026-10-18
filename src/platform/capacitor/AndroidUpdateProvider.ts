import type { IUpdateProvider, UpdateInstallPermission } from '../../core/update/IUpdateProvider'
import type { UpdateInfo, UpdateProgress } from '../../core/update/UpdateInfo'
import { UpdateError } from '../../core/update/UpdateError'
import { UPDATE_ENDPOINTS } from '../update/UpdateEndpoints'
import { AndroidApkUpdater, type AndroidManifestResponse, type AndroidUpdaterBridge } from './AndroidApkUpdaterPlugin'

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

/** 测试可注入清单加载器；生产默认走原生网络，不依赖 WebView 的跨域 Fetch。 */
export type AndroidManifestLoader = (url: string) => Promise<AndroidManifestResponse>

/** Android 使用 versionCode 比较，避免把版本字符串按浮点数处理。 */
export class AndroidUpdateProvider implements IUpdateProvider {
  readonly platform = 'android' as const
  readonly supported = true
  private currentVersionCode = 0
  private currentVersionName = ''
  private manifest: AndroidUpdateManifest | null = null
  private downloadedManifest: AndroidUpdateManifest | null = null
  private removeProgressListener: (() => Promise<void>) | null = null
  private activeTask: { kind: string; promise: Promise<unknown> } | null = null
  private clearing: Promise<void> | null = null
  private disposed = false

  constructor(
    private readonly bridge: AndroidUpdaterBridge = AndroidApkUpdater,
    private readonly loadManifest: AndroidManifestLoader = (url) => bridge.fetchUpdateManifest({ url }),
    private readonly endpoint = UPDATE_ENDPOINTS.android,
  ) {}

  async getCurrentVersion(): Promise<string> {
    const current = await this.bridge.getCurrentVersion()
    // 原生元数据也必须合法，否则无法可靠进行反降级比较。
    if (!Number.isSafeInteger(current.versionCode) || current.versionCode <= 0 || !isSemver(current.versionName)) {
      throw new Error('Android 当前版本信息无效。')
    }
    this.currentVersionCode = current.versionCode
    this.currentVersionName = current.versionName
    return current.versionName
  }

  checkForUpdate(): Promise<UpdateInfo | null> {
    return this.runTask('check', async () => {
      // 每轮检查先作废旧候选，失败后不能下载上一轮的安装包。
      this.manifest = null
      this.downloadedManifest = null
      await this.bridge.clearDownloadedUpdate()
      try {
        if (!isHttpsUrl(this.endpoint)) throw new Error('Android 更新入口必须使用无凭据的 HTTPS 地址。')
        await this.getCurrentVersion()
        const response = await this.loadManifest(this.endpoint)
        if (!isHttpsUrl(response.finalUrl) || typeof response.body !== 'string') {
          throw new Error('Android 更新响应格式无效。')
        }
        if (new TextEncoder().encode(response.body).byteLength > 1024 * 1024) {
          throw new Error('Android 更新清单超过允许的大小。')
        }
        let value: unknown
        try { value = JSON.parse(response.body) }
        catch { throw new Error('更新服务器未返回有效的 JSON 清单。') }
        const manifest = validateAndroidUpdateManifest(value)
        if (manifest.versionCode <= this.currentVersionCode) return null
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
        // 注入加载器及桥接网络异常使用同一条可读提示，HTTP 错误保留原生状态码。
        if (error instanceof TypeError) throw new Error('无法连接更新服务器，请检查网络后重试。')
        throw error
      }
    })
  }

  download(update: UpdateInfo, onProgress?: (progress: UpdateProgress) => void): Promise<void> {
    return this.runTask('download', async () => {
      const manifest = this.manifest
      if (!manifest || update.latestVersion !== manifest.version || update.sizeBytes !== manifest.apk.size) {
        throw new Error('Android 更新清单尚未准备或已经过期。')
      }
      this.downloadedManifest = null
      const handle = await this.bridge.addListener('updateDownloadProgress', (event) => {
        if (!this.disposed) onProgress?.({
          downloadedBytes: safeNonNegative(event.downloadedBytes),
          totalBytes: safeNullableNumber(event.totalBytes),
          percent: safeNullablePercent(event.percent),
        })
      })
      this.removeProgressListener = () => handle.remove()
      try {
        const result = await this.bridge.downloadApk({
          url: manifest.apk.url,
          sha256: manifest.apk.sha256,
          expectedPackageName: 'com.zhiwellcare.app',
          expectedVersionCode: manifest.versionCode,
          expectedSizeBytes: manifest.apk.size,
        })
        // 只将已通过原生校验且返回摘要、大小一致的包标记为可安装。
        if (result.sizeBytes !== manifest.apk.size || result.sha256.toLowerCase() !== manifest.apk.sha256) {
          throw new Error('Android 安装包校验结果与更新清单不一致。')
        }
        this.downloadedManifest = manifest
      } catch (error) {
        // 清理失败不能覆盖最初的下载或验签错误。
        await this.bridge.clearDownloadedUpdate().catch(() => undefined)
        throw error
      } finally {
        await this.removeProgressListener?.()
        this.removeProgressListener = null
      }
    })
  }

  install(): Promise<void> {
    return this.runTask('install', async () => {
      if (!this.downloadedManifest) throw new Error('请先下载并校验 Android 更新。')
      const result = await this.bridge.installDownloadedApk()
      if (result.status === 'cancelled') throw new UpdateError('已取消安装，可手动重试。', 'UPDATE_INSTALL_CANCELLED')
      if (result.status !== 'success') throw new Error('Android 安装未成功完成。')
    })
  }

  async getInstallPermission(): Promise<UpdateInstallPermission> {
    const permission = await this.bridge.getInstallPermission()
    return !permission.required ? 'not-required' : permission.granted ? 'granted' : 'denied'
  }

  openInstallPermissionSettings(): Promise<void> {
    return this.bridge.openInstallPermissionSettings()
  }

  clearDownloadedUpdate(): Promise<void> {
    if (this.clearing) return this.clearing
    // 先等当前任务退出，再清理文件，避免与下载写入竞争。
    const previous = this.activeTask?.promise
    this.clearing = Promise.resolve().then(async () => {
      await previous?.catch(() => undefined)
      this.downloadedManifest = null
      await this.bridge.clearDownloadedUpdate()
    }).finally(() => { this.clearing = null })
    return this.clearing
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    await this.clearDownloadedUpdate()
    await this.removeProgressListener?.()
    this.removeProgressListener = null
    this.manifest = null
  }

  /** 相同操作复用任务，不同操作明确拒绝，避免同时创建多个原生安装会话。 */
  private runTask<T>(kind: string, action: () => Promise<T>): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('Android 更新器已关闭。'))
    if (this.clearing) return Promise.reject(new UpdateError('正在清理更新缓存，请稍后重试。', 'UPDATE_BUSY'))
    if (this.activeTask) {
      return this.activeTask.kind === kind
        ? this.activeTask.promise as Promise<T>
        : Promise.reject(new UpdateError('已有更新任务正在进行。', 'UPDATE_BUSY'))
    }
    const promise = Promise.resolve().then(() => {
      // 操作排入微任务后仍可能立即销毁，此时不要再启动原生任务。
      if (this.disposed) throw new Error('Android 更新器已关闭。')
      return action()
    }).finally(() => { this.activeTask = null })
    this.activeTask = { kind, promise }
    return promise
  }
}

/** 拒绝损坏清单，避免不可信字段进入 Native 下载层。 */
export function validateAndroidUpdateManifest(value: unknown): AndroidUpdateManifest {
  if (!isObject(value) || value.schemaVersion !== 1
    || !isSemver(value.version) || typeof value.displayVersion !== 'string' || !/^\d+\.\d+(?:\.\d+)?$/.test(value.displayVersion)
    || !Number.isSafeInteger(value.versionCode) || Number(value.versionCode) <= 0
    || !(value.publishedAt === null || (typeof value.publishedAt === 'string' && Number.isFinite(Date.parse(value.publishedAt))))
    || !Array.isArray(value.notes) || !value.notes.every((item) => typeof item === 'string')
    || !isObject(value.apk) || !isHttpsUrl(value.apk.url)
    || typeof value.apk.sha256 !== 'string' || !/^[a-f\d]{64}$/i.test(value.apk.sha256)
    || !Number.isSafeInteger(value.apk.size) || Number(value.apk.size) <= 0) {
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
  // 正式发行号不允许前导零和超出 JS 安全整数范围的版本分量。
  return typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
    && value.split('.').every((part) => Number.isSafeInteger(Number(part)))
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash
  } catch { return false }
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
