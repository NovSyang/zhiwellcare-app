import type { IUpdateProvider } from '../../core/update/IUpdateProvider'
import { isAndroidNativeRuntime, isTauriRuntime } from '../PlatformRuntime'
import { AndroidUpdateProvider } from '../capacitor/AndroidUpdateProvider'
import { TauriUpdateProvider } from '../tauri/TauriUpdateProvider'
import { UnsupportedUpdateProvider } from '../web/UnsupportedUpdateProvider'

/** 平台选择顺序与 BLE Transport 保持一致：Tauri、Android Native、浏览器。 */
export function createUpdateProvider(): IUpdateProvider {
  if (isTauriRuntime()) return new TauriUpdateProvider()
  if (isAndroidNativeRuntime()) return new AndroidUpdateProvider()
  return new UnsupportedUpdateProvider()
}
