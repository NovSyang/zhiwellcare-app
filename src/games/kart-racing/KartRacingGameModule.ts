import type { GameModule } from '../../core/game/GameModule'
import type { GameResultPresentation } from '../../core/game/GameResultPresentation'
import { KartRacingGame } from './KartRacingGame'
import { defaultKartRacingGameConfig, type KartRacingGameConfig } from './KartRacingGameConfig'
import type { KartRacingTrainingResult } from './KartRacingTrainingResult'
import { KartRacingReplayPlayer } from './replay/KartRacingReplayPlayer'

/** 卡丁车模块通过统一契约接入选择、训练、结果、历史与回放。 */
export const kartRacingGameModule: GameModule<KartRacingTrainingResult, KartRacingGameConfig> = {
  definition: {
    id: 'kart-racing',
    name: '欢乐卡丁车',
    description: '控制卡丁车完成固定赛道，通过左右转向、前向加速和后向减速进行四方向协调训练。',
    renderer: 'pixi',
    enabled: true,
  },
  createGame: (events) => new KartRacingGame(structuredClone(defaultKartRacingGameConfig), events),
  getConfigSnapshot: () => structuredClone(defaultKartRacingGameConfig),
  presentResult: presentKartRacingResult,
  createReplayPlayer: () => new KartRacingReplayPlayer(),
}

/** 结果页只展示积极、易理解的驾驶和动作参与事实。 */
export function presentKartRacingResult(result: KartRacingTrainingResult, config: KartRacingGameConfig): GameResultPresentation {
  return {
    title: '欢乐卡丁车',
    metrics: [
      { label: '完成时间', value: formatDuration(result.durationMs) },
      { label: '赛道进度', value: percent(result.trackProgress) },
      { label: '金币收集', value: `${result.collectedCoins} / ${result.totalCoins}` },
      { label: '成功避障', value: String(result.avoidedObstacles) },
      { label: '碰撞', value: String(result.collisionCount) },
      { label: '主动运动', value: percent(result.activeMovementRatio) },
    ],
    sections: [
      {
        title: '驾驶参与',
        items: [
          { label: '平均速度强度', value: percent(result.averageSpeedRatio, 1.12) },
          { label: '最高速度强度', value: percent(result.maxSpeedRatio, 1.12) },
          { label: '加速参与', value: percent(result.accelerationParticipation) },
          { label: '减速参与', value: percent(result.brakingParticipation) },
        ],
      },
      {
        title: '方向参与度',
        items: [
          { label: '左右活动', value: `${percent(result.leftActivity)} / ${percent(result.rightActivity)}`, detail: `平衡度 ${percent(result.horizontalMovementBalance)}` },
          { label: '前后活动', value: `${percent(result.forwardActivity)} / ${percent(result.backwardActivity)}`, detail: `平衡度 ${percent(result.verticalMovementBalance)}` },
          { label: '平均活动幅度', value: percent(result.averageInputMagnitude) },
          { label: '最大活动幅度', value: percent(result.maxInputMagnitude) },
        ],
      },
      {
        title: '当时游戏配置',
        items: [
          { label: '完成方式', value: result.completionReason === 'finish-line' ? '到达终点' : '本次训练完成' },
          { label: '赛道长度', value: String(config.trackLength) },
          { label: '最长时长', value: `${Math.round(config.maxSessionDurationMs / 1_000)} 秒` },
        ],
      },
    ],
  }
}

function percent(value: number, upper = 1): string {
  const safe = Math.max(0, Math.min(upper, Number.isFinite(value) ? value : 0))
  return `${(safe * 100).toFixed(0)}%`
}

function formatDuration(value: number): string {
  const seconds = Math.max(0, Math.round(value / 1_000))
  return `${Math.floor(seconds / 60)}分${(seconds % 60).toString().padStart(2, '0')}秒`
}
