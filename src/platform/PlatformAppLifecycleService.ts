import { CapacitorAppLifecycleService } from './capacitor/CapacitorAppLifecycleService'
import { NoopAppLifecycleService } from './lifecycle/NoopAppLifecycleService'
import { TauriAppLifecycleService } from './tauri/TauriAppLifecycleService'
import type { IAppLifecycleService } from './lifecycle/IAppLifecycleService'
import { isAndroidNativeRuntime, isTauriRuntime } from './PlatformRuntime'

/** 页面只订阅统一生命周期，Web 与 Tauri 不加载移动端行为。 */
export function createAppLifecycleService(): IAppLifecycleService {
  // 桌面使用真实窗口状态，避免最小化、隐藏或失焦时启动安装器。
  if (isTauriRuntime()) return new TauriAppLifecycleService()
  return isAndroidNativeRuntime() ? new CapacitorAppLifecycleService() : new NoopAppLifecycleService()
}
