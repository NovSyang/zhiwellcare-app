import type { IUpdateProvider, UpdateInstallPermission } from '../../core/update/IUpdateProvider'
import type { UpdateInfo, UpdateProgress } from '../../core/update/UpdateInfo'
import releaseVersion from '../../../release-version.json'

const MESSAGE = '浏览器预览环境不支持应用在线更新，请在 Windows 或 Android 原生应用中操作。'

/** 浏览器保留设置预览能力，但不会伪装成已经是最新版本。 */
export class UnsupportedUpdateProvider implements IUpdateProvider {
  readonly platform = 'unsupported' as const
  readonly supported = false

  async getCurrentVersion(): Promise<string> { return releaseVersion.productVersion }
  async checkForUpdate(): Promise<UpdateInfo | null> { throw new Error(MESSAGE) }
  async download(_update: UpdateInfo, _onProgress?: (progress: UpdateProgress) => void): Promise<void> { throw new Error(MESSAGE) }
  async install(): Promise<void> { throw new Error(MESSAGE) }
  async getInstallPermission(): Promise<UpdateInstallPermission> { return 'unsupported' }
  async openInstallPermissionSettings(): Promise<void> { throw new Error(MESSAGE) }
  async dispose(): Promise<void> {}
}
