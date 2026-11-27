import type { GameResultPresentation } from '../../core/game/GameResultPresentation'
import { RIVER_DRIFT_GAME_NAME, type RiverDriftGameConfig } from './RiverDriftGameConfig'
import type { RiverDriftTrainingResult } from './RiverDriftTrainingResult'

/** 结果页面只展示积极、易理解的训练事实。 */
export function presentRiverDriftResult(result: RiverDriftTrainingResult, config: RiverDriftGameConfig): GameResultPresentation {
  return {
    title: RIVER_DRIFT_GAME_NAME,
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
