import { describe, expect, it } from 'vitest'
import { defaultRiverDriftGameConfig } from '../src/games/river-drift/RiverDriftGameConfig'
import { applyRiverDriftNeutralThreshold, stepRiverDriftBoat } from '../src/games/river-drift/RiverDriftPhysics'

const bounds = { minX: 0.2, maxX: 0.8, minY: 0.63, maxY: 0.85 }
const center = { x: 0.5, y: 0.74, velocityX: 0, velocityY: 0 }

describe('RiverDriftPhysics', () => {
  it('死区内归零，跨过死区后保持连续输出', () => {
    expect(applyRiverDriftNeutralThreshold(0.04, 0.05)).toBe(0)
    expect(applyRiverDriftNeutralThreshold(0.06, 0.05)).toBeGreaterThan(0)
  })

  it('四方向输入映射到正确的屏幕速度', () => {
    const right = stepRiverDriftBoat(center, { x: 1, y: 0 }, bounds, defaultRiverDriftGameConfig, 1 / 60)
    const forward = stepRiverDriftBoat(center, { x: 0, y: 1 }, bounds, defaultRiverDriftGameConfig, 1 / 60)
    expect(right.x).toBeGreaterThan(center.x)
    expect(forward.y).toBeLessThan(center.y)
  })

  it('回中后速度衰减且船体不会越过硬边界', () => {
    const moving = { ...center, velocityX: 0.3 }
    const stopped = stepRiverDriftBoat(moving, { x: 0, y: 0 }, bounds, defaultRiverDriftGameConfig, 1 / 60)
    const edge = stepRiverDriftBoat({ ...moving, x: bounds.maxX }, { x: 1, y: 0 }, bounds, defaultRiverDriftGameConfig, 0.1)
    expect(stopped.velocityX).toBeLessThan(moving.velocityX)
    expect(edge.x).toBe(bounds.maxX)
    expect(edge.velocityX).toBe(0)
  })

  it('异常 dt 不产生位移', () => {
    expect(stepRiverDriftBoat(center, { x: 1, y: 1 }, bounds, defaultRiverDriftGameConfig, Number.NaN)).toEqual(center)
  })
})
