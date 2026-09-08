import { describe, expect, it } from 'vitest'
import {
  riverDriftBoatScale,
  riverDriftDepth,
  riverDriftEnvironmentScale,
  riverDriftOutlineWidth,
  riverDriftPerspectiveScale,
  riverDriftShadowStyle,
} from '../src/games/river-drift/art/RiverDriftPerspective'

describe('RiverDriftPerspective', () => {
  it('限制异常深度并满足远中近单调递增', () => {
    expect(riverDriftDepth(Number.NaN)).toBe(0)
    expect(riverDriftPerspectiveScale(-1)).toBeCloseTo(0.82)
    expect(riverDriftPerspectiveScale(1)).toBeCloseTo(1.12)
    expect(riverDriftPerspectiveScale(0)).toBeLessThan(riverDriftPerspectiveScale(0.5))
    expect(riverDriftPerspectiveScale(0.5)).toBeLessThan(riverDriftPerspectiveScale(1))
  })

  it('环境、船体、阴影和描边使用受控范围', () => {
    expect(riverDriftEnvironmentScale(0)).toBeCloseTo(0.88)
    expect(riverDriftEnvironmentScale(1)).toBeCloseTo(1.08)
    expect(riverDriftBoatScale(0)).toBeCloseTo(0.97)
    expect(riverDriftBoatScale(1)).toBeCloseTo(1.03)
    expect(riverDriftShadowStyle(1).alpha).toBeGreaterThan(riverDriftShadowStyle(0).alpha)
    expect(riverDriftOutlineWidth(1)).toBeGreaterThan(riverDriftOutlineWidth(0))
  })
})
