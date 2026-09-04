import { describe, expect, it } from 'vitest'
import { UpdateInstallGuard } from '../src/core/update/UpdateInstallGuard'

// 安全锁使用引用计数，任意受保护页面未退出时都不能安装更新。
describe('UpdateInstallGuard', () => {
  it('所有引用锁释放后才恢复安全状态，重复释放保持幂等', () => {
    const guard = new UpdateInstallGuard()
    const states: boolean[] = []
    guard.onChanged((safe) => states.push(safe))
    const releaseTraining = guard.acquire('training')
    const releaseRom = guard.acquire('rom')
    expect(guard.isSafe()).toBe(false)
    releaseTraining()
    expect(guard.isSafe()).toBe(false)
    releaseRom()
    releaseRom()
    expect(guard.isSafe()).toBe(true)
    expect(states).toEqual([true, false, true])
  })
})
