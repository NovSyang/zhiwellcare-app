import type { GameModule } from '../../core/game/GameModule'
import type { GameHudSnapshot, TrainingGameEvents } from '../../core/game/TrainingGameEvents'
import type { Direction } from '../../core/training/Direction'
import type { TrainingSessionState } from '../../core/training/TrainingSessionState'
import { TargetReachReplayPlayer } from './replay/TargetReachReplayPlayer'
import { TargetReachGame } from './TargetReachGame'
import { defaultTargetReachGameConfig, TARGET_REACH_GAME_ID, TARGET_REACH_GAME_NAME, type TargetReachGameConfig } from './TargetReachGameConfig'
import type { TargetReachTrainingResult } from './TargetReachTrainingResult'
import { directionText, presentTargetReachResult } from './TargetReachResultPresentation'

export { presentTargetReachResult } from './TargetReachResultPresentation'

/** 把已有 TargetReach 行为适配到通用多游戏契约。 */
export const targetReachGameModule: GameModule<TargetReachTrainingResult, TargetReachGameConfig> = {
  definition: {
    id: TARGET_REACH_GAME_ID,
    name: TARGET_REACH_GAME_NAME,
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
    subtitle: TARGET_REACH_GAME_NAME,
    metrics: [
      { label: '成功', value: String(success) },
      { label: '完成', value: `${completed} / ${defaultTargetReachGameConfig.targetCount}` },
    ],
  }
}
