import type { BaseTrainingResult } from '../../core/training/BaseTrainingResult'
import { ALL_DIRECTIONS, type Direction } from '../../core/training/Direction'

export interface TargetAttemptResult {
  index: number
  direction: Direction
  startedAt: number
  firstMovementAt: number | null
  reachedAt: number | null
  endedAt: number
  success: boolean
  reactionTimeMs: number | null
  reachTimeMs: number | null
  maxInput: number
}

export interface DirectionSummary {
  total: number
  success: number
  failed: number
  averageReachTimeMs: number | null
}

/** TargetReach 专属结果；字段保持不变以兼容已有 IndexedDB 记录。 */
export interface TargetReachTrainingResult extends BaseTrainingResult {
  totalTargets: number
  successTargets: number
  failedTargets: number
  successRate: number
  averageReactionTimeMs: number | null
  averageReachTimeMs: number | null
  directions: Record<Direction, DirectionSummary>
  attempts: TargetAttemptResult[]
}

/** 从目标尝试事实生成稳定的 TargetReach 汇总结果。 */
export function buildTargetReachTrainingResult(
  startedAt: number,
  endedAt: number,
  durationMs: number,
  attempts: TargetAttemptResult[],
): TargetReachTrainingResult {
  const directions = emptyDirectionSummaries()
  for (const attempt of attempts) {
    const summary = directions[attempt.direction]
    summary.total += 1
    attempt.success ? summary.success += 1 : summary.failed += 1
  }
  for (const direction of ALL_DIRECTIONS) {
    directions[direction].averageReachTimeMs = averageOrNull(
      attempts.filter((attempt) => attempt.direction === direction && attempt.reachTimeMs !== null)
        .map((attempt) => attempt.reachTimeMs as number),
    )
  }
  const successTargets = attempts.filter((attempt) => attempt.success).length
  return {
    startedAt,
    endedAt,
    durationMs: Math.max(0, durationMs),
    totalTargets: attempts.length,
    successTargets,
    failedTargets: attempts.length - successTargets,
    successRate: attempts.length === 0 ? 0 : successTargets / attempts.length,
    averageReactionTimeMs: averageOrNull(attempts.filter((attempt) => attempt.reactionTimeMs !== null).map((attempt) => attempt.reactionTimeMs as number)),
    averageReachTimeMs: averageOrNull(attempts.filter((attempt) => attempt.reachTimeMs !== null).map((attempt) => attempt.reachTimeMs as number)),
    directions,
    attempts: structuredClone(attempts),
  }
}

function emptyDirectionSummaries(): Record<Direction, DirectionSummary> {
  return {
    left: { total: 0, success: 0, failed: 0, averageReachTimeMs: null },
    right: { total: 0, success: 0, failed: 0, averageReachTimeMs: null },
    forward: { total: 0, success: 0, failed: 0, averageReachTimeMs: null },
    backward: { total: 0, success: 0, failed: 0, averageReachTimeMs: null },
  }
}

function averageOrNull(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length
}
