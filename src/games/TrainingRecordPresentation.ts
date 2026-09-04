import type { GameResultPresentation } from '../core/game/GameResultPresentation'
import type { TrainingRecord } from '../core/training/TrainingRecord'
import { getGameModule } from './GameRegistry'

/** 安全解释历史记录；未知游戏或损坏数据不会让页面崩溃。 */
export function presentTrainingRecord(record: TrainingRecord): GameResultPresentation | null {
  const module = getGameModule(record.gameId)
  if (!module) return null
  try {
    return module.presentResult(record.result, record.gameConfig)
  } catch {
    return null
  }
}
