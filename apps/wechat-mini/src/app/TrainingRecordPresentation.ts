import type { GameResultPresentation, TrainingRecord } from '@/shared/core'
import { TARGET_REACH_GAME_ID, type TargetReachGameConfig } from '@/shared/target-config'
import { presentTargetReachResult } from '@/shared/target-result'
import {
  TRAJECTORY_FOLLOW_GAME_ID, presentTrajectoryFollowResult, type TrajectoryFollowGameConfig,
  type TrajectoryFollowTrainingResult,
} from '@/shared/trajectory'
import {
  RIVER_DRIFT_GAME_ID, presentRiverDriftResult, type RiverDriftGameConfig, type RiverDriftTrainingResult,
} from '@/shared/river'
import {
  KART_RACING_GAME_ID, presentKartRacingResult, type KartRacingGameConfig, type KartRacingTrainingResult,
} from '@/shared/kart'

/** 历史结果来自原局快照，按 gameId 使用和结算页相同的结果格式。 */
export function presentSavedTraining(record: TrainingRecord): GameResultPresentation | null {
  const { gameId, result, gameConfig } = record
  if (!gameConfig || typeof gameConfig !== 'object') return null
  try {
    switch (gameId) {
      case TARGET_REACH_GAME_ID:
        return presentTargetReachResult(result as Parameters<typeof presentTargetReachResult>[0], gameConfig as TargetReachGameConfig)
      case TRAJECTORY_FOLLOW_GAME_ID:
        return presentTrajectoryFollowResult(result as TrajectoryFollowTrainingResult, gameConfig as TrajectoryFollowGameConfig)
      case RIVER_DRIFT_GAME_ID:
        return presentRiverDriftResult(result as RiverDriftTrainingResult, gameConfig as RiverDriftGameConfig)
      case KART_RACING_GAME_ID:
        return presentKartRacingResult(result as KartRacingTrainingResult, gameConfig as KartRacingGameConfig)
      default:
        return null
    }
  } catch {
    // 旧记录缺少详细字段时，页面仍保留摘要和可读回放。
    return null
  }
}
