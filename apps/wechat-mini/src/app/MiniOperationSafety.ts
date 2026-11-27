import { UpdateInstallGuard } from '../../../../src/core/update/UpdateInstallGuard'

const promptRoutes = new Set([
  'pages/device/index', 'pages/training/index', 'pages/courses/index',
  'pages/shop/index', 'pages/profile/index', 'features/training/result/index',
])

/** 页面可见性、普通业务锁和应用更新独占门共用同一份状态。 */
export class MiniOperationSafety {
  readonly guard = new UpdateInstallGuard()
  private owner: symbol | null = null
  private route = ''
  private foreground = false
  private applying = false
  private epoch = 0
  private revision = 0
  private readonly listeners = new Set<() => void>()

  constructor(private readonly currentRoute: () => string) {
    this.guard.onChanged(() => this.changed())
  }

  getSnapshot() {
    const visibleRoute = this.route
    const safePage = this.foreground && promptRoutes.has(visibleRoute) && this.currentRoute() === visibleRoute
    return { foreground: this.foreground, visibleRoute, epoch: this.epoch, revision: this.revision,
      applying: this.applying, safe: safePage && this.guard.isSafe() && !this.applying, safePage }
  }

  setForeground(visible: boolean) {
    if (this.foreground === visible) return
    this.foreground = visible
    if (visible) this.epoch += 1
    this.changed()
  }

  show(owner: symbol, route: string) {
    if (this.owner === owner && this.route === route) return
    this.owner = owner
    this.route = route
    this.changed()
  }

  hide(owner: symbol) {
    if (this.owner !== owner) return
    this.owner = null
    this.route = ''
    this.changed()
  }

  acquire(reason: string): () => void {
    this.checkAvailable()
    return this.guard.acquire(reason)
  }

  checkAvailable() {
    if (this.applying) throw new Error('正在应用更新，请稍后重试。')
  }

  async withLock<T>(reason: string, action: () => Promise<T>): Promise<T> {
    const release = this.acquire(reason)
    try { return await action() } finally { release() }
  }

  beginApply(): (() => void) | null {
    if (!this.getSnapshot().safe) return null
    this.applying = true
    this.changed()
    let released = false
    return () => {
      if (released) return
      released = true
      this.applying = false
      this.changed()
    }
  }

  onChanged(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private changed() {
    this.revision += 1
    for (const listener of this.listeners) listener()
  }
}
