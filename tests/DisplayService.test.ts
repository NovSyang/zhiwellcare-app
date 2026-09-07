import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock 会提升执行，使用 hoisted 让插件桩在模块加载前安全创建。
const { lock, unlock, keepAwake, allowSleep, hide, show } = vi.hoisted(() => ({
  lock: vi.fn(), unlock: vi.fn(), keepAwake: vi.fn(), allowSleep: vi.fn(), hide: vi.fn(), show: vi.fn(),
}))

vi.mock('@capacitor/screen-orientation', () => ({ ScreenOrientation: { lock, unlock } }))
vi.mock('@capacitor-community/keep-awake', () => ({ KeepAwake: { keepAwake, allowSleep } }))
vi.mock('@capacitor/core', () => ({ SystemBars: { hide, show } }))

import { CapacitorDisplayService } from '../src/platform/capacitor/CapacitorDisplayService'

describe('CapacitorDisplayService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    lock.mockResolvedValue(undefined)
    unlock.mockResolvedValue(undefined)
    keepAwake.mockResolvedValue(undefined)
    allowSleep.mockResolvedValue(undefined)
    hide.mockResolvedValue(undefined)
    show.mockResolvedValue(undefined)
  })

  it('进入训练锁横屏、隐藏系统栏并常亮，退出时恢复三项系统设置', async () => {
    const service = new CapacitorDisplayService()
    await expect(service.enterTrainingMode()).resolves.toEqual({ native: true, orientationLocked: true, systemBarsHidden: true })
    await service.leaveTrainingMode()
    expect(lock).toHaveBeenCalledWith({ orientation: 'landscape' })
    expect(hide).toHaveBeenCalledOnce()
    expect(keepAwake).toHaveBeenCalledOnce()
    expect(show).toHaveBeenCalledOnce()
    expect(unlock).toHaveBeenCalledOnce()
    expect(allowSleep).toHaveBeenCalledOnce()
  })

  it('方向锁定失败时返回降级状态，但仍尝试保持屏幕常亮', async () => {
    lock.mockRejectedValue(new Error('not supported'))
    const service = new CapacitorDisplayService()
    await expect(service.enterTrainingMode()).resolves.toEqual({ native: true, orientationLocked: false, systemBarsHidden: true })
    expect(hide).toHaveBeenCalledOnce()
    expect(keepAwake).toHaveBeenCalledOnce()
  })

  it('系统栏隐藏或常亮失败不会阻塞训练模式', async () => {
    hide.mockRejectedValue(new Error('bars unavailable'))
    keepAwake.mockRejectedValue(new Error('awake unavailable'))
    const service = new CapacitorDisplayService()

    await expect(service.enterTrainingMode()).resolves.toEqual({ native: true, orientationLocked: true, systemBarsHidden: false })
    expect(lock).toHaveBeenCalledOnce()
  })

  it('回前台时重新应用训练显示状态', async () => {
    const service = new CapacitorDisplayService()
    await service.refreshTrainingMode()

    expect(lock).toHaveBeenCalledWith({ orientation: 'landscape' })
    expect(hide).toHaveBeenCalledOnce()
    expect(keepAwake).toHaveBeenCalledOnce()
  })

  it('系统栏恢复失败时仍解除常亮和方向锁', async () => {
    show.mockRejectedValue(new Error('bars unavailable'))
    const service = new CapacitorDisplayService()
    await expect(service.leaveTrainingMode()).resolves.toBeUndefined()

    expect(allowSleep).toHaveBeenCalledOnce()
    expect(unlock).toHaveBeenCalledOnce()
  })
})
