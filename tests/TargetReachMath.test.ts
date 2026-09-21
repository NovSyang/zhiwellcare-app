import { describe, expect, it } from 'vitest'
import { distanceBetween, getTargetHoldProgress, getTargetPosition } from '../src/games/target-reach/TargetReachMath'

describe('TargetReachMath', () => {
  it('右目标位于正 X 轴', () => {
    expect(getTargetPosition('right', 0.7)).toEqual({ x: 0.7, y: 0 })
  })

  it('使用二维距离进行目标判定', () => {
    expect(distanceBetween({ x: 0, y: 0 }, { x: 0.3, y: 0.4 })).toBeCloseTo(0.5)
  })

  it('将连续保持时间转换为边界稳定的目标进度', () => {
    expect(getTargetHoldProgress(100, null, 300)).toBe(0)
    expect(getTargetHoldProgress(50, 100, 300)).toBe(0)
    expect(getTargetHoldProgress(250, 100, 300)).toBe(0.5)
    expect(getTargetHoldProgress(400, 100, 300)).toBe(1)
    expect(getTargetHoldProgress(900, 100, 300)).toBe(1)
    expect(getTargetHoldProgress(100, 100, 0)).toBe(1)
  })
})
