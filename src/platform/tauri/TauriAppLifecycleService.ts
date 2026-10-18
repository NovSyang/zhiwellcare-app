import { TauriEvent, type UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWindow, type Window as NativeWindow } from '@tauri-apps/api/window'
import type { IAppLifecycleService } from '../lifecycle/IAppLifecycleService'

/** 只使用锁定 Tauri API 中的窗口查询和单项监听，避免组合监听部分注册失败后泄漏。 */
export type TauriLifecycleWindow = Pick<NativeWindow, 'isVisible' | 'isMinimized' | 'isFocused' | 'listen'>

interface LifecycleEventTarget {
  addEventListener(type: string, listener: EventListener): void
  removeEventListener(type: string, listener: EventListener): void
}

export interface TauriLifecycleOptions {
  window?: TauriLifecycleWindow
  windowEvents?: LifecycleEventTarget | null
  documentEvents?: (LifecycleEventTarget & { visibilityState: DocumentVisibilityState }) | null
  /** 生产定时核对隐藏、最小化状态；测试可设为 0，仅使用可控事件。 */
  pollIntervalMs?: number
}

/** 桌面窗口可见、未最小化且真正聚焦时才视为前台，未知状态保守视为后台。 */
export class TauriAppLifecycleService implements IAppLifecycleService {
  private readonly nativeWindow: TauriLifecycleWindow
  private readonly windowEvents: LifecycleEventTarget | null
  private readonly documentEvents: (LifecycleEventTarget & { visibilityState: DocumentVisibilityState }) | null
  private readonly pollIntervalMs: number
  private callbacks = new Set<(active: boolean) => void>()
  private unlisteners = new Set<UnlistenFn>()
  private registrations = new Set<Promise<boolean>>()
  private cleanups = new Set<Promise<void>>()
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private active = false
  private monitoring = false
  private listenersReady = false
  private disposed = false
  private generation = 0
  private revision = 0
  private refreshing = false
  private refreshRequested = false

  constructor(options: TauriLifecycleOptions = {}) {
    this.nativeWindow = options.window ?? getCurrentWindow()
    this.windowEvents = options.windowEvents === undefined ? (typeof window === 'undefined' ? null : window) : options.windowEvents
    this.documentEvents = options.documentEvents === undefined ? (typeof document === 'undefined' ? null : document) : options.documentEvents
    this.pollIntervalMs = options.pollIntervalMs ?? 1000
  }

