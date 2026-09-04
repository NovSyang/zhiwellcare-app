import { describe, expect, it } from 'vitest'
import { buildTrajectoryFollowTrainingResult } from '../src/games/trajectory-follow/TrajectoryFollowTrainingResult'

describe('TrajectoryFollowTrainingResult', () => {
  it('完全跟随时误差为零且全部处于容差内', () => {
    const result = buildTrajectoryFollowTrainingResult(0, 1000, 1000, [0, 0, 0], 0.18)
    expect(result.averageTrackingError).toBe(0)
    expect(result.maxTrackingError).toBe(0)
    expect(result.inToleranceRatio).toBe(1)
    expect(result.inToleranceDurationMs).toBe(1000)
  })

  it('固定偏差和一半容差样本产生稳定统计', () => {
    const fixed = buildTrajectoryFollowTrainingResult(0, 1000, 1000, [0.1, 0.1], 0.18)
    expect(fixed.averageTrackingError).toBeCloseTo(0.1)
    expect(fixed.maxTrackingError).toBeCloseTo(0.1)
    const half = buildTrajectoryFollowTrainingResult(0, 2000, 2000, [0.1, 0.2], 0.18)
    expect(half.inToleranceRatio).toBe(0.5)
    expect(half.inToleranceDurationMs).toBe(1000)
  })

  it('空样本返回可安全展示的空结果', () => {
    const result = buildTrajectoryFollowTrainingResult(0, 0, 0, [], 0.18)
    expect(result).toMatchObject({ sampleCount: 0, averageTrackingError: null, maxTrackingError: null, inToleranceRatio: 0, inToleranceDurationMs: 0 })
  })
})
