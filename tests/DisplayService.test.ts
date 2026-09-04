import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock 会提升执行，使用 hoisted 让插件桩在模块加载前安全创建。
const { lock, unlock, keepAwake, allowSleep } = vi.hoisted(() => ({
  lock: vi.fn(), unlock: vi.fn(), keepAwake: vi.fn(), allowSleep: vi.fn(),
}))

vi.mock('@capacitor/screen-orientation', () => ({ ScreenOrientation: { lock, unlock } }))
vi.mock('@capacitor-community/keep-awake', () => ({ KeepAwake: { keepAwake, allowSleep } }))

import { CapacitorDisplayService } from '../src/platform/capacitor/CapacitorDisplayService'

describe('CapacitorDisplayService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    lock.mockResolvedValue(undefined)
    unlock.mockResolvedValue(undefined)
    keepAwake.mockResolvedValue(undefined)
    allowSleep.mockResolvedValue(undefined)
  })

  it('进入训练锁横屏并常亮，退出时恢复两项系统设置', async () => {
    const service = new CapacitorDisplayService()
    await expect(service.enterTrainingMode()).resolves.toEqual({ native: true, orientationLocked: true })
    await service.leaveTrainingMode()
    expect(lock).toHaveBeenCalledWith({ orientation: 'landscape' })
    expect(keepAwake).toHaveBeenCalledOnce()
    expect(unlock).toHaveBeenCalledOnce()
    expect(allowSleep).toHaveBeenCalledOnce()
  })

  it('方向锁定失败时返回降级状态，但仍尝试保持屏幕常亮', async () => {
    lock.mockRejectedValue(new Error('not supported'))
    const service = new CapacitorDisplayService()
    await expect(service.enterTrainingMode()).resolves.toEqual({ native: true, orientationLocked: false })
    expect(keepAwake).toHaveBeenCalledOnce()
  })
})
