import { describe, expect, it } from 'vitest'
import { canRegisterRiverDriftHit, riverDriftCirclesOverlap } from '../src/games/river-drift/RiverDriftCollision'

describe('RiverDriftCollision', () => {
  it('正确识别金币或障碍的圆形命中与未命中', () => {
    const boat = { x: 0.5, y: 0.7, radius: 0.05 }
    expect(riverDriftCirclesOverlap(boat, { x: 0.58, y: 0.7, radius: 0.04 })).toBe(true)
    expect(riverDriftCirclesOverlap(boat, { x: 0.8, y: 0.7, radius: 0.04 })).toBe(false)
  })

  it('无敌期和障碍自身状态阻止重复计数', () => {
    expect(canRegisterRiverDriftHit(2_000, 500, false, 1_000)).toBe(true)
    expect(canRegisterRiverDriftHit(1_200, 500, false, 1_000)).toBe(false)
    expect(canRegisterRiverDriftHit(2_000, 500, true, 1_000)).toBe(false)
  })
})
