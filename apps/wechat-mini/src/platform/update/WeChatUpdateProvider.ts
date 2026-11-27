interface UpdateCallbacks {
  onCheck(hasUpdate: boolean): void
  onReady(): void
  onFailed(): void
}

interface UpdateManagerPort {
  onCheckForUpdate(callback: (result: { hasUpdate: boolean }) => void): void
  onUpdateReady(callback: () => void): void
  onUpdateFailed(callback: () => void): void
  applyUpdate(): void
}

export interface MiniUpdateProvider {
  initialize(callbacks: UpdateCallbacks): boolean
  apply(): void
}

/** 封装微信全局管理器，生命周期由应用入口管理。 */
export class WeChatUpdateProvider implements MiniUpdateProvider {
  private manager: UpdateManagerPort | null = null

  constructor(private readonly getManager: () => UpdateManagerPort | undefined) {}

  initialize(callbacks: UpdateCallbacks): boolean {
    const manager = this.getManager()
    if (!manager) return false
    manager.onCheckForUpdate(({ hasUpdate }) => callbacks.onCheck(hasUpdate))
    manager.onUpdateReady(callbacks.onReady)
    manager.onUpdateFailed(callbacks.onFailed)
    this.manager = manager
    return true
  }

  apply() {
    if (!this.manager) throw new Error('微信更新接口不可用。')
    this.manager.applyUpdate()
  }
}
