import { afterEach, describe, expect, it, vi } from 'vitest'
import { TauriEvent, type Event, type EventCallback, type EventName, type UnlistenFn } from '@tauri-apps/api/event'
import { TauriAppLifecycleService, type TauriLifecycleWindow } from '../src/platform/tauri/TauriAppLifecycleService'
import { AppUpdateService } from '../src/core/update/AppUpdateService'
import { UpdateInstallGuard } from '../src/core/update/UpdateInstallGuard'
import { UpdatePolicyRepository } from '../src/core/update/UpdatePolicyRepository'
import type { IUpdateProvider } from '../src/core/update/IUpdateProvider'

/** 伪窗口保持原生查询与事件分离，能复现查询返回早于/晚于失焦的边界。 */
class FakeWindow implements TauriLifecycleWindow {
  visible = true
  minimized = false
  focused = true
  queryError = false
  focusRead: (() => Promise<boolean>) | null = null
  registrations: { event: EventName; handler: EventCallback<unknown>; remove: ReturnType<typeof vi.fn>; resolve: (remove: UnlistenFn) => void }[] = []
  deferRegistration = false
  failEvent: EventName | null = null

  async isVisible(): Promise<boolean> { if (this.queryError) throw new Error('窗口查询失败'); return this.visible }
  async isMinimized(): Promise<boolean> { return this.minimized }
  async isFocused(): Promise<boolean> { return this.focusRead ? this.focusRead() : this.focused }
  listen<T>(event: EventName, handler: EventCallback<T>): Promise<UnlistenFn> {
    if (event === this.failEvent) return Promise.reject(new Error('监听注册失败'))
    const remove = vi.fn()
    return new Promise((resolve) => {
      this.registrations.push({ event, handler: handler as EventCallback<unknown>, remove, resolve })
      if (!this.deferRegistration) resolve(remove)
    })
  }
  emit(event: EventName, payload: unknown = null): void {
    for (const registration of this.registrations) {
      if (registration.event === event && registration.remove.mock.calls.length === 0) {
        registration.handler({ event, id: 1, payload } as Event<unknown>)
      }
    }
  }
  finishRegistrations(): void { for (const registration of this.registrations) registration.resolve(registration.remove) }
}

const services: TauriAppLifecycleService[] = []
function lifecycle(window: FakeWindow, pollIntervalMs = 0) {
  const service = new TauriAppLifecycleService({ window, windowEvents: null, documentEvents: null, pollIntervalMs })
  services.push(service)
  return service
}
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()))
  vi.useRealTimers()
})

