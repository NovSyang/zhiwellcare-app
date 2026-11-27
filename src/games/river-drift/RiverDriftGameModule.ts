import type { GameModule } from '../../core/game/GameModule'
import { presentRiverDriftResult } from './RiverDriftResultPresentation'
import { RiverDriftReplayPlayer } from './replay/RiverDriftReplayPlayer'
import { RiverDriftGame } from './RiverDriftGame'
import { defaultRiverDriftGameConfig, RIVER_DRIFT_GAME_ID, RIVER_DRIFT_GAME_NAME, type RiverDriftGameConfig } from './RiverDriftGameConfig'
import type { RiverDriftTrainingResult } from './RiverDriftTrainingResult'

/** 漂流模块通过统一契约接入选择、训练、结果、历史与回放。 */
export const riverDriftGameModule: GameModule<RiverDriftTrainingResult, RiverDriftGameConfig> = {
  definition: {
    id: RIVER_DRIFT_GAME_ID,
    name: RIVER_DRIFT_GAME_NAME,
    description: '控制康复小船沿溪流前进，收集金币并躲避障碍，训练腕部连续方向控制与协调能力。',
    renderer: 'pixi',
    enabled: true,
  },
  createGame: (events) => new RiverDriftGame(structuredClone(defaultRiverDriftGameConfig), events),
  getConfigSnapshot: () => structuredClone(defaultRiverDriftGameConfig),
  presentResult: presentRiverDriftResult,
  createReplayPlayer: () => new RiverDriftReplayPlayer(),
}

// 保留原游戏模块的结果展示入口。
export { presentRiverDriftResult } from './RiverDriftResultPresentation'
