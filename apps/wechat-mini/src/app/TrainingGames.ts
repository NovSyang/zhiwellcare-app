import { ALL_DIRECTIONS } from '@/shared/core'
import { TARGET_REACH_GAME_ID, TARGET_REACH_GAME_NAME, defaultTargetReachGameConfig } from '@/shared/target-config'
import { TRAJECTORY_FOLLOW_GAME_ID, TRAJECTORY_FOLLOW_GAME_NAME, defaultTrajectoryFollowGameConfig } from '@/shared/trajectory'
import { RIVER_DRIFT_GAME_ID, RIVER_DRIFT_GAME_NAME, defaultRiverDriftGameConfig } from '@/shared/river'
import { KART_RACING_GAME_ID, KART_RACING_GAME_NAME, defaultKartRacingGameConfig } from '@/shared/kart'

const trajectory = defaultTrajectoryFollowGameConfig
const target = defaultTargetReachGameConfig

/** 只有已接入微信原生画布的游戏，才会从目录出现在训练大厅。 */
export const miniTrainingGames = {
  [TARGET_REACH_GAME_ID]: {
    name: TARGET_REACH_GAME_NAME,
    description: `${ALL_DIRECTIONS.length} 个目标方向 · 最长 ${target.sessionDurationMs / 1000} 秒`,
    instructions: `按方向提示移动圆点，进入目标后保持 ${target.holdTimeMs} 毫秒。`,
  },
  [TRAJECTORY_FOLLOW_GAME_ID]: {
    name: TRAJECTORY_FOLLOW_GAME_NAME,
    description: `${trajectory.cycleDurationMs / 1000} 秒一圈 · 共 ${trajectory.sessionDurationMs / 1000} 秒`,
    instructions: '挥腕移动绿色圆点，跟随蓝色引导点，尽量保持在它的蓝色圆圈内。',
  },
  [RIVER_DRIFT_GAME_ID]: {
    name: RIVER_DRIFT_GAME_NAME,
    description: `${defaultRiverDriftGameConfig.sessionDurationMs / 1000} 秒 · 收集金币并避开障碍`,
    instructions: '轻轻向左右或前后挥腕移动小船，沿河道收集金币并避开障碍。',
  },
  [KART_RACING_GAME_ID]: {
    name: KART_RACING_GAME_NAME,
    description: `固定赛道 · 最长 ${defaultKartRacingGameConfig.maxSessionDurationMs / 1000} 秒`,
    instructions: '左右挥腕转向，前挥加速，后挥减速。沿途可收集金币、护盾与加速道具。',
  },
}

export type MiniTrainingGameId = keyof typeof miniTrainingGames

export function isMiniTrainingGameId(gameId: unknown): gameId is MiniTrainingGameId {
  return typeof gameId === 'string' && Object.prototype.hasOwnProperty.call(miniTrainingGames, gameId)
}
