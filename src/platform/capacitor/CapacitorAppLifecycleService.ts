import { App } from '@capacitor/app'
import type { PluginListenerHandle } from '@capacitor/core'
import type { IAppLifecycleService } from '../lifecycle/IAppLifecycleService'

/** 将 Capacitor 前后台事件转换为平台无关的 active 布尔值。 */
export class CapacitorAppLifecycleService implements IAppLifecycleService {
  private handles = new Set<PluginListenerHandle>()

  onActiveChanged(callback: (active: boolean) => void): () => void {
    let removed = false
    void App.getState().then(({ isActive }) => { if (!removed) callback(isActive) }).catch(() => {
      // 无法读取 Native 状态时保持默认前台，避免错误暂停训练。
    })
    const pending = App.addListener('appStateChange', ({ isActive }) => callback(isActive))
    void pending.then((handle) => {
      if (removed) void handle.remove().catch(() => undefined)
      else this.handles.add(handle)
    }).catch(() => { /* Listener 注册失败时保持页面现有生命周期。 */ })
    return () => {
      removed = true
      void pending.then((handle) => { this.handles.delete(handle); return handle.remove() }).catch(() => undefined)
    }
  }

  async dispose(): Promise<void> {
    const handles = [...this.handles]
    this.handles.clear()
    await Promise.allSettled(handles.map((handle) => handle.remove()))
  }
}
