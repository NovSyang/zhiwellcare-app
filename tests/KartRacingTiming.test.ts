import { describe, expect, it } from 'vitest'
import { defaultKartRacingGameConfig } from '../src/games/kart-racing/KartRacingGameConfig'
import { stepKartRacing, type KartState } from '../src/games/kart-racing/KartRacingPhysics'
import { createDefaultKartTrack } from '../src/games/kart-racing/KartRacingTrack'

describe('KartRacingTiming', () => {
  it('自然中心在最大保护时长前完成固定赛道', () => {
    const config = defaultKartRacingGameConfig
    const track = createDefaultKartTrack(config.trackLength)
    let kart: KartState = { lateral: 0, lateralVelocity: 0, speed: config.cruiseSpeed, distance: 0 }
    let elapsedMs = 0
    while (kart.distance < config.trackLength && elapsedMs < config.maxSessionDurationMs) {
      kart = stepKartRacing(kart, { x: 0, y: 0 }, track, config, config.fixedStepMs / 1_000)
      elapsedMs += config.fixedStepMs
    }
    expect(kart.distance).toBeGreaterThanOrEqual(config.trackLength)
    expect(elapsedMs).toBeLessThan(config.maxSessionDurationMs)
  })

  it('加速比自然中心更早完成但仍受绝对上限约束', () => {
    const config = defaultKartRacingGameConfig
    const track = createDefaultKartTrack(config.trackLength)
    let kart: KartState = { lateral: 0, lateralVelocity: 0, speed: config.cruiseSpeed, distance: 0 }
    for (let index = 0; index < 300; index += 1) kart = stepKartRacing(kart, { x: 0, y: 1 }, track, config, 1 / 60, { boostFactor: config.boostFactor })
    expect(kart.speed).toBeLessThanOrEqual(config.maxSpeed * config.boostFactor)
    expect(kart.speed).toBeGreaterThan(config.cruiseSpeed)
  })
})
