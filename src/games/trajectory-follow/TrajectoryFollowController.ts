import type { GameInput } from '../../core/game-input/GameInput'
import type { IClock } from '../../core/time/IClock'
import type { TrainingGameEvents } from '../../core/game/TrainingGameEvents'
import { TrainingSession } from '../../core/training/TrainingSession'
import type { TrainingSessionState } from '../../core/training/TrainingSessionState'
import {
  createReferenceSamples,
  getReferenceAt,
  trackingError,
  type TrajectoryReferenceSample,
} from './TrajectoryFollowMath'
import type { TrajectoryFollowGameConfig } from './TrajectoryFollowGameConfig'
import {
  buildTrajectoryFollowTrainingResult,
  type TrajectoryFollowTrainingResult,
} from './TrajectoryFollowTrainingResult'

/** APP 与微信渲染器从同一份训练快照读取路径、引导点和指标。 */
export interface TrajectoryFollowFrame {
  session: ReturnType<TrainingSession['getSnapshot']>
  input: GameInput
  reference: readonly TrajectoryReferenceSample[]
  guide: TrajectoryReferenceSample | null
  trail: readonly TrajectoryReferenceSample[]
  currentError: number | null
  inToleranceRatio: number
}

/** 控制 8 字训练的有效时间、误差采样和结果生成。 */
export class TrajectoryFollowController {
  private readonly session: TrainingSession
  private latestInput = emptyGameInput()
  private referenceSamples: TrajectoryReferenceSample[] = []
  private metricErrors: number[] = []
  private patientTrail: TrajectoryReferenceSample[] = []
  private nextMetricElapsedMs = 0
  private currentError: number | null = null
  private inToleranceCount = 0
  private lastNotifiedState: TrainingSessionState = 'idle'

  constructor(
    private readonly clock: Pick<IClock, 'nowMonotonicMs'>,
    private readonly config: TrajectoryFollowGameConfig,
    private readonly events: TrainingGameEvents<TrajectoryFollowTrainingResult> = {},
  ) {
    this.session = new TrainingSession(clock)
  }

  getFrame(now = this.clock.nowMonotonicMs()): TrajectoryFollowFrame {
    const session = this.session.getSnapshot(now)
    return {
      session,
      input: this.latestInput,
      reference: this.referenceSamples,
      guide: getReferenceAt(this.referenceSamples, session.playingElapsedMs),
      trail: this.patientTrail,
      currentError: this.currentError,
      inToleranceRatio: this.metricErrors.length ? this.inToleranceCount / this.metricErrors.length : 0,
    }
  }

  setInput(input: GameInput): void {
    this.latestInput = input
    const state = this.session.getSnapshot().state
    if (!input.connected && (state === 'playing' || state === 'countdown')) this.pause()
  }

  start(): void {
    if (!this.latestInput.connected) throw new Error('开始训练前必须连接 BS-BT91')
    if (!this.latestInput.calibrated) throw new Error('开始训练前必须完成中心校准')
    this.referenceSamples = createReferenceSamples(this.config)
    this.metricErrors = []
    this.patientTrail = []
    this.nextMetricElapsedMs = 0
    this.currentError = null
    this.inToleranceCount = 0
    this.events.onReplayEvent?.({ elapsedMs: 0, type: 'reference-path', payload: { samples: this.referenceSamples.map((sample) => ({ ...sample })) } })
    this.session.start(this.clock.nowMonotonicMs(), 3_000)
    this.notifySessionState()
    this.publishHud()
  }

  pause(now = this.clock.nowMonotonicMs()): void {
    const state = this.session.getSnapshot(now).state
    if (state !== 'playing' && state !== 'countdown') return
    this.events.onReplayEvent?.({ elapsedMs: this.getTrainingElapsedMs(now), type: 'pause' })
    this.session.pause(now)
    this.notifySessionState()
    this.publishHud()
  }

  resume(now = this.clock.nowMonotonicMs()): void {
    if (!this.latestInput.connected) throw new Error('传感器未连接，无法继续训练')
    if (!this.latestInput.calibrated) throw new Error('请重新完成中心校准后继续训练')
    if (this.session.getSnapshot(now).state !== 'paused') return
    this.session.resume(now)
    this.events.onReplayEvent?.({ elapsedMs: this.getTrainingElapsedMs(now), type: 'resume' })
    this.notifySessionState()
    this.publishHud()
  }

