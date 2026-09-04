import { describe, expect, it } from 'vitest'
import { buildTargetReachTrainingResult, type TargetAttemptResult } from '../src/games/target-reach/TargetReachTrainingResult'

describe('buildTargetReachTrainingResult', () => {
  it('汇总成功率、平均时间和方向统计', () => {
    const attempts: TargetAttemptResult[] = [
      {
        index: 1, direction: 'left', startedAt: 0, firstMovementAt: 100, reachedAt: 500,
        endedAt: 500, success: true, reactionTimeMs: 100, reachTimeMs: 500, maxInput: 0.8,
      },
      {
        index: 2, direction: 'right', startedAt: 600, firstMovementAt: null, reachedAt: null,
        endedAt: 1600, success: false, reactionTimeMs: null, reachTimeMs: null, maxInput: 0.05,
      },
    ]

    const result = buildTargetReachTrainingResult(0, 1600, 1600, attempts)

    expect(result.successRate).toBe(0.5)
    expect(result.averageReactionTimeMs).toBe(100)
    expect(result.averageReachTimeMs).toBe(500)
    expect(result.directions.left.success).toBe(1)
    expect(result.directions.right.failed).toBe(1)
  })
})
