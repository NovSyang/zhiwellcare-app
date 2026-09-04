import type { BaseTrainingResult } from '../../core/training/BaseTrainingResult'

export interface TrajectoryFollowTrainingResult extends BaseTrainingResult {
  sampleCount: number
  averageTrackingError: number | null
  maxTrackingError: number | null
  inToleranceRatio: number
  inToleranceDurationMs: number
}

/** 根据固定频率误差样本生成工程训练指标，不进行临床解释。 */
export function buildTrajectoryFollowTrainingResult(
  startedAt: number,
  endedAt: number,
  durationMs: number,
  errors: readonly number[],
  toleranceRadius: number,
): TrajectoryFollowTrainingResult {
  const validErrors = errors.filter((value) => Number.isFinite(value) && value >= 0)
  const inToleranceCount = validErrors.filter((value) => value <= toleranceRadius).length
  const inToleranceRatio = validErrors.length === 0 ? 0 : inToleranceCount / validErrors.length
  return {
    startedAt,
    endedAt,
    durationMs: Math.max(0, durationMs),
    sampleCount: validErrors.length,
    averageTrackingError: validErrors.length === 0 ? null : validErrors.reduce((sum, value) => sum + value, 0) / validErrors.length,
    maxTrackingError: validErrors.length === 0 ? null : Math.max(...validErrors),
    inToleranceRatio,
    inToleranceDurationMs: Math.round(Math.max(0, durationMs) * inToleranceRatio),
  }
}