  abort(): void {
    this.session.abort(this.clock.nowMonotonicMs())
    this.notifySessionState()
  }

  getTrainingElapsedMs(now = this.clock.nowMonotonicMs()): number {
    return this.session.getSnapshot(now).playingElapsedMs
  }

  /** 微信标记是否收到新姿态，APP 仍按原有固定时间点采样。 */
  update(now = this.clock.nowMonotonicMs(), hasNewInput?: boolean): void {
    this.session.update(now)
    this.notifySessionState()
    const snapshot = this.session.getSnapshot(now)
    if (snapshot.state !== 'playing') return
    if (snapshot.playingElapsedMs >= this.config.sessionDurationMs) {
      this.complete(now)
      return
    }
    if (!this.latestInput.connected || !this.latestInput.calibrated || hasNewInput === false) return
    const interval = Math.max(1, this.config.metricSampleIntervalMs)
    if (hasNewInput && this.nextMetricElapsedMs <= snapshot.playingElapsedMs) {
      // 掉帧后使用最近的采样点，避免用当前姿态补写过去的样本。
      this.nextMetricElapsedMs += Math.floor((snapshot.playingElapsedMs - this.nextMetricElapsedMs) / interval) * interval
    }
    // 使用固定有效时间点采样，页面掉帧不会改变样本时间轴。
    while (this.nextMetricElapsedMs <= snapshot.playingElapsedMs) {
      this.captureMetric(this.nextMetricElapsedMs)
      this.nextMetricElapsedMs += interval
    }
  }

  private captureMetric(elapsedMs: number): void {
    const guide = getReferenceAt(this.referenceSamples, elapsedMs)
    if (!guide) return
    this.currentError = trackingError(this.latestInput, guide)
    this.metricErrors.push(this.currentError)
    if (this.currentError <= this.config.toleranceRadius) this.inToleranceCount += 1
    this.patientTrail.push({ elapsedMs: Math.round(elapsedMs), x: this.latestInput.x, y: this.latestInput.y })
    const trailStart = elapsedMs - this.config.trailWindowMs
    while (this.patientTrail.length > 1 && this.patientTrail[0].elapsedMs < trailStart) this.patientTrail.shift()
    this.publishHud()
  }

  private complete(now: number): void {
    this.session.complete(now)
    const snapshot = this.session.getSnapshot(now)
    const result = buildTrajectoryFollowTrainingResult(
      snapshot.startedAt ?? now,
      snapshot.completedAt ?? now,
      snapshot.playingElapsedMs,
      this.metricErrors,
      this.config.toleranceRadius,
    )
    this.notifySessionState()
    this.events.onCompleted?.(result)
  }

  private notifySessionState(): void {
    const state = this.session.getSnapshot().state
    if (state === this.lastNotifiedState) return
    this.lastNotifiedState = state
    this.events.onSessionStateChanged?.(state)
  }

  private publishHud(): void {
    // 微信直接读取指标快照，无需为每个样本构造 APP 的 HUD 文本。
    if (!this.events.onHudChanged) return
    const { session: snapshot, inToleranceRatio: ratio } = this.getFrame()
    const title = snapshot.state === 'countdown' ? '准备开始' : snapshot.state === 'paused' ? '训练已暂停' : '正在跟随'
    this.events.onHudChanged({
      title,
      subtitle: '轨迹跟随训练',
      metrics: [
        { label: '当前偏差', value: this.currentError === null ? '--' : this.currentError.toFixed(2) },
        { label: '范围内', value: `${(ratio * 100).toFixed(0)}%` },
        { label: '训练时间', value: `${formatClock(snapshot.playingElapsedMs)} / ${formatClock(this.config.sessionDurationMs)}` },
      ],
    })
  }
}

function emptyGameInput(): GameInput {
  return { x: 0, y: 0, connected: false, calibrated: false, timestamp: 0 }
}

function formatClock(value: number): string {
  const seconds = Math.floor(Math.max(0, value) / 1_000)
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}
