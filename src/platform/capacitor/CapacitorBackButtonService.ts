import { App } from '@capacitor/app'
import type { PluginListenerHandle } from '@capacitor/core'
import type { IBackButtonService, NativeBackEvent } from '../back/IBackButtonService'

/** Android 返回键统一交给 Vue 应用处理，避免训练被直接销毁。 */
export class CapacitorBackButtonService implements IBackButtonService {
  private handles = new Set<PluginListenerHandle>()

  onBack(callback: (event: NativeBackEvent) => void): () => void {
    let removed = false
    const pending = App.addListener('backButton', callback)
    void pending.then((handle) => {
      if (removed) void handle.remove().catch(() => undefined)
      else this.handles.add(handle)
    }).catch(() => { /* 注册失败时由 Android WebView 使用默认行为。 */ })
    return () => {
      removed = true
      void pending.then((handle) => { this.handles.delete(handle); return handle.remove() }).catch(() => undefined)
    }
  }

  async minimizeApp(): Promise<void> { await App.minimizeApp() }

  async dispose(): Promise<void> {
    const handles = [...this.handles]
    this.handles.clear()
    await Promise.allSettled(handles.map((handle) => handle.remove()))
  }
}
