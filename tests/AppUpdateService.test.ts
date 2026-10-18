import { describe, expect, it, vi } from 'vitest'
import type { IKeyValueStore } from '../src/core/storage/IKeyValueStore'
import { AppUpdateService } from '../src/core/update/AppUpdateService'
import type { IUpdateProvider, UpdateInstallPermission } from '../src/core/update/IUpdateProvider'
import type { UpdateInfo, UpdateProgress } from '../src/core/update/UpdateInfo'
import { UpdateInstallGuard } from '../src/core/update/UpdateInstallGuard'
import { UpdatePolicyRepository } from '../src/core/update/UpdatePolicyRepository'
import { UpdateError } from '../src/core/update/UpdateError'

const availableUpdate: UpdateInfo = {
  currentVersion: '0.8.0', latestVersion: '0.8.1', displayVersion: '0.8.1',
  notes: ['修复问题'], publishedAt: '2026-08-26T00:00:00Z', sizeBytes: 100,
}

class MemoryStore implements IKeyValueStore {
  constructor(private value: string | null = null) {}
  async get(): Promise<string | null> { return this.value }
  async set(_key: string, value: string): Promise<void> { this.value = value }
  async remove(): Promise<void> { this.value = null }
}

class FakeProvider implements IUpdateProvider {
  readonly platform = 'android' as const
  readonly supported = true
  checkResult: UpdateInfo | null = availableUpdate
  checkError: Error | null = null
  checkCalls = 0
  downloadCalls = 0
  installCalls = 0
  clearCalls = 0
  disposeCalls = 0
  permissionSettingsCalls = 0
  downloadError: Error | null = null
  installError: Error | null = null
  currentVersion = '0.8.0'
  permission: UpdateInstallPermission = 'granted'
  async getCurrentVersion(): Promise<string> { return this.currentVersion }
  async checkForUpdate(): Promise<UpdateInfo | null> { this.checkCalls += 1; if (this.checkError) throw this.checkError; return this.checkResult }
  // 可识别的下载、安装错误用于验证失败和取消不会留下自动重试意图。
  async download(_update: UpdateInfo, onProgress?: (progress: UpdateProgress) => void): Promise<void> {
    this.downloadCalls += 1
    if (this.downloadError) throw this.downloadError
    onProgress?.({ downloadedBytes: 100, totalBytes: 100, percent: 100 })
  }
  async install(): Promise<void> {
    this.installCalls += 1
    if (this.installError) throw this.installError
    this.currentVersion = availableUpdate.latestVersion
  }
  async getInstallPermission(): Promise<UpdateInstallPermission> { return this.permission }
  async openInstallPermissionSettings(): Promise<void> { this.permissionSettingsCalls += 1 }
  async clearDownloadedUpdate(): Promise<void> { this.clearCalls += 1 }
  async dispose(): Promise<void> { this.disposeCalls += 1 }
}

/** 可控下载用于复现训练锁在下载尚未完成时释放的并发边界。 */
class DeferredDownloadProvider extends FakeProvider {
  private finishDownload: (() => void) | null = null
  override async download(): Promise<void> {
    this.downloadCalls += 1
    await new Promise<void>((resolve) => { this.finishDownload = resolve })
  }
  finish(): void { this.finishDownload?.() }
}

/** 暂停来源权限读取，以复现 await 期间进入训练或退到后台的情况。 */
class DeferredPermissionProvider extends FakeProvider {
  blockPermission = false
  waiting = false
  private finishPermission: ((value: UpdateInstallPermission) => void) | null = null
  override async getInstallPermission(): Promise<UpdateInstallPermission> {
    if (!this.blockPermission) return this.permission
    this.waiting = true
    return new Promise((resolve) => { this.finishPermission = resolve })
  }
  finish(): void {
    this.blockPermission = false
    this.finishPermission?.(this.permission)
  }
}

function service(policy: string | null = null) {
  const provider = new FakeProvider()
  const guard = new UpdateInstallGuard()
  return {
    provider,
    guard,
    updateService: new AppUpdateService(provider, new UpdatePolicyRepository(new MemoryStore(policy)), guard),
  }
}