describe('TauriAppLifecycleService', () => {
  it('未知状态先视为后台，完成原生可见/未最小化/聚焦核对后恢复', async () => {
    const window = new FakeWindow()
    const service = lifecycle(window)
    const states: boolean[] = []
    service.onActiveChanged((active) => states.push(active))
    expect(states).toEqual([false])
    await vi.waitFor(() => expect(states).toEqual([false, true]))
    expect(window.registrations).toHaveLength(4)
  })

  it.each(['minimized', 'hidden', 'blurred'])('原生 %s 状态不会恢复前台', async (state) => {
    const window = new FakeWindow()
    window.minimized = state === 'minimized'
    window.visible = state !== 'hidden'
    window.focused = state !== 'blurred'
    const service = lifecycle(window)
    const states: boolean[] = []
    service.onActiveChanged((active) => states.push(active))
    await vi.waitFor(() => expect(window.registrations).toHaveLength(4))
    window.emit(TauriEvent.WINDOW_FOCUS)
    await Promise.resolve()
    expect(states).toEqual([false])
  })

  it('失焦立即转后台，返回窗口时重新核对并恢复', async () => {
    const window = new FakeWindow()
    const service = lifecycle(window)
    const states: boolean[] = []
    service.onActiveChanged((active) => states.push(active))
    await vi.waitFor(() => expect(states.at(-1)).toBe(true))
    window.focused = false
    window.emit(TauriEvent.WINDOW_BLUR)
    expect(states.at(-1)).toBe(false)
    window.focused = true
    window.emit(TauriEvent.WINDOW_FOCUS)
    expect(states.at(-1)).toBe(false)
    await vi.waitFor(() => expect(states.at(-1)).toBe(true))
  })

  it('初始化查询返回时已经失焦，旧结果不能恢复前台', async () => {
    const window = new FakeWindow()
    let finish: ((value: boolean) => void) | undefined
    window.focusRead = () => new Promise((resolve) => { finish = resolve })
    const service = lifecycle(window)
    const states: boolean[] = []
    service.onActiveChanged((active) => states.push(active))
    await vi.waitFor(() => expect(finish).toBeDefined())
    window.focused = false
    window.emit(TauriEvent.WINDOW_BLUR)
    finish!(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(states).toEqual([false])
  })

  it('resize 使旧查询作废，最小化事件先于 blur 也不能激活窗口', async () => {
    const window = new FakeWindow()
    let finish: ((value: boolean) => void) | undefined
    window.focusRead = () => new Promise((resolve) => { finish = resolve })
    const service = lifecycle(window)
    const states: boolean[] = []
    service.onActiveChanged((active) => states.push(active))
    await vi.waitFor(() => expect(finish).toBeDefined())
    window.minimized = true
    window.focusRead = null
    // 只有 resize，没有 blur，专门检查旧的 visible/focused 结果会被丢弃。
    window.emit(TauriEvent.WINDOW_RESIZED, { width: 0, height: 0 })
    finish!(true)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(states).toEqual([false])
  })

  it('无焦点事件时通过定时查询发现隐藏，并在重新显示聚焦后恢复', async () => {
    vi.useFakeTimers()
    const window = new FakeWindow()
    const service = lifecycle(window, 100)
    const states: boolean[] = []
    service.onActiveChanged((active) => states.push(active))
    await vi.advanceTimersByTimeAsync(0)
    expect(states.at(-1)).toBe(true)
    window.visible = false
    await vi.advanceTimersByTimeAsync(100)
    expect(states.at(-1)).toBe(false)
    window.visible = true
    await vi.advanceTimersByTimeAsync(100)
    expect(states.at(-1)).toBe(true)
  })

  it('解除订阅后异步注册才返回，也会移除所有监听且不再回调', async () => {
    const window = new FakeWindow()
    window.deferRegistration = true
    const service = lifecycle(window)
    const states: boolean[] = []
    const unsubscribe = service.onActiveChanged((active) => states.push(active))
    await vi.waitFor(() => expect(window.registrations).toHaveLength(4))
    unsubscribe()
    window.finishRegistrations()
    await service.dispose()
    expect(window.registrations.every(({ remove }) => remove.mock.calls.length === 1)).toBe(true)
    window.emit(TauriEvent.WINDOW_FOCUS)
    expect(states).toEqual([false])
  })

  it('监听部分失败或状态查询失败保持后台，销毁释放已成功注册句柄', async () => {
    const window = new FakeWindow()
    window.failEvent = TauriEvent.WINDOW_BLUR
    const service = lifecycle(window)
    const states: boolean[] = []
    service.onActiveChanged((active) => states.push(active))
    await vi.waitFor(() => expect(window.registrations).toHaveLength(3))
    await service.dispose()
    expect(states).toEqual([false])
    expect(window.registrations.every(({ remove }) => remove.mock.calls.length === 1)).toBe(true)
    const failedQueryWindow = new FakeWindow()
    failedQueryWindow.queryError = true
    lifecycle(failedQueryWindow).onActiveChanged((active) => states.push(active))
    await Promise.resolve()
    expect(states.every((active) => !active)).toBe(true)
  })

  it('接入统一状态机后，后台下载完成等待，返回前台只恢复一次有效安装', async () => {
    const window = new FakeWindow()
    window.minimized = true
    window.focused = false
    const service = lifecycle(window)
    const install = vi.fn(async () => undefined)
    const info = { currentVersion: '0.1.0', latestVersion: '0.1.1', displayVersion: '0.1.1', notes: [], publishedAt: null, sizeBytes: 3 }
    const provider: IUpdateProvider = {
      platform: 'tauri', supported: true,
      getCurrentVersion: async () => '0.1.0', checkForUpdate: async () => info,
      download: async () => undefined, install,
      getInstallPermission: async () => 'not-required', openInstallPermissionSettings: async () => undefined,
      dispose: async () => undefined,
    }
    const updates = new AppUpdateService(provider, new UpdatePolicyRepository({ get: async () => 'manual', set: async () => undefined, remove: async () => undefined }), new UpdateInstallGuard())
    service.onActiveChanged((active) => { void updates.setAppActive(active) })
    await updates.checkForUpdate()
    await updates.downloadAndInstall()
    expect(updates.getSnapshot().state).toBe('waiting-install')
    expect(install).not.toHaveBeenCalled()
    window.minimized = false
    window.focused = true
    window.emit(TauriEvent.WINDOW_FOCUS)
    await vi.waitFor(() => expect(install).toHaveBeenCalledOnce())
    window.emit(TauriEvent.WINDOW_FOCUS)
    await Promise.resolve()
    expect(install).toHaveBeenCalledOnce()
    await updates.dispose()
  })
})
