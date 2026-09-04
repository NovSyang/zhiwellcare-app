import type { UpdateInfo, UpdateProgress } from './UpdateInfo'

export type UpdatePlatform = 'tauri' | 'android' | 'unsupported'
export type UpdateInstallPermission = 'not-required' | 'granted' | 'denied' | 'unsupported'

/** 平台 Provider 只处理检查、下载和安装，不决定产品更新策略。 */
export interface IUpdateProvider {
  readonly platform: UpdatePlatform
  readonly supported: boolean
  getCurrentVersion(): Promise<string>
  checkForUpdate(): Promise<UpdateInfo | null>
  download(update: UpdateInfo, onProgress?: (progress: UpdateProgress) => void): Promise<void>
  install(): Promise<void>
  getInstallPermission(): Promise<UpdateInstallPermission>
  openInstallPermissionSettings(): Promise<void>
  dispose(): Promise<void>
}
