import { describe, expect, it } from 'vitest'
import { buildKartRacingTrainingResult } from '../src/games/kart-racing/KartRacingTrainingResult'

describe('KartRacingTrainingResult', () => {
  it('计算速度、前后左右、避障和主动参与指标', () => {
    const result = buildKartRacingTrainingResult({
      startedAt: 0,
      endedAt: 1_000,
      durationMs: 1_000,
      completionReason: 'finish-line',
      trackProgress: 1,
      collectedCoins: 3,
      totalCoins: 4,
      spawnedObstacles: 5,
      collisionCount: 1,
      movementThreshold: 0.1,
      samples: [
        { x: -0.5, y: 0.6, speedRatio: 0.8, distance: 10 },
        { x: 0.5, y: -0.6, speedRatio: 0.6, distance: 20 },
      ],
    })
    expect(result.coinCollectionRate).toBe(0.75)
    expect(result.avoidedObstacles).toBe(4)
    expect(result.averageSpeedRatio).toBeCloseTo(0.7)
    expect(result.accelerationParticipation).toBe(0.5)
    expect(result.brakingParticipation).toBe(0.5)
    expect(result.horizontalMovementBalance).toBe(1)
    expect(result.verticalMovementBalance).toBe(1)
  })

  it('空样本和异常计数返回安全值', () => {
    const result = buildKartRacingTrainingResult({
      startedAt: 0, endedAt: 0, durationMs: -1, completionReason: 'max-duration', trackProgress: Number.NaN,
      collectedCoins: 5, totalCoins: 2, spawnedObstacles: 1, collisionCount: 3, samples: [], movementThreshold: 0.1,
    })
    expect(result.durationMs).toBe(0)
    expect(result.trackProgress).toBe(0)
    expect(result.collectedCoins).toBe(2)
    expect(result.collisionCount).toBe(1)
    expect(result.averageSpeedRatio).toBe(0)
  })
})
