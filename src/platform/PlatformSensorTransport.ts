import type { ISensorTransport } from '../core/sensor/ISensorTransport'
import { CapacitorBleTransport } from './capacitor/CapacitorBleTransport'
import { TauriBleTransport } from './tauri/TauriBleTransport'
import { WebUnsupportedSensorTransport } from './web/WebUnsupportedSensorTransport'
import { isAndroidNativeRuntime, isTauriRuntime } from './PlatformRuntime'

/** 运行时选择唯一 Transport，业务服务不需要知道当前原生外壳。 */
export function createSensorTransport(): ISensorTransport {
  if (isTauriRuntime()) return new TauriBleTransport()
  if (isAndroidNativeRuntime()) return new CapacitorBleTransport()
  return new WebUnsupportedSensorTransport()
}
