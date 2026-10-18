import type { IUpdateProvider, UpdateInstallPermission } from './IUpdateProvider'
import type { UpdateInfo, UpdateProgress } from './UpdateInfo'
import { UpdateInstallGuard } from './UpdateInstallGuard'
import type { UpdatePolicy } from './UpdatePolicy'
import { DEFAULT_UPDATE_POLICY } from './UpdatePolicy'
import { UpdatePolicyRepository } from './UpdatePolicyRepository'
import type { UpdateState } from './UpdateState'
import { hasUpdateErrorCode, updateErrorMessage } from './UpdateError'

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
  private initializationReady = false
  private busy: Promise<void> | null = null
  private pendingInstall = false
  private downloadedValid = false
  private appActive = true
  private taskId = 0
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
      else if (this.appActive && this.pendingInstall && this.downloadedValid && this.snapshot.state === 'waiting-install') void this.installUpdate()
      else if (this.appActive && this.snapshot.policy === 'prompt' && this.snapshot.state === 'available') this.snapshot.dialogVisible = true
      this.publish()
    })
  }

  initialize(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    // 首次原生读取失败也只进入更新错误状态；作废失败 Promise，手动检查可以重试。
    this.initialized ??= this.initializeInternal()
      .then(() => { if (!this.disposed) this.initializationReady = true })
      .catch((error) => {
        this.initialized = null
        this.initializationReady = false
        if (!this.disposed) this.setState('error', { errorMessage: updateErrorMessage(error), progress: null, dialogVisible: false })
      })
    return this.initialized
  }

  async handleStartup(): Promise<void> {
    await this.initialize()
    if (!this.initializationReady || !this.provider.supported || this.snapshot.policy === 'manual') return
    await this.checkForUpdate(this.snapshot.policy === 'prompt')
    if (this.snapshot.policy === 'silent' && this.snapshot.state === 'available') {
      await this.downloadAndInstall()
    }
  }

  checkForUpdate(showDialog = true): Promise<void> {
    return this.runExclusive(async () => {
      await this.initialize()
      if (!this.initializationReady || this.disposed) return
      // 重新检查会作废旧文件和安装意图，检查失败也不能继续用上一轮候选。
      this.pendingInstall = false
      this.downloadedValid = false
      this.setState('checking', { info: null, errorMessage: null, progress: null, dialogVisible: false })
      await this.provider.clearDownloadedUpdate?.()
      const info = await this.provider.checkForUpdate()
      if (this.disposed) return
      if (!info) {
        this.setState('up-to-date', { info: null })
        return
      }
      this.setState('available', {
        info,
        dialogVisible: showDialog && this.guard.isSafe() && this.appActive,
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
    return this.runExclusive(async () => {
      // 按钮重复点击不能在下载途中改变意图，也不能安装未经校验的文件。
      if (!this.downloadedValid || !['downloaded', 'waiting-install', 'waiting-permission'].includes(this.snapshot.state)) return
      this.pendingInstall = true
      await this.installWhenAllowed(this.taskId)
    })
  }

  async setPolicy(policy: UpdatePolicy): Promise<void> {
    this.snapshot.policy = policy
    await this.policyRepository.save(policy)
    this.publish()
  }

  dismissDialog(): void {
    // “稍后更新”撤销自动恢复意图，来源授权返回也不会重新弹安装器。
    if (['downloaded', 'waiting-install', 'waiting-permission'].includes(this.snapshot.state)) {
      this.pendingInstall = false
      this.snapshot.state = 'downloaded'
    }
    this.snapshot.dialogVisible = false
    this.publish()
  }

  showDialog(): void {
    if (this.snapshot.info && this.guard.isSafe() && this.appActive) {
      this.snapshot.dialogVisible = true
      this.publish()
    }
  }

  openInstallPermissionSettings(): Promise<void> {
    return this.runExclusive(async () => {
      // 只有用户已经选择安装且文件已校验时才引导来源授权。
      if (!this.downloadedValid || !this.snapshot.info) return
      this.pendingInstall = true
      const permission = await this.provider.getInstallPermission()
      if (this.disposed || !this.pendingInstall) return
      this.snapshot.installPermission = permission
      if (permission !== 'denied') {
        await this.installWhenAllowed(this.taskId)
        return
      }
      this.setState('waiting-permission', { errorMessage: null, dialogVisible: this.guard.isSafe() && this.appActive })
      await this.provider.openInstallPermissionSettings()
    })
  }

  refreshInstallPermission(): Promise<void> {
    return this.runExclusive(async () => {
      if (!this.provider.supported) return
      this.snapshot.installPermission = await this.provider.getInstallPermission()
      if (this.disposed) return
      this.publish()
      // 前台仅恢复有效的授权或安全时机等待任务，失败与取消没有自动重试路径。
      if (this.appActive && this.pendingInstall && this.downloadedValid && this.snapshot.state === 'waiting-permission'
        && this.snapshot.installPermission !== 'denied') await this.installWhenAllowed(this.taskId)
      else if (this.appActive && this.pendingInstall && this.downloadedValid && this.snapshot.state === 'waiting-install') {
        await this.installWhenAllowed(this.taskId)
      }
    })
  }

  /** 生命周期在 await 期间也可能改变，因此后台状态必须立即写入。 */
  setAppActive(active: boolean): Promise<void> {
    this.appActive = active
    if (!active) {
      this.snapshot.dialogVisible = false
      this.publish()
      return Promise.resolve()
    }
    // 回前台可能与授权页打开、安装回调收尾重合；先等待旧任务，再刷新一次。
    const previous = this.busy
    return previous
      ? previous.then(() => { if (this.appActive && !this.disposed) return this.refreshInstallPermission() })
      : this.refreshInstallPermission()
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
    this.pendingInstall = false
    this.downloadedValid = false
    this.taskId += 1
    this.unsubscribeGuard()
    this.snapshotCallbacks.clear()
    // 下载或安装收尾后才销毁 Provider，避免清理文件与写入任务竞争。
    await this.busy
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
    this.downloadedValid = false
    const taskId = this.taskId
    this.setState('downloading', {
      errorMessage: null,
      dialogVisible: this.guard.isSafe() && this.appActive,
      progress: { downloadedBytes: 0, totalBytes: info.sizeBytes, percent: 0 },
    })
    await this.provider.download(info, (progress) => {
      if (!this.isCurrentTask(taskId)) return
      this.snapshot.progress = progress
      this.publish()
    })
    if (!this.isCurrentTask(taskId)) return
    this.downloadedValid = true
    this.setState('downloaded')
    if (installAfterDownload) await this.installWhenAllowed(taskId)
  }

  private async installWhenAllowed(taskId: number): Promise<void> {
    if (!this.isCurrentTask(taskId) || !this.pendingInstall || !this.downloadedValid) return
    if (!this.guard.isSafe() || !this.appActive) {
      this.setState('waiting-install', { dialogVisible: false })
      return
    }
    const permission = await this.provider.getInstallPermission()
    // 检查权限时可能进入训练、转入后台或销毁应用，启动原生安装前再次核验。
    if (!this.isCurrentTask(taskId) || !this.pendingInstall || !this.downloadedValid) return
    this.snapshot.installPermission = permission
    if (!this.guard.isSafe() || !this.appActive) {
      this.setState('waiting-install', { dialogVisible: false })
      return
    }
    if (permission === 'denied') {
      this.setState('waiting-permission', { dialogVisible: true })
      return
    }
    this.setState('installing', { errorMessage: null, dialogVisible: true })
    await this.provider.install()
    if (!this.isCurrentTask(taskId)) return
    this.pendingInstall = false
    this.downloadedValid = false
    const currentVersion = await this.provider.getCurrentVersion()
    const installedVersion = this.snapshot.info?.latestVersion
    await this.provider.clearDownloadedUpdate?.()
    // 某些桌面安装器先返回再重启；以真实版本判断，不能提前伪报新版本。
    this.setState(currentVersion === installedVersion ? 'up-to-date' : 'installed', {
      currentVersion, info: null, progress: null, errorMessage: null, dialogVisible: false,
    })
  }

  private runExclusive(action: () => Promise<void>): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (this.busy) return this.busy
    this.taskId += 1
    // 先占用任务锁再执行，快照回调中的重复点击也无法并发启动操作。
    this.busy = Promise.resolve().then(() => { if (!this.disposed) return action() })
      .catch(async (error) => {
        if (this.disposed) return
        if (hasUpdateErrorCode(error, 'UPDATE_INSTALL_PERMISSION_DENIED') && this.downloadedValid && this.pendingInstall) {
          this.setState('waiting-permission', { installPermission: 'denied', dialogVisible: this.guard.isSafe() && this.appActive })
          return
        }
        this.pendingInstall = false
        if (hasUpdateErrorCode(error, 'UPDATE_INSTALL_CANCELLED') && this.downloadedValid) {
          this.setState('downloaded', { errorMessage: '已取消安装，可手动重试。', dialogVisible: this.guard.isSafe() && this.appActive })
          return
        }
        this.downloadedValid = false
        await this.provider.clearDownloadedUpdate?.().catch(() => undefined)
        this.setState('error', {
          errorMessage: updateErrorMessage(error),
          progress: null,
          dialogVisible: this.guard.isSafe() && this.appActive,
        })
      })
      .finally(() => {
        this.busy = null
        // 解锁可能与旧任务收尾同一时刻发生，锁释放后补一次恢复，避免漏掉事件。
        if (!this.disposed && this.appActive && this.pendingInstall && this.downloadedValid
          && this.snapshot.state === 'waiting-install' && this.guard.isSafe()) void this.installUpdate()
      })
    return this.busy
  }

  /** 销毁或下一轮任务会改变标识，旧异步回调不得再推动状态。 */
  private isCurrentTask(taskId: number): boolean {
    return !this.disposed && taskId === this.taskId
  }

  private setState(state: UpdateState, changes: Partial<AppUpdateSnapshot> = {}): void {
    this.snapshot = { ...this.snapshot, ...changes, state }
    this.publish()
  }

  private publish(): void {
    if (this.disposed) return
    const snapshot = this.getSnapshot()
    for (const callback of this.snapshotCallbacks) callback(snapshot)
  }
}
