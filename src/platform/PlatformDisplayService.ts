import type { IDisplayService } from './display/IDisplayService'
import { NoopDisplayService } from './display/NoopDisplayService'
import { CapacitorDisplayService } from './capacitor/CapacitorDisplayService'
import { isAndroidNativeRuntime } from './PlatformRuntime'

/** 只有 Android Native 需要控制方向与常亮。 */
export function createDisplayService(): IDisplayService {
  return isAndroidNativeRuntime() ? new CapacitorDisplayService() : new NoopDisplayService()
}
