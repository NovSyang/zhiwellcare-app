import type { GameResultPresentation } from '../../core/game/GameResultPresentation'
import { TRAJECTORY_FOLLOW_GAME_NAME, type TrajectoryFollowGameConfig } from './TrajectoryFollowGameConfig'
import type { TrajectoryFollowTrainingResult } from './TrajectoryFollowTrainingResult'

/** 将归一化误差指标转换为中立、易读的工程训练结果。 */
export function presentTrajectoryFollowResult(
  result: TrajectoryFollowTrainingResult,
  config: TrajectoryFollowGameConfig,
): GameResultPresentation {
  return {
    title: TRAJECTORY_FOLLOW_GAME_NAME,
    metrics: [
      { label: '范围内比例', value: `${(result.inToleranceRatio * 100).toFixed(0)}%` },
      { label: '平均跟随偏差', value: metric(result.averageTrackingError) },
      { label: '最大跟随偏差', value: metric(result.maxTrackingError) },
      { label: '范围内时间', value: `${(result.inToleranceDurationMs / 1_000).toFixed(1)} s` },
      { label: '有效样本', value: String(result.sampleCount) },
    ],
    sections: [{
      title: '当时游戏配置',
      items: [
        { label: '轨迹类型', value: '8 字' },
        { label: '横向幅度', value: `${(config.horizontalAmplitude * 100).toFixed(0)}%` },
        { label: '纵向幅度', value: `${(config.verticalAmplitude * 100).toFixed(0)}%` },
        { label: '周期', value: `${(config.cycleDurationMs / 1_000).toFixed(1)} s` },
        { label: '容差半径', value: config.toleranceRadius.toFixed(2) },
      ],
    }],
  }
}

function metric(value: number | null): string { return value === null ? '--' : value.toFixed(3) }
