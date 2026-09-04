import { CapacitorAppLifecycleService } from './capacitor/CapacitorAppLifecycleService'
import { NoopAppLifecycleService } from './lifecycle/NoopAppLifecycleService'
import type { IAppLifecycleService } from './lifecycle/IAppLifecycleService'
import { isAndroidNativeRuntime } from './PlatformRuntime'

/** 页面只订阅统一生命周期，Web 与 Tauri 不加载移动端行为。 */
export function createAppLifecycleService(): IAppLifecycleService {
  return isAndroidNativeRuntime() ? new CapacitorAppLifecycleService() : new NoopAppLifecycleService()
}
