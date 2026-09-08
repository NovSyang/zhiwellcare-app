import { describe, expect, it } from 'vitest'
import { defaultKartRacingGameConfig } from '../src/games/kart-racing/KartRacingGameConfig'
import { applyKartNeutralThreshold, kartTargetSpeed, stepKartRacing, type KartState } from '../src/games/kart-racing/KartRacingPhysics'
import { createDefaultKartTrack } from '../src/games/kart-racing/KartRacingTrack'

const config = defaultKartRacingGameConfig
const track = createDefaultKartTrack(config.trackLength)
const center: KartState = { lateral: 0, lateralVelocity: 0, speed: config.cruiseSpeed, distance: 0 }

describe('KartRacingPhysics', () => {
  it('自然中心回到巡航速度，前向加速、后向减速', () => {
    expect(kartTargetSpeed(0, config)).toBe(config.cruiseSpeed)
    expect(kartTargetSpeed(1, config)).toBe(config.maxSpeed)
    expect(kartTargetSpeed(-1, config)).toBe(config.minSpeed)
  })

  it('死区抑制小抖动并保持跨区连续', () => {
    expect(applyKartNeutralThreshold(0.05, 0.06)).toBe(0)
    expect(applyKartNeutralThreshold(0.07, 0.06)).toBeGreaterThan(0)
  })

  it('车辆始终向前且不会突破速度上下限', () => {
    let slow = center
    let fast = center
    for (let index = 0; index < 240; index += 1) {
      slow = stepKartRacing(slow, { x: 0, y: -1 }, track, config, 1 / 60)
      fast = stepKartRacing(fast, { x: 0, y: 1 }, track, config, 1 / 60)
    }
    expect(slow.speed).toBeGreaterThanOrEqual(config.minSpeed)
    expect(fast.speed).toBeLessThanOrEqual(config.maxSpeed)
    expect(slow.distance).toBeGreaterThan(0)
  })

  it('左右转向方向正确并受安全边界约束', () => {
    const left = stepKartRacing(center, { x: -1, y: 0 }, track, config, 0.1)
    const right = stepKartRacing(center, { x: 1, y: 0 }, track, config, 0.1)
    expect(left.lateral).toBeLessThan(0)
    expect(right.lateral).toBeGreaterThan(0)
    const edge = stepKartRacing({ ...center, lateral: config.lateralLimit }, { x: 1, y: 0 }, track, config, 0.1)
    expect(edge.lateral).toBe(config.lateralLimit)
    expect(edge.lateralVelocity).toBe(0)
  })
})
