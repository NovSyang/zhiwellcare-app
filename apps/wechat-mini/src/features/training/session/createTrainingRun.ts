import type { GameHudMetric, GameResultPresentation } from '@/shared/core'
import { TARGET_REACH_GAME_ID, defaultTargetReachGameConfig } from '@/shared/target-config'
import { presentTargetReachResult } from '@/shared/target-result'
import {
  TRAJECTORY_FOLLOW_GAME_ID, TRAJECTORY_FOLLOW_GAME_NAME, TrajectoryFollowController,
  defaultTrajectoryFollowGameConfig, presentTrajectoryFollowResult,
  type TrajectoryFollowFrame, type TrajectoryFollowGameConfig, type TrajectoryFollowTrainingResult,
} from '@/shared/trajectory'
import {
  RIVER_DRIFT_GAME_ID, RIVER_DRIFT_GAME_NAME, RiverDriftController, defaultRiverDriftGameConfig,
  presentRiverDriftResult, type RiverDriftGameConfig, type RiverDriftTrainingResult,
} from '@/shared/river'
import {
  KART_RACING_GAME_ID, KART_RACING_GAME_NAME, KartRacingController, defaultKartRacingGameConfig,
  presentKartRacingResult, type KartRacingGameConfig, type KartRacingTrainingResult,
} from '@/shared/kart'
import type { MiniTrainingGameId } from '../../../app/TrainingGames'
import { RiverDriftCanvas } from '../../../platform/canvas/RiverDriftCanvas'
import { KartRacingCanvas } from '../../../platform/canvas/KartRacingCanvas'
import { TrajectoryFollowCanvas } from '../../../platform/canvas/TrajectoryFollowCanvas'
import type { CanvasSurface } from '../../../platform/canvas/WeChatCanvasSurface'
import { MiniTrainingRun, type TrainingRunOptions } from './MiniTrainingRun'
import { TargetReachCanvasRenderer } from './TargetReachCanvasRenderer'
import { TargetReachRun } from './TargetReachRun'

/** 将当前游戏的画布和指标接到同一个训练页，计分仍由共享控制器完成。 */
export function createTrainingRun(gameId: MiniTrainingGameId, options: TrainingRunOptions) {
  if (gameId === RIVER_DRIFT_GAME_ID) return createRiverRun(options)
  if (gameId === KART_RACING_GAME_ID) return createKartRun(options)
  if (gameId === TARGET_REACH_GAME_ID) {
    const config = defaultTargetReachGameConfig
    const run = new TargetReachRun({ ...options, config })
    return {
      run,
      metrics: (): GameHudMetric[] => {
        const status = run.getStatus()
        return [
          { label: '命中', value: String(status.successTargets) },
          { label: '完成', value: `${status.completedTargets} / ${config.targetCount}` },
        ]
      },
      mount: (surface: CanvasSurface) => {
        const canvas = new TargetReachCanvasRenderer(surface, config)
        return () => canvas.draw(run.getFrame())
      },
      present: (): GameResultPresentation | null => {
        const record = run.getRecord()
        return record && presentTargetReachResult(record.result, record.gameConfig)
      },
    }
  }

  const config = { ...defaultTrajectoryFollowGameConfig }
  const game = { id: TRAJECTORY_FOLLOW_GAME_ID, name: TRAJECTORY_FOLLOW_GAME_NAME, config }
  const run = new MiniTrainingRun<TrajectoryFollowTrainingResult, TrajectoryFollowGameConfig, TrajectoryFollowFrame>(
    options, game, (events) => new TrajectoryFollowController(options.clock, config, events),
  )
  return {
    run,
    metrics: (): GameHudMetric[] => {
      const frame = run.getFrame()
      return [
        { label: '当前偏差', value: frame.currentError?.toFixed(2) ?? '--' },
        { label: '范围内', value: `${(frame.inToleranceRatio * 100).toFixed(0)}%` },
      ]
    },
    mount: (surface: CanvasSurface) => {
      const canvas = new TrajectoryFollowCanvas(surface)
      return () => {
        const { session, reference, guide, trail, input } = run.getFrame()
        const label = session.state === 'countdown' ? String(Math.max(1, Math.ceil(session.countdownRemainingMs / 1000)))
          : session.state === 'paused' ? '训练已暂停' : undefined
        canvas.draw({ reference, guide, trail, player: input, tolerance: config.toleranceRadius, label })
      }
    },
    present: (): GameResultPresentation | null => {
      const record = run.getRecord()
      return record && presentTrajectoryFollowResult(record.result, record.gameConfig)
    },
  }
}

/** 漂流的场景、记分和结果都跟随同一份共享世界状态。 */
function createRiverRun(options: TrainingRunOptions) {
  const config = { ...defaultRiverDriftGameConfig }
  const game = { id: RIVER_DRIFT_GAME_ID, name: RIVER_DRIFT_GAME_NAME, config }
  const run = new MiniTrainingRun<RiverDriftTrainingResult, RiverDriftGameConfig, ReturnType<RiverDriftController['getFrame']>>(
    options, game, (events) => new RiverDriftController(options.clock, config, events, { recordScene: true }),
  )
  return {
    run,
    metrics: (): GameHudMetric[] => {
      const { collectedCoins, collisionCount } = run.getFrame()
      return [{ label: '金币', value: String(collectedCoins) }, { label: '碰撞', value: String(collisionCount) }]
    },
    mount: (surface: CanvasSurface) => {
      const canvas = new RiverDriftCanvas(surface, config)
      return () => {
        const frame = run.getFrame()
        canvas.draw({ ...frame, label: sceneLabel(frame.session) })
      }
    },
    present: (): GameResultPresentation | null => {
      const record = run.getRecord()
      return record && presentRiverDriftResult(record.result, record.gameConfig)
    },
  }
}

/** 微信在抵达终点后立即显示结果，APP 保留自己的终点演出。 */
function createKartRun(options: TrainingRunOptions) {
  const config = { ...defaultKartRacingGameConfig, finishCelebrationMs: 0 }
  const game = { id: KART_RACING_GAME_ID, name: KART_RACING_GAME_NAME, config }
  const run = new MiniTrainingRun<KartRacingTrainingResult, KartRacingGameConfig, ReturnType<KartRacingController['getFrame']>>(
    options, game, (events) => new KartRacingController(options.clock, config, events, { recordScene: true }),
  )
  return {
    run,
    metrics: (): GameHudMetric[] => {
      const { collectedCoins, collisionCount, progress } = run.getFrame()
      return [
        { label: '进度', value: `${Math.round(progress * 100)}%` },
        { label: '金币', value: String(collectedCoins) },
        { label: '碰撞', value: String(collisionCount) },
      ]
    },
    mount: (surface: CanvasSurface) => {
      const canvas = new KartRacingCanvas(surface, config)
      return () => {
        const frame = run.getFrame()
        canvas.draw({ ...frame, label: sceneLabel(frame.session) })
      }
    },
    present: (): GameResultPresentation | null => {
      const record = run.getRecord()
      return record && presentKartRacingResult(record.result, record.gameConfig)
    },
  }
}

/** 倒计时和暂停文案由公共训练状态提供。 */
function sceneLabel(session: { state: string; countdownRemainingMs: number }): string | undefined {
  if (session.state === 'countdown') return String(Math.max(1, Math.ceil(session.countdownRemainingMs / 1000)))
  return session.state === 'paused' ? '训练已暂停' : undefined
}