describe('AppUpdateService', () => {
  it('prompt 启动只检查并显示更新，不自动下载', async () => {
    const context = service('prompt')
    await context.updateService.handleStartup()
    expect(context.updateService.getSnapshot()).toMatchObject({ state: 'available', dialogVisible: true })
    expect(context.provider.downloadCalls).toBe(0)
  })

  it('manual 启动不访问更新端点', async () => {
    const context = service('manual')
    await context.updateService.handleStartup()
    expect(context.provider.checkCalls).toBe(0)
    expect(context.updateService.getSnapshot().state).toBe('idle')
  })

  it('silent 可下载但等待训练锁释放后才安装', async () => {
    const context = service('silent')
    const release = context.guard.acquire('training')
    await context.updateService.handleStartup()
    expect(context.updateService.getSnapshot().state).toBe('waiting-install')
    expect(context.provider.downloadCalls).toBe(1)
    expect(context.provider.installCalls).toBe(0)
    release()
    await vi.waitFor(() => expect(context.provider.installCalls).toBe(1))
  })

  it('网络错误只进入更新 error 状态', async () => {
    const context = service('prompt')
    context.provider.checkError = new Error('network down')
    await context.updateService.handleStartup()
    expect(context.updateService.getSnapshot()).toMatchObject({ state: 'error', errorMessage: 'network down' })
  })

  it('初始化原生读取失败进入可见错误，下一次检查可以重新初始化恢复', async () => {
    const context = service('prompt')
    // 模拟一次临时桥接异常，失败 Promise 不得永久阻止后续人工重试。
    vi.spyOn(context.provider, 'getCurrentVersion').mockRejectedValueOnce(new Error('原生版本读取暂时失败'))
    await expect(context.updateService.handleStartup()).resolves.toBeUndefined()
    expect(context.updateService.getSnapshot()).toMatchObject({ state: 'error', info: null, errorMessage: '原生版本读取暂时失败' })
    expect(context.provider.checkCalls).toBe(0)
    await context.updateService.checkForUpdate()
    expect(context.provider.checkCalls).toBe(1)
    expect(context.updateService.getSnapshot()).toMatchObject({ state: 'available', currentVersion: '0.8.0', errorMessage: null })
  })

  it('并发检查复用同一任务，失败后可以重新检查恢复', async () => {
    const context = service('prompt')
    await Promise.all([
      context.updateService.checkForUpdate(true),
      context.updateService.checkForUpdate(true),
    ])
    expect(context.provider.checkCalls).toBe(1)

    context.provider.checkError = new Error('temporary failure')
    await context.updateService.checkForUpdate(true)
    expect(context.updateService.getSnapshot().state).toBe('error')
    context.provider.checkError = null
    await context.updateService.checkForUpdate(true)
    expect(context.updateService.getSnapshot().state).toBe('available')
  })

  it('下载期间释放训练锁不会提前安装', async () => {
    const provider = new DeferredDownloadProvider()
    const guard = new UpdateInstallGuard()
    const updateService = new AppUpdateService(provider, new UpdatePolicyRepository(new MemoryStore('silent')), guard)
    const release = guard.acquire('training')
    const startup = updateService.handleStartup()
    await vi.waitFor(() => expect(provider.downloadCalls).toBe(1))

    release()
    await Promise.resolve()
    expect(provider.installCalls).toBe(0)

    provider.finish()
    await startup
    expect(provider.installCalls).toBe(1)
  })

  it('下载失败回前台或释放训练锁都不会自动安装', async () => {
    const context = service('manual')
    await context.updateService.checkForUpdate()
    const release = context.guard.acquire('training')
    context.provider.downloadError = new Error('下载校验失败')
    await context.updateService.downloadAndInstall()
    release()
    await context.updateService.refreshInstallPermission()
    expect(context.provider.installCalls).toBe(0)
    expect(context.updateService.getSnapshot()).toMatchObject({ state: 'error', errorMessage: '下载校验失败', progress: null })
    expect(context.provider.clearCalls).toBeGreaterThan(0)
  })

  it('安装失败撤销自动意图，重新检查下载后可以恢复', async () => {
    const context = service('manual')
    await context.updateService.checkForUpdate()
    context.provider.installError = new Error('系统空间不足')
    await context.updateService.downloadAndInstall()
    await context.updateService.refreshInstallPermission()
    await context.updateService.installUpdate()
    expect(context.provider.installCalls).toBe(1)
    expect(context.updateService.getSnapshot().state).toBe('error')
    context.provider.installError = null
    await context.updateService.checkForUpdate()
    await context.updateService.downloadAndInstall()
    expect(context.provider.installCalls).toBe(2)
    expect(context.updateService.getSnapshot()).toMatchObject({ state: 'up-to-date', info: null, currentVersion: '0.8.1' })
  })

  it('系统取消保留可手动重试状态，回前台不会再次弹安装器', async () => {
    const context = service('manual')
    await context.updateService.checkForUpdate()
    context.provider.installError = new UpdateError('用户取消', 'UPDATE_INSTALL_CANCELLED')
    await context.updateService.downloadAndInstall()
    await context.updateService.refreshInstallPermission()
    expect(context.provider.installCalls).toBe(1)
    expect(context.updateService.getSnapshot()).toMatchObject({ state: 'downloaded', errorMessage: '已取消安装，可手动重试。' })
    context.provider.installError = null
    await context.updateService.installUpdate()
    expect(context.provider.installCalls).toBe(2)
  })

  it('只恢复有效来源授权任务，重复返回前台只安装一次', async () => {
    const context = service('manual')
    context.provider.permission = 'denied'
    await context.updateService.checkForUpdate()
    await context.updateService.downloadAndInstall()
    expect(context.updateService.getSnapshot().state).toBe('waiting-permission')
    await context.updateService.refreshInstallPermission()
    expect(context.provider.installCalls).toBe(0)
    expect(context.provider.permissionSettingsCalls).toBe(0)
    await context.updateService.openInstallPermissionSettings()
    expect(context.provider.permissionSettingsCalls).toBe(1)
    context.provider.permission = 'granted'
    await Promise.all([context.updateService.refreshInstallPermission(), context.updateService.refreshInstallPermission()])
    await context.updateService.refreshInstallPermission()
    expect(context.provider.installCalls).toBe(1)
  })

  it('选择稍后更新会撤销来源授权的自动恢复意图', async () => {
    const context = service('manual')
    context.provider.permission = 'denied'
    await context.updateService.checkForUpdate()
    await context.updateService.downloadAndInstall()
    context.updateService.dismissDialog()
    context.provider.permission = 'granted'
    await context.updateService.refreshInstallPermission()
    expect(context.provider.installCalls).toBe(0)
    expect(context.updateService.getSnapshot().state).toBe('downloaded')
  })

  it('原生安装时权限被撤回会等待授权，授权后再恢复', async () => {
    const context = service('manual')
    await context.updateService.checkForUpdate()
    context.provider.installError = new UpdateError('需要来源授权', 'UPDATE_INSTALL_PERMISSION_DENIED')
    await context.updateService.downloadAndInstall()
    expect(context.updateService.getSnapshot()).toMatchObject({ state: 'waiting-permission', installPermission: 'denied' })
    context.provider.installError = null
    await context.updateService.refreshInstallPermission()
    expect(context.provider.installCalls).toBe(2)
  })

  it('权限 await 期间进入训练，原生安装前再次检查锁', async () => {
    const provider = new DeferredPermissionProvider()
    const guard = new UpdateInstallGuard()
    const updateService = new AppUpdateService(provider, new UpdatePolicyRepository(new MemoryStore('manual')), guard)
    await updateService.checkForUpdate()
    await updateService.downloadUpdate()
    provider.blockPermission = true
    const installing = updateService.installUpdate()
    await vi.waitFor(() => expect(provider.waiting).toBe(true))
    const release = guard.acquire('training')
    provider.finish()
    await installing
    expect(provider.installCalls).toBe(0)
    expect(updateService.getSnapshot().state).toBe('waiting-install')
    release()
    await vi.waitFor(() => expect(provider.installCalls).toBe(1))
  })

  it('权限 await 期间退到后台，回前台后才恢复有效任务', async () => {
    const provider = new DeferredPermissionProvider()
    const updateService = new AppUpdateService(provider, new UpdatePolicyRepository(new MemoryStore('manual')), new UpdateInstallGuard())
    await updateService.checkForUpdate()
    await updateService.downloadUpdate()
    provider.blockPermission = true
    const installing = updateService.installUpdate()
    await vi.waitFor(() => expect(provider.waiting).toBe(true))
    await updateService.setAppActive(false)
    provider.finish()
    await installing
    expect(provider.installCalls).toBe(0)
    expect(updateService.getSnapshot()).toMatchObject({ state: 'waiting-install', dialogVisible: false })
    await updateService.setAppActive(true)
    expect(provider.installCalls).toBe(1)
  })

  it('重复点击和销毁并发不会安装未完成下载，也不会先清理正在写入的文件', async () => {
    const provider = new DeferredDownloadProvider()
    const updateService = new AppUpdateService(provider, new UpdatePolicyRepository(new MemoryStore('manual')), new UpdateInstallGuard())
    await updateService.checkForUpdate()
    const first = updateService.downloadAndInstall()
    const repeated = updateService.downloadAndInstall()
    const wrongInstall = updateService.installUpdate()
    await vi.waitFor(() => expect(provider.downloadCalls).toBe(1))
    const disposing = updateService.dispose()
    await Promise.resolve()
    expect(provider.disposeCalls).toBe(0)
    expect(provider.installCalls).toBe(0)
    provider.finish()
    await Promise.all([first, repeated, wrongInstall, disposing])
    expect(provider.disposeCalls).toBe(1)
    expect(provider.installCalls).toBe(0)
  })

  it('重查失败清除旧候选，错误可在没有 info 时展示', async () => {
    const context = service('manual')
    await context.updateService.checkForUpdate()
    context.provider.checkError = new Error('HTTP 403')
    await context.updateService.checkForUpdate()
    await context.updateService.installUpdate()
    expect(context.updateService.getSnapshot()).toMatchObject({ state: 'error', info: null, errorMessage: 'HTTP 403' })
    expect(context.provider.installCalls).toBe(0)
  })

  it('排队任务尚未启动就销毁时，不再发起下载', async () => {
    const context = service('manual')
    await context.updateService.checkForUpdate()
    // Promise 微任务开始前销毁，验证任务标识与关闭状态能阻止原生调用。
    const downloading = context.updateService.downloadAndInstall()
    await context.updateService.dispose()
    await downloading
    expect(context.provider.downloadCalls).toBe(0)
    expect(context.provider.installCalls).toBe(0)
  })

  it('回前台与打开来源授权页收尾重合时，不丢失授权恢复', async () => {
    const context = service('manual')
    context.provider.permission = 'denied'
    await context.updateService.checkForUpdate()
    await context.updateService.downloadAndInstall()
    let finishSettings: (() => void) | undefined
    context.provider.openInstallPermissionSettings = async () => {
      await new Promise<void>((resolve) => { finishSettings = resolve })
    }
    const opening = context.updateService.openInstallPermissionSettings()
    await vi.waitFor(() => expect(finishSettings).toBeDefined())
    await context.updateService.setAppActive(false)
    context.provider.permission = 'granted'
    const foreground = context.updateService.setAppActive(true)
    finishSettings!()
    await Promise.all([opening, foreground])
    expect(context.provider.installCalls).toBe(1)
  })

  it('训练锁在等待状态发布时释放，也能在旧任务收尾后恢复安装', async () => {
    const context = service('manual')
    await context.updateService.checkForUpdate()
    const release = context.guard.acquire('training')
    // 在同步快照回调中解锁，复现解锁事件发生时下载任务尚未释放 busy 的边界。
    const unsubscribe = context.updateService.onSnapshot((snapshot) => {
      if (snapshot.state === 'waiting-install') release()
    })
    await context.updateService.downloadAndInstall()
    await vi.waitFor(() => expect(context.provider.installCalls).toBe(1))
    unsubscribe()
  })
})
