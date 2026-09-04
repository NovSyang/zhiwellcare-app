import { Capacitor } from '@capacitor/core'
import { isTauri } from '@tauri-apps/api/core'

/** 平台判断集中维护，避免页面各自猜测当前原生外壳。 */
export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && isTauri()
}

export function isAndroidNativeRuntime(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}
