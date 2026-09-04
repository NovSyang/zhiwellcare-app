/** 引用计数锁保证训练、中心确认和 ROM 测量期间不会启动安装器。 */
export class UpdateInstallGuard {
  private locks = new Map<symbol, string>()
  private callbacks = new Set<(safe: boolean) => void>()

  acquire(reason: string): () => void {
    const token = Symbol(reason)
    const wasSafe = this.isSafe()
    this.locks.set(token, reason)
    if (wasSafe) this.publish()
    let released = false
    return () => {
      if (released) return
      released = true
      const wasLocked = !this.isSafe()
      this.locks.delete(token)
      if (wasLocked && this.isSafe()) this.publish()
    }
  }

  isSafe(): boolean {
    return this.locks.size === 0
  }

  onChanged(callback: (safe: boolean) => void): () => void {
    this.callbacks.add(callback)
    callback(this.isSafe())
    return () => this.callbacks.delete(callback)
  }

  private publish(): void {
    const safe = this.isSafe()
    for (const callback of this.callbacks) callback(safe)
  }
}
