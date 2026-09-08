import type { GameModule } from '../../core/game/GameModule'
import type { GameResultPresentation } from '../../core/game/GameResultPresentation'
import { RiverDriftReplayPlayer } from './replay/RiverDriftReplayPlayer'
import { RiverDriftGame } from './RiverDriftGame'
import { defaultRiverDriftGameConfig, type RiverDriftGameConfig } from './RiverDriftGameConfig'
import type { RiverDriftTrainingResult } from './RiverDriftTrainingResult'

/** 漂流模块通过统一契约接入选择、训练、结果、历史与回放。 */
export const riverDriftGameModule: GameModule<RiverDriftTrainingResult, RiverDriftGameConfig> = {
  definition: {
    id: 'river-drift',
    name: '森林溪谷漂流',
    description: '控制康复小船沿溪流前进，收集金币并躲避障碍，训练腕部连续方向控制与协调能力。',
    renderer: 'pixi',
    enabled: true,
  },
  createGame: (events) => new RiverDriftGame(structuredClone(defaultRiverDriftGameConfig), events),
  getConfigSnapshot: () => structuredClone(defaultRiverDriftGameConfig),
  presentResult: presentRiverDriftResult,
  createReplayPlayer: () => new RiverDriftReplayPlayer(),
}

/** 结果页面只展示积极、易理解的训练事实。 */
export function presentRiverDriftResult(result: RiverDriftTrainingResult, config: RiverDriftGameConfig): GameResultPresentation {
  return {
    title: '森林溪谷漂流',
    metrics: [
      { label: '金币收集', value: `${result.collectedCoins} / ${result.totalCoins}` },
      { label: '金币收集率', value: percent(result.coinCollectionRate) },
      { label: '成功避障', value: String(result.avoidedObstacles) },
      { label: '碰撞', value: String(result.collisionCount) },
      { label: '主动运动', value: percent(result.activeMovementRatio) },
      { label: '最大活动幅度', value: percent(result.maxInputMagnitude) },
    ],
    sections: [
      {
        title: '方向参与度',
        items: [
          { label: '左右活动', value: `${percent(result.leftActivity)} / ${percent(result.rightActivity)}`, detail: `平衡度 ${percent(result.horizontalMovementBalance)}` },
          { label: '前后活动', value: `${percent(result.forwardActivity)} / ${percent(result.backwardActivity)}`, detail: `平衡度 ${percent(result.verticalMovementBalance)}` },
          { label: '平均活动幅度', value: percent(result.averageInputMagnitude) },
        ],
      },
      {
        title: '当时游戏配置',
        items: [
          { label: '训练时长', value: `${(config.sessionDurationMs / 1_000).toFixed(0)} 秒` },
          { label: '河流速度', value: config.worldSpeed.toFixed(3) },
          { label: '中立死区', value: config.neutralThreshold.toFixed(2) },
          { label: '障碍总数', value: String(result.spawnedObstacles) },
        ],
      },
    ],
  }
}

function percent(value: number): string {
  return `${(Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 100).toFixed(0)}%`
}
