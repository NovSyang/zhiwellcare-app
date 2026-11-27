import type { GameModule } from '../../core/game/GameModule'
import { TrajectoryFollowReplayPlayer } from './replay/TrajectoryFollowReplayPlayer'
import { presentTrajectoryFollowResult } from './TrajectoryFollowResultPresentation'
import { TrajectoryFollowGame } from './TrajectoryFollowGame'
import {
  TRAJECTORY_FOLLOW_GAME_ID, TRAJECTORY_FOLLOW_GAME_NAME, defaultTrajectoryFollowGameConfig,
  type TrajectoryFollowGameConfig,
} from './TrajectoryFollowGameConfig'
import type { TrajectoryFollowTrainingResult } from './TrajectoryFollowTrainingResult'

// 兼容从 APP 游戏模块读取结果文案的调用方。
export { presentTrajectoryFollowResult } from './TrajectoryFollowResultPresentation'

/** 轨迹跟随游戏对应用层只暴露通用 GameModule 能力。 */
export const trajectoryFollowGameModule: GameModule<TrajectoryFollowTrainingResult, TrajectoryFollowGameConfig> = {
  definition: {
    id: TRAJECTORY_FOLLOW_GAME_ID,
    name: TRAJECTORY_FOLLOW_GAME_NAME,
    description: '主动匀速挥腕，沿 8 字引导轨迹移动训练点，训练手腕轨迹控制与稳定性。',
    renderer: 'pixi',
    enabled: true,
  },
  createGame: (events) => new TrajectoryFollowGame(structuredClone(defaultTrajectoryFollowGameConfig), events),
  getConfigSnapshot: () => structuredClone(defaultTrajectoryFollowGameConfig),
  presentResult: presentTrajectoryFollowResult,
  createReplayPlayer: () => new TrajectoryFollowReplayPlayer(),
}
