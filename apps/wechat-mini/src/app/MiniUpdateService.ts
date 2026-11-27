import type { MiniUpdateProvider } from '../platform/update/WeChatUpdateProvider'
import type { MiniOperationSafety } from './MiniOperationSafety'

type UpdateState = 'waiting-check' | 'up-to-date' | 'downloading' | 'ready' | 'failed' | 'applying' | 'unsupported'

/** 微信下载状态独立于安全门，全局只保留一个确认窗口。 */
export class MiniUpdateService {
  private initialized = false
  private state: UpdateState = 'waiting-check'
  private promptOpen = false
  private deferredEpoch = -1
  private error = ''
  private queued = false
  private watchdog: ReturnType<typeof setTimeout> | undefined
  private finishApply: (() => void) | undefined
  private disposed = false
  private readonly listeners = new Set<(snapshot: ReturnType<MiniUpdateService['getSnapshot']>) => void>()
  private readonly unsubscribe: () => void

  constructor(
    private readonly provider: MiniUpdateProvider,
    private readonly safety: MiniOperationSafety,
    private readonly confirm: () => Promise<boolean>,
    private readonly cleanup: () => Promise<void>,
    private readonly timeoutMs = 8000,
  ) {
    this.unsubscribe = safety.onChanged(() => {
      if (this.finishApply && !safety.getSnapshot().foreground) this.clearWatchdog()
      this.changed()
    })
  }

  initialize() {
    if (this.initialized || this.disposed) return
    this.initialized = true
    try {
      const supported = this.provider.initialize({
        onCheck: (hasUpdate) => {
          if (this.state !== 'waiting-check') return
          this.state = hasUpdate ? 'downloading' : 'up-to-date'
          this.changed()
        },
        onReady: () => {
          if (this.state === 'ready' || this.state === 'applying' || this.state === 'unsupported') return
          this.state = 'ready'
          this.error = ''
          this.changed()
        },
        onFailed: () => {
          if (this.state === 'ready' || this.state === 'applying' || this.state === 'unsupported') return
          this.state = 'failed'
          this.changed()
        },
      })
      if (!supported) this.state = 'unsupported'
    } catch { this.state = 'unsupported' }
    this.changed()
  }

  onForeground() {
    // applyUpdate 返回 void。如果旧进程再次回到前台，由用户决定是否再次尝试。
    if (this.finishApply && this.watchdog === undefined) this.finishApply()
    this.changed()
  }

  getSnapshot() {
    const { safe, foreground, visibleRoute, applying } = this.safety.getSnapshot()
    return { state: this.state, safe, foreground, visibleRoute, applying, promptOpen: this.promptOpen,
      error: this.error, canRequest: this.state === 'ready' && safe && !this.promptOpen }
  }

  onChanged(listener: (snapshot: ReturnType<MiniUpdateService['getSnapshot']>) => void) {
    this.listeners.add(listener)
    listener(this.getSnapshot())
    return () => this.listeners.delete(listener)
  }

  async request(manual = false) {
    const initial = this.safety.getSnapshot()
    if (this.disposed || !this.getSnapshot().canRequest || (!manual && this.deferredEpoch === initial.epoch)) return
    this.promptOpen = true
    this.error = ''
    this.changed()
    let release: (() => void) | null = null
    try {
      const accepted = await this.confirm()
      const current = this.safety.getSnapshot()
      if (this.disposed || !accepted || !current.safe || current.revision !== initial.revision) {
        // 旧确认结果不立即重开弹窗，下一安全周期或手动请求会重新确认。
        this.deferredEpoch = current.foreground ? current.epoch : initial.epoch
        return
      }
      release = this.safety.beginApply()
      if (release) {
        this.deferredEpoch = current.epoch
        this.state = 'applying'
      }
    } catch {
      this.deferredEpoch = initial.epoch
      this.error = '暂时无法打开更新确认，请稍后重试。'
    } finally {
      this.promptOpen = false
      this.changed()
    }
    if (release) await this.apply(release, this.safety.getSnapshot().revision)
  }

  private async apply(release: () => void, revision: number) {
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      // 超时后先报告，真实原生清理完成前仍然保留独占门。
      timeout = setTimeout(() => {
        this.state = 'ready'
        this.error = '蓝牙清理耗时较长，完成后可再次确认更新。'
        this.changed()
      }, this.timeoutMs)
      await this.cleanup()
      const current = this.safety.getSnapshot()
      if (this.disposed || this.state !== 'applying' || !current.safePage
        || current.revision !== revision || !this.safety.guard.isSafe()) {
        this.state = 'ready'
        this.error ||= '应用更新已暂缓，请在前台再次确认。'
        return
      }
      this.provider.apply()
      this.finishApply = () => {
        this.clearWatchdog()
        this.finishApply = undefined
        this.state = 'ready'
        this.deferredEpoch = this.safety.getSnapshot().epoch
        this.error = '微信未重新打开小程序，可稍后再次确认更新。'
        release()
        this.changed()
      }
      if (this.safety.getSnapshot().foreground) this.watchdog = setTimeout(this.finishApply, this.timeoutMs)
    } catch {
      this.state = 'ready'
      this.error = '暂时无法应用更新，请稍后重试。'
    } finally {
      if (timeout !== undefined) clearTimeout(timeout)
      if (!this.finishApply) {
        this.deferredEpoch = this.safety.getSnapshot().epoch
        release()
      }
      this.changed()
    }
  }

  dispose() {
    this.disposed = true
    this.unsubscribe()
    this.finishApply?.()
    this.listeners.clear()
  }

  private clearWatchdog() {
    if (this.watchdog !== undefined) clearTimeout(this.watchdog)
    this.watchdog = undefined
  }

  private changed() {
    if (this.disposed) return
    const snapshot = this.getSnapshot()
    for (const listener of this.listeners) listener(snapshot)
    if (this.queued || !snapshot.canRequest || this.deferredEpoch === this.safety.getSnapshot().epoch) return
    this.queued = true
    void Promise.resolve().then(() => {
      this.queued = false
      return this.request()
    })
  }
}
