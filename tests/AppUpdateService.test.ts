import { describe, expect, it, vi } from 'vitest'
import type { IKeyValueStore } from '../src/core/storage/IKeyValueStore'
import { AppUpdateService } from '../src/core/update/AppUpdateService'
import type { IUpdateProvider, UpdateInstallPermission } from '../src/core/update/IUpdateProvider'
import type { UpdateInfo, UpdateProgress } from '../src/core/update/UpdateInfo'
import { UpdateInstallGuard } from '../src/core/update/UpdateInstallGuard'
import { UpdatePolicyRepository } from '../src/core/update/UpdatePolicyRepository'

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
  permission: UpdateInstallPermission = 'granted'
  async getCurrentVersion(): Promise<string> { return '0.8.0' }
  async checkForUpdate(): Promise<UpdateInfo | null> { this.checkCalls += 1; if (this.checkError) throw this.checkError; return this.checkResult }
  async download(_update: UpdateInfo, onProgress?: (progress: UpdateProgress) => void): Promise<void> { this.downloadCalls += 1; onProgress?.({ downloadedBytes: 100, totalBytes: 100, percent: 100 }) }
  async install(): Promise<void> { this.installCalls += 1 }
  async getInstallPermission(): Promise<UpdateInstallPermission> { return this.permission }
  async openInstallPermissionSettings(): Promise<void> {}
  async dispose(): Promise<void> {}
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
})
