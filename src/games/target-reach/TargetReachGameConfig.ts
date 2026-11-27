import { ALL_DIRECTIONS, type Direction } from '../../core/training/Direction'

/** 两端沿用同一个游戏标识，历史不随渲染平台变化。 */
export const TARGET_REACH_GAME_ID = 'target-reach'
export const TARGET_REACH_GAME_NAME = '四方挥腕挑战'

export interface TargetReachGameConfig {
  sessionDurationMs: number
  targetCount: number
  targetDistance: number
  targetRadius: number
  playerRadius: number
  holdTimeMs: number
  successFeedbackMs: number
  targetTimeoutMs: number
  movementThreshold: number
  enabledDirections: Direction[]
}

/** V0.2 的默认难度：目标位于患者已校准活动范围的 70% 处。 */
export const defaultTargetReachGameConfig: TargetReachGameConfig = {
  sessionDurationMs: 120_000,
  targetCount: 20,
  targetDistance: 0.7,
  targetRadius: 0.16,
  playerRadius: 22,
  holdTimeMs: 300,
  successFeedbackMs: 250,
  targetTimeoutMs: 8_000,
  movementThreshold: 0.08,
  enabledDirections: [...ALL_DIRECTIONS],
}
