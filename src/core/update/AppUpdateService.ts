import type { IUpdateProvider, UpdateInstallPermission } from './IUpdateProvider'
import type { UpdateInfo, UpdateProgress } from './UpdateInfo'
import { UpdateInstallGuard } from './UpdateInstallGuard'
import type { UpdatePolicy } from './UpdatePolicy'
import { DEFAULT_UPDATE_POLICY } from './UpdatePolicy'
import { UpdatePolicyRepository } from './UpdatePolicyRepository'
import type { UpdateState } from './UpdateState'

export interface AppUpdateSnapshot {
  platform: IUpdateProvider['platform']
  state: UpdateState
  policy: UpdatePolicy
  currentVersion: string
  info: UpdateInfo | null
  progress: UpdateProgress | null
  installPermission: UpdateInstallPermission
  dialogVisible: boolean
  errorMessage: string | null
  installSafe: boolean
}

/** 统一更新状态机；任何网络或安装错误都只影响更新模块自身。 */
export class AppUpdateService {
  private snapshotCallbacks = new Set<(snapshot: AppUpdateSnapshot) => void>()
  private initialized: Promise<void> | null = null
  private busy: Promise<void> | null = null
  private pendingInstall = false
  private disposed = false
  private unsubscribeGuard: () => void
  private snapshot: AppUpdateSnapshot

  constructor(
    private readonly provider: IUpdateProvider,
    private readonly policyRepository: UpdatePolicyRepository,
    private readonly guard: UpdateInstallGuard,
  ) {
    this.snapshot = {
      platform: provider.platform,
      state: provider.supported ? 'idle' : 'unsupported',
      policy: DEFAULT_UPDATE_POLICY,
      currentVersion: '',
      info: null,
      progress: null,
      installPermission: provider.supported ? 'not-required' : 'unsupported',
      dialogVisible: false,
      errorMessage: null,
      installSafe: guard.isSafe(),
    }
    this.unsubscribeGuard = guard.onChanged((safe) => {
      this.snapshot.installSafe = safe
      if (!safe) this.snapshot.dialogVisible = false
      // 下载完成并进入等待状态后才响应解锁，避免下载过程中提前启动安装器。
      else if (this.pendingInstall && this.snapshot.state === 'waiting-install') void this.installUpdate()
      else if (this.snapshot.policy === 'prompt' && this.snapshot.state === 'available') this.snapshot.dialogVisible = true
      this.publish()
    })
  }

  initialize(): Promise<void> {
    this.initialized ??= this.initializeInternal()
    return this.initialized
  }

  async handleStartup(): Promise<void> {
    await this.initialize()
    if (!this.provider.supported || this.snapshot.policy === 'manual') return
    await this.checkForUpdate(this.snapshot.policy === 'prompt')
    if (this.snapshot.policy === 'silent' && this.snapshot.state === 'available') {
      await this.downloadAndInstall()
    }
  }

  checkForUpdate(showDialog = true): Promise<void> {
    return this.runExclusive(async () => {
      await this.initialize()
      this.setState('checking', { errorMessage: null, progress: null, dialogVisible: false })
      const info = await this.provider.checkForUpdate()
      if (!info) {
        this.setState('up-to-date', { info: null })
        return
      }
      this.setState('available', {
        info,
        dialogVisible: showDialog && this.guard.isSafe(),
      })
    })
  }

  downloadUpdate(): Promise<void> {
    return this.runExclusive(() => this.downloadInternal(false))
  }

  downloadAndInstall(): Promise<void> {
    return this.runExclusive(() => this.downloadInternal(true))
  }

  installUpdate(): Promise<void> {
    this.pendingInstall = true
    return this.runExclusive(() => this.installWhenAllowed())
  }

  async setPolicy(policy: UpdatePolicy): Promise<void> {
    this.snapshot.policy = policy
    await this.policyRepository.save(policy)
    this.publish()
  }

  dismissDialog(): void {
    this.snapshot.dialogVisible = false
    this.publish()
  }

  showDialog(): void {
    if (this.snapshot.info && this.guard.isSafe()) {
      this.snapshot.dialogVisible = true
      this.publish()
    }
  }

  async openInstallPermissionSettings(): Promise<void> {
    await this.provider.openInstallPermissionSettings()
  }

  async refreshInstallPermission(): Promise<void> {
    if (!this.provider.supported) return
    this.snapshot.installPermission = await this.provider.getInstallPermission()
    this.publish()
    if (this.pendingInstall && this.snapshot.installPermission !== 'denied') await this.installUpdate()
  }

  onSnapshot(callback: (snapshot: AppUpdateSnapshot) => void): () => void {
    this.snapshotCallbacks.add(callback)
    callback(this.getSnapshot())
    return () => this.snapshotCallbacks.delete(callback)
  }

  getSnapshot(): AppUpdateSnapshot {
    return structuredClone(this.snapshot)
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribeGuard()
    this.snapshotCallbacks.clear()
    await this.provider.dispose()
  }

  private async initializeInternal(): Promise<void> {
    const [policy, currentVersion, installPermission] = await Promise.all([
      this.policyRepository.load(),
      this.provider.getCurrentVersion(),
      this.provider.getInstallPermission(),
    ])
    this.snapshot.policy = policy
    this.snapshot.currentVersion = currentVersion
    this.snapshot.installPermission = installPermission
    this.publish()
  }

  private async downloadInternal(installAfterDownload: boolean): Promise<void> {
    const info = this.snapshot.info
    if (!info) throw new Error('当前没有可下载的更新。')
    this.pendingInstall = installAfterDownload
    this.setState('downloading', {
      errorMessage: null,
      dialogVisible: this.guard.isSafe(),
      progress: { downloadedBytes: 0, totalBytes: info.sizeBytes, percent: 0 },
    })
    await this.provider.download(info, (progress) => {
      this.snapshot.progress = progress
      this.publish()
    })
    this.setState('downloaded')
    if (installAfterDownload) await this.installWhenAllowed()
  }

  private async installWhenAllowed(): Promise<void> {
    if (!this.pendingInstall) return
    if (!this.guard.isSafe()) {
      this.setState('waiting-install', { dialogVisible: false })
      return
    }
    const permission = await this.provider.getInstallPermission()
    this.snapshot.installPermission = permission
    if (permission === 'denied') {
      this.setState('waiting-install', { dialogVisible: true })
      return
    }
    this.setState('installing', { dialogVisible: true })
    await this.provider.install()
    this.pendingInstall = false
  }

  private runExclusive(action: () => Promise<void>): Promise<void> {
    if (this.busy) return this.busy
    this.busy = action()
      .catch((error) => {
        this.setState('error', {
          errorMessage: error instanceof Error ? error.message : String(error),
          dialogVisible: this.guard.isSafe(),
        })
      })
      .finally(() => { this.busy = null })
    return this.busy
  }

  private setState(state: UpdateState, changes: Partial<AppUpdateSnapshot> = {}): void {
    this.snapshot = { ...this.snapshot, ...changes, state }
    this.publish()
  }

  private publish(): void {
    const snapshot = this.getSnapshot()
    for (const callback of this.snapshotCallbacks) callback(snapshot)
  }
}
