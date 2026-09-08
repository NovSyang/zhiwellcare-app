import { describe, expect, it } from 'vitest'
import { canRegisterKartHit, kartEntityOverlaps } from '../src/games/kart-racing/KartRacingCollision'

describe('KartRacingCollision', () => {
  it('扫掠经过检测避免高速跨帧穿透', () => {
    const entity = { distance: 100, lateral: 0.1, radius: 0.1 }
    expect(kartEntityOverlaps(95, 105, 0, entity, 0.13, 1)).toBe(true)
    expect(kartEntityOverlaps(95, 105, 0.7, entity, 0.13, 1)).toBe(false)
  })

  it('同一障碍和保护期不会重复计数', () => {
    expect(canRegisterKartHit(2_000, 0, false, 1_000)).toBe(true)
    expect(canRegisterKartHit(2_100, 2_000, false, 1_000)).toBe(false)
    expect(canRegisterKartHit(4_000, 0, true, 1_000)).toBe(false)
  })
})
