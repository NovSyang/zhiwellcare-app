import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'

export interface AndroidAppVersion {
  packageName: string
  versionName: string
  versionCode: number
}

export interface AndroidDownloadOptions {
  url: string
  sha256: string
  expectedPackageName: string
  expectedVersionCode: number
  expectedSizeBytes?: number
}

export interface AndroidDownloadProgress {
  downloadedBytes: number
  totalBytes: number | null
  percent: number | null
}

export interface AndroidUpdaterBridge {
  getCurrentVersion(): Promise<AndroidAppVersion>
  getInstallPermission(): Promise<{ required: boolean; granted: boolean }>
  openInstallPermissionSettings(): Promise<void>
  downloadApk(options: AndroidDownloadOptions): Promise<{ sizeBytes: number; sha256: string }>
  installDownloadedApk(): Promise<{ status: string }>
  clearDownloadedUpdate(): Promise<void>
  addListener(eventName: 'updateDownloadProgress', callback: (event: AndroidDownloadProgress) => void): Promise<PluginListenerHandle>
}

/** 名称必须与 Android @CapacitorPlugin 注解保持一致。 */
export const AndroidApkUpdater = registerPlugin<AndroidUpdaterBridge>('AndroidApkUpdater')
