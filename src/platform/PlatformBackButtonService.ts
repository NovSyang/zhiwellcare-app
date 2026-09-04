import type { IBackButtonService } from './back/IBackButtonService'
import { NoopBackButtonService } from './back/NoopBackButtonService'
import { CapacitorBackButtonService } from './capacitor/CapacitorBackButtonService'
import { isAndroidNativeRuntime } from './PlatformRuntime'

/** Android 使用 Native Back，其他平台继续由浏览器或窗口系统处理。 */
export function createBackButtonService(): IBackButtonService {
  return isAndroidNativeRuntime() ? new CapacitorBackButtonService() : new NoopBackButtonService()
}
