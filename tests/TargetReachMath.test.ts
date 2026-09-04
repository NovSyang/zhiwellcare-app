import { describe, expect, it } from 'vitest'
import { distanceBetween, getTargetPosition } from '../src/games/target-reach/TargetReachMath'

describe('TargetReachMath', () => {
  it('右目标位于正 X 轴', () => {
    expect(getTargetPosition('right', 0.7)).toEqual({ x: 0.7, y: 0 })
  })

  it('使用二维距离进行目标判定', () => {
    expect(distanceBetween({ x: 0, y: 0 }, { x: 0.3, y: 0.4 })).toBeCloseTo(0.5)
  })
})
