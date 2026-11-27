import type { GameResultPresentation } from '../../core/game/GameResultPresentation'
import type { Direction } from '../../core/training/Direction'
import { TARGET_REACH_GAME_NAME, type TargetReachGameConfig } from './TargetReachGameConfig'
import type { TargetReachTrainingResult } from './TargetReachTrainingResult'

/** TargetReach 的业务字段只在自己的 Presenter 中解释。 */
export function presentTargetReachResult(
  result: TargetReachTrainingResult,
  config: TargetReachGameConfig,
): GameResultPresentation {
  return {
    title: TARGET_REACH_GAME_NAME,
    metrics: [
      { label: '成功率', value: percent(result.successRate) },
      { label: '目标总数', value: String(result.totalTargets) },
      { label: '成功 / 失败', value: `${result.successTargets} / ${result.failedTargets}` },
      { label: '平均反应时间', value: time(result.averageReactionTimeMs) },
      { label: '平均到达时间', value: time(result.averageReachTimeMs) },
    ],
    sections: [
      {
        title: '四方向表现',
        items: (['left', 'right', 'forward', 'backward'] as Direction[]).map((direction) => ({
          label: directionText(direction),
          value: `${result.directions[direction].success} / ${result.directions[direction].total}`,
          detail: `平均到达 ${time(result.directions[direction].averageReachTimeMs)}`,
        })),
      },
      {
        title: '当时游戏配置',
        items: [
          { label: '目标距离', value: formatNumber(config.targetDistance) },
          { label: '保持时间', value: `${config.holdTimeMs} ms` },
          { label: '单目标超时', value: `${config.targetTimeoutMs} ms` },
          { label: '目标数量', value: String(config.targetCount) },
        ],
      },
    ],
  }
}

/** 用相同中文方向名称展示结果。 */
export function directionText(value: Direction): string {
  return { left: '左', right: '右', forward: '前', backward: '后' }[value]
}

function percent(value: number): string { return `${(value * 100).toFixed(0)}%` }
function time(value: number | null): string { return value === null ? '--' : `${(value / 1000).toFixed(2)} s` }
function formatNumber(value: number): string { return Number.isFinite(value) ? value.toFixed(2) : '--' }
