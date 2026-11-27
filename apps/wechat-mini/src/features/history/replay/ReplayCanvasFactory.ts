import type { TrainingRecord } from '@/shared/core'
import { TARGET_REACH_GAME_ID } from '@/shared/target-config'
import { TRAJECTORY_FOLLOW_GAME_ID } from '@/shared/trajectory'
import { RIVER_DRIFT_GAME_ID } from '@/shared/river'
import { KART_RACING_GAME_ID } from '@/shared/kart'
import { isMiniTrainingGameId } from '../../../app/TrainingGames'
import type { CanvasSurface } from '../../../platform/canvas/WeChatCanvasSurface'
import { TargetReachReplayCanvas } from '../detail/TargetReachReplayCanvas'
import { TrajectoryFollowReplayCanvas } from '../detail/TrajectoryFollowReplayCanvas'
import { RiverDriftReplayCanvas } from '../detail/RiverDriftReplayCanvas'
import { KartRacingReplayCanvas } from '../detail/KartRacingReplayCanvas'

const replayCanvases = {
  [TARGET_REACH_GAME_ID]: TargetReachReplayCanvas,
  [TRAJECTORY_FOLLOW_GAME_ID]: TrajectoryFollowReplayCanvas,
  [RIVER_DRIFT_GAME_ID]: RiverDriftReplayCanvas,
  [KART_RACING_GAME_ID]: KartRacingReplayCanvas,
}

export function supportsReplay(record: TrainingRecord | null): boolean {
  return !!record?.replay && isMiniTrainingGameId(record.gameId)
}

/** 内嵌与全屏回放读取同一存档并使用同一种画布。 */
export function createReplayCanvas(record: TrainingRecord, surface: CanvasSurface) {
  if (!record.replay || !isMiniTrainingGameId(record.gameId)) return null
  const ReplayCanvas = replayCanvases[record.gameId]
  return new ReplayCanvas(surface, record.replay, record.gameConfig)
}
