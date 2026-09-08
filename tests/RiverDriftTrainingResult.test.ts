import { describe, expect, it } from 'vitest'
import { buildRiverDriftTrainingResult } from '../src/games/river-drift/RiverDriftTrainingResult'
import { presentRiverDriftResult } from '../src/games/river-drift/RiverDriftGameModule'
import { defaultRiverDriftGameConfig } from '../src/games/river-drift/RiverDriftGameConfig'

describe('RiverDriftTrainingResult', () => {
  it('计算金币、避障、方向参与度与平衡度', () => {
    const result = buildRiverDriftTrainingResult({
      startedAt: 0, endedAt: 1_000, durationMs: 1_000,
      collectedCoins: 8, totalCoins: 10, spawnedObstacles: 5, collisionCount: 1,
      samples: [{ x: -0.5, y: 0.3 }, { x: 0.5, y: -0.3 }, { x: 0, y: 0 }], movementThreshold: 0.1,
    })
    expect(result.coinCollectionRate).toBe(0.8)
    expect(result.avoidedObstacles).toBe(4)
    expect(result.activeMovementRatio).toBeCloseTo(2 / 3)
    expect(result.horizontalMovementBalance).toBe(1)
    expect(result.verticalMovementBalance).toBe(1)
  })

  it('空样本和异常计数返回可安全展示的结果', () => {
    const result = buildRiverDriftTrainingResult({
      startedAt: 0, endedAt: 0, durationMs: -1, collectedCoins: 9, totalCoins: 2,
      spawnedObstacles: 1, collisionCount: 4, samples: [], movementThreshold: 0.1,
    })
    expect(result).toMatchObject({ durationMs: 0, collectedCoins: 2, coinCollectionRate: 1, collisionCount: 1, activeMovementRatio: 0 })
  })

  it('结果展示使用积极的训练文案', () => {
    const result = buildRiverDriftTrainingResult({
      startedAt: 0, endedAt: 1_000, durationMs: 1_000, collectedCoins: 1, totalCoins: 2,
      spawnedObstacles: 2, collisionCount: 1, samples: [{ x: 0.2, y: 0 }], movementThreshold: 0.1,
    })
    const presentation = presentRiverDriftResult(result, defaultRiverDriftGameConfig)
    expect(presentation.metrics.map((metric) => metric.label)).toContain('成功避障')
    expect(JSON.stringify(presentation)).not.toContain('失败')
  })
})
