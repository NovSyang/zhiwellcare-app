import type { GameModule } from '../../core/game/GameModule'
import type { GameResultPresentation } from '../../core/game/GameResultPresentation'
import type { GameHudSnapshot, TrainingGameEvents } from '../../core/game/TrainingGameEvents'
import type { Direction } from '../../core/training/Direction'
import type { TrainingSessionState } from '../../core/training/TrainingSessionState'
import { TargetReachReplayPlayer } from './replay/TargetReachReplayPlayer'
import { TargetReachGame } from './TargetReachGame'
import { defaultTargetReachGameConfig, type TargetReachGameConfig } from './TargetReachGameConfig'
import type { TargetReachTrainingResult } from './TargetReachTrainingResult'

/** 把已有 TargetReach 行为适配到通用多游戏契约。 */
export const targetReachGameModule: GameModule<TargetReachTrainingResult, TargetReachGameConfig> = {
  definition: {
    id: 'target-reach',
    name: '四方挥腕挑战',
    description: '按提示方向主动挥腕，将运动圆点送入目标框，训练腕部方向控制与反应协调。',
    renderer: 'pixi',
    enabled: true,
  },

  createGame(events: TrainingGameEvents<TargetReachTrainingResult>) {
    let targetIndex = 0
    let direction: Direction | null = null
    let success = 0
    let completed = 0
    let sessionState: TrainingSessionState = 'idle'
    const publishHud = (): void => events.onHudChanged?.(targetReachHud(targetIndex, direction, success, completed, sessionState))
    const game = new TargetReachGame(structuredClone(defaultTargetReachGameConfig), {
      onTargetChanged(nextDirection, nextIndex) {
        direction = nextDirection
        targetIndex = nextIndex
        publishHud()
      },
      onScoreChanged(nextSuccess, nextCompleted) {
        success = nextSuccess
        completed = nextCompleted
        publishHud()
      },
      onSessionStateChanged(state) {
        sessionState = state
        events.onSessionStateChanged?.(state)
        publishHud()
      },
      onReplayEvent: events.onReplayEvent,
      onCompleted: events.onCompleted,
    })
    publishHud()
    return game
  },

  getConfigSnapshot: () => structuredClone(defaultTargetReachGameConfig),
  presentResult: presentTargetReachResult,
  createReplayPlayer: () => new TargetReachReplayPlayer(),
}

function targetReachHud(index: number, direction: Direction | null, success: number, completed: number, state: TrainingSessionState): GameHudSnapshot {
  return {
    title: state === 'countdown' ? '准备开始' : state === 'paused' ? '训练已暂停' : direction ? `${index} · ${directionText(direction)}` : '等待目标',
    subtitle: '四方挥腕挑战',
    metrics: [
      { label: '成功', value: String(success) },
      { label: '完成', value: `${completed} / ${defaultTargetReachGameConfig.targetCount}` },
    ],
  }
}

/** TargetReach 的业务字段只在自己的 Presenter 中解释。 */
export function presentTargetReachResult(
  result: TargetReachTrainingResult,
  config: TargetReachGameConfig,
): GameResultPresentation {
  return {
    title: '四方挥腕挑战',
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

function directionText(value: Direction): string {
  return { left: '左', right: '右', forward: '前', backward: '后' }[value]
}

function percent(value: number): string { return `${(value * 100).toFixed(0)}%` }
function time(value: number | null): string { return value === null ? '--' : `${(value / 1000).toFixed(2)} s` }
function formatNumber(value: number): string { return Number.isFinite(value) ? value.toFixed(2) : '--' }