  onActiveChanged(callback: (active: boolean) => void): () => void {
    if (this.disposed) { callback(false); return () => undefined }
    this.callbacks.add(callback)
    // 初始化查询完成前立即阻止安装，新订阅复用已有的可信窗口状态。
    callback(this.active)
    if (!this.monitoring) this.startMonitoring()
    let removed = false
    return () => {
      if (removed) return
      removed = true
      this.callbacks.delete(callback)
      if (this.callbacks.size === 0) this.stopMonitoring()
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.callbacks.clear()
    this.stopMonitoring()
    // 未返回的监听句柄到达后仍需移除，再等待其异步原生清理结束。
    await Promise.allSettled([...this.registrations])
    await Promise.allSettled([...this.cleanups])
  }

  private startMonitoring(): void {
    this.monitoring = true
    this.listenersReady = false
    const generation = ++this.generation
    this.windowEvents?.addEventListener('blur', this.onBackground)
    this.windowEvents?.addEventListener('focus', this.onForeground)
    this.documentEvents?.addEventListener('visibilitychange', this.onVisibilityChanged)
    const registrations = [
      this.register(TauriEvent.WINDOW_BLUR, () => this.background(generation), generation),
      this.register(TauriEvent.WINDOW_FOCUS, () => this.foreground(generation), generation),
      this.register(TauriEvent.WINDOW_RESIZED, (payload) => this.resized(generation, payload), generation),
      this.register(TauriEvent.WINDOW_DESTROYED, () => this.background(generation), generation),
    ]
    // 查询必须排在监听注册之后，避免初始查询期间漏掉一次失焦事件。
    void Promise.all(registrations).then((ready) => {
      if (!this.isCurrent(generation)) return
      this.listenersReady = ready.every(Boolean)
      if (this.listenersReady) this.refresh(generation)
    })
    if (this.pollIntervalMs > 0) {
      this.pollTimer = setInterval(() => this.refresh(generation), this.pollIntervalMs)
    }
  }

  private stopMonitoring(): void {
    this.monitoring = false
    this.listenersReady = false
    this.active = false
    this.generation += 1
    this.revision += 1
    this.refreshRequested = false
    if (this.pollTimer !== null) clearInterval(this.pollTimer)
    this.pollTimer = null
    this.windowEvents?.removeEventListener('blur', this.onBackground)
    this.windowEvents?.removeEventListener('focus', this.onForeground)
    this.documentEvents?.removeEventListener('visibilitychange', this.onVisibilityChanged)
    for (const unlisten of this.unlisteners) this.cleanup(unlisten)
    this.unlisteners.clear()
  }

  private register(event: TauriEvent, callback: (payload: unknown) => void, generation: number): Promise<boolean> {
    const registration = Promise.resolve().then(() => this.nativeWindow.listen<unknown>(event, ({ payload }) => {
      if (this.isCurrent(generation)) callback(payload)
    })).then((unlisten) => {
      if (!this.isCurrent(generation)) { this.cleanup(unlisten); return false }
      this.unlisteners.add(unlisten)
      return true
    }).catch(() => false).finally(() => { this.registrations.delete(registration) })
    this.registrations.add(registration)
    return registration
  }

  private cleanup(unlisten: UnlistenFn): void {
    try {
      // API 类型返回 void，实际实现可能返回 Promise，统一等待且避免未处理拒绝。
      const cleanup = Promise.resolve(unlisten()).catch(() => undefined).finally(() => { this.cleanups.delete(cleanup) })
      this.cleanups.add(cleanup)
    } catch { /* 原生窗口已销毁时，移除失败也不能再推送生命周期。 */ }
  }

  private readonly onBackground: EventListener = () => this.background(this.generation)
  private readonly onForeground: EventListener = () => this.foreground(this.generation)
  private readonly onVisibilityChanged: EventListener = () => {
    if (this.documentEvents?.visibilityState === 'hidden') this.background(this.generation)
    else this.foreground(this.generation)
  }

  private background(generation: number): void {
    if (!this.isCurrent(generation)) return
    this.revision += 1
    // 失焦立即通知更新状态机，不等任何异步查询，阻止 await 期间启动安装器。
    this.setActive(false)
  }

  private foreground(generation: number): void {
    if (!this.isCurrent(generation)) return
    this.revision += 1
    // 聚焦事件本身不足以证明窗口可见，恢复前再次核对三项原生状态。
    this.refresh(generation)
  }

  private resized(generation: number, payload: unknown): void {
    if (!this.isCurrent(generation)) return
    this.revision += 1
    // 最小化的零尺寸立即阻止安装；普通拖动尺寸只复核，避免无故暂停训练。
    if (typeof payload === 'object' && payload !== null && 'width' in payload && 'height' in payload
      && typeof payload.width === 'number' && typeof payload.height === 'number'
      && (payload.width <= 0 || payload.height <= 0)) this.setActive(false)
    this.refresh(generation)
  }

  private refresh(generation: number): void {
    if (!this.isCurrent(generation) || !this.listenersReady) return
    if (this.refreshing) { this.refreshRequested = true; return }
    this.refreshing = true
    const revision = this.revision
    void Promise.all([this.nativeWindow.isVisible(), this.nativeWindow.isMinimized(), this.nativeWindow.isFocused()])
      .then(([visible, minimized, focused]) => {
        // 查询返回前若发生失焦或切换订阅，旧结果不得覆盖新的后台状态。
        if (this.isCurrent(generation) && revision === this.revision) {
          this.setActive(visible && !minimized && focused && this.documentEvents?.visibilityState !== 'hidden')
        }
      }).catch(() => {
        if (this.isCurrent(generation) && revision === this.revision) this.setActive(false)
      }).finally(() => {
        this.refreshing = false
        if (this.refreshRequested) {
          this.refreshRequested = false
          this.refresh(this.generation)
        }
      })
  }

  private isCurrent(generation: number): boolean {
    return !this.disposed && this.monitoring && generation === this.generation
  }

  private setActive(active: boolean): void {
    if (this.active === active) return
    this.active = active
    for (const callback of this.callbacks) callback(active)
  }
}
