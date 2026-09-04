import { Application, Graphics, Text } from 'pixi.js'
import type { GameInput } from '../../core/game-input/GameInput'
import type { ITrainingGame } from '../../core/game/ITrainingGame'
import type { TrainingGameEvents } from '../../core/game/TrainingGameEvents'
import { TrainingSession } from '../../core/training/TrainingSession'
import type { TrainingSessionState } from '../../core/training/TrainingSessionState'
import {
  createReferenceSamples,
  getReferenceAt,
  trackingError,
  type TrajectoryReferenceSample,
} from './TrajectoryFollowMath'
import {
  defaultTrajectoryFollowGameConfig,
  type TrajectoryFollowGameConfig,
} from './TrajectoryFollowGameConfig'
import {
  buildTrajectoryFollowTrainingResult,
  type TrajectoryFollowTrainingResult,
} from './TrajectoryFollowTrainingResult'

/** 使用标准化 GameInput 完成连续二维 8 字轨迹跟随训练。 */
export class TrajectoryFollowGame implements ITrainingGame<TrajectoryFollowTrainingResult> {
  private app: Application | null = null
  private session = new TrainingSession()
  private latestInput = emptyGameInput()
  private referenceSamples: TrajectoryReferenceSample[] = []
  private metricErrors: number[] = []
  private patientTrail: TrajectoryReferenceSample[] = []
  private nextMetricElapsedMs = 0
  private currentError: number | null = null
  private lastNotifiedState: TrainingSessionState = 'idle'
  private referenceGraphic: Graphics | null = null
  private trailGraphic: Graphics | null = null
  private playerGraphic: Graphics | null = null
  private guideGraphic: Graphics | null = null
  private countdownText: Text | null = null
  private resizeObserver: ResizeObserver | null = null

  constructor(
    private readonly config: TrajectoryFollowGameConfig = structuredClone(defaultTrajectoryFollowGameConfig),
    private readonly events: TrainingGameEvents<TrajectoryFollowTrainingResult> = {},
  ) {}

  async mount(container: HTMLElement): Promise<void> {
    this.destroy()
    const app = new Application()
    await app.init({ resizeTo: container, antialias: true, background: '#08111f', resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true })
    container.appendChild(app.canvas)
    this.referenceGraphic = new Graphics()
    this.trailGraphic = new Graphics()
    this.playerGraphic = new Graphics()
    this.guideGraphic = new Graphics()
    this.countdownText = new Text({ text: '', style: { fill: '#ffffff', fontSize: 72, fontWeight: '700' } })
    this.countdownText.anchor.set(0.5)
    app.stage.addChild(this.referenceGraphic, this.trailGraphic, this.guideGraphic, this.playerGraphic, this.countdownText)
    this.app = app
    // Reference Path 是静态图层，横竖屏切换后必须用新画布尺寸重新绘制。
    this.resizeObserver = new ResizeObserver(() => requestAnimationFrame(() => {
      this.drawReferencePath()
      this.render(performance.now())
    }))
    this.resizeObserver.observe(container)
    app.ticker.add(() => {
      const now = performance.now()
      this.update(now)
      this.render(now)
    })
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
    this.events.onReplayEvent?.({ elapsedMs: 0, type: 'reference-path', payload: { samples: structuredClone(this.referenceSamples) } })
    this.session.start(performance.now(), 3_000)
    this.drawReferencePath()
    this.notifySessionState()
    this.publishHud()
  }

  pause(now = performance.now()): void {
    const state = this.session.getSnapshot(now).state
    if (state !== 'playing' && state !== 'countdown') return
    this.events.onReplayEvent?.({ elapsedMs: this.getTrainingElapsedMs(now), type: 'pause' })
    this.session.pause(now)
    this.notifySessionState()
    this.publishHud()
  }

  resume(now = performance.now()): void {
    if (!this.latestInput.connected) throw new Error('传感器未连接，无法继续训练')
    if (!this.latestInput.calibrated) throw new Error('请重新完成中心校准后继续训练')
    if (this.session.getSnapshot(now).state !== 'paused') return
    this.session.resume(now)
    this.events.onReplayEvent?.({ elapsedMs: this.getTrainingElapsedMs(now), type: 'resume' })
    this.notifySessionState()
    this.publishHud()
  }

  abort(): void {
    this.session.abort(performance.now())
    this.notifySessionState()
  }

  destroy(): void {
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.app?.destroy(true, { children: true })
    this.app = null
    this.referenceGraphic = null
    this.trailGraphic = null
    this.playerGraphic = null
    this.guideGraphic = null
    this.countdownText = null
  }

  getTrainingElapsedMs(now = performance.now()): number {
    return this.session.getSnapshot(now).playingElapsedMs
  }

  private update(now: number): void {
    this.session.update(now)
    this.notifySessionState()
    const snapshot = this.session.getSnapshot(now)
    if (snapshot.state !== 'playing') return
    if (snapshot.playingElapsedMs >= this.config.sessionDurationMs) {
      this.complete(now)
      return
    }
    if (!this.latestInput.connected || !this.latestInput.calibrated) return
    // 使用固定有效时间点采样，页面掉帧不会改变样本时间轴。
    while (this.nextMetricElapsedMs <= snapshot.playingElapsedMs) {
      this.captureMetric(this.nextMetricElapsedMs)
      this.nextMetricElapsedMs += Math.max(1, this.config.metricSampleIntervalMs)
    }
  }

  private captureMetric(elapsedMs: number): void {
    const guide = getReferenceAt(this.referenceSamples, elapsedMs)
    if (!guide) return
    this.currentError = trackingError(this.latestInput, guide)
    this.metricErrors.push(this.currentError)
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

  private render(now: number): void {
    if (!this.app || !this.playerGraphic || !this.guideGraphic || !this.trailGraphic || !this.countdownText) return
    const snapshot = this.session.getSnapshot(now)
    const guide = getReferenceAt(this.referenceSamples, snapshot.playingElapsedMs)
    this.drawDot(this.playerGraphic, this.latestInput.x, this.latestInput.y, this.config.playerRadius, 0x68d391)
    this.playerGraphic.alpha = this.latestInput.connected ? 1 : 0.35
    if (guide) this.drawDot(this.guideGraphic, guide.x, guide.y, this.config.guideRadius, 0x8fd8ff, true)
    this.drawPath(this.trailGraphic, this.patientTrail, 0x68d391, 4, 0.85)
    if (snapshot.state === 'countdown') {
      this.countdownText.text = String(Math.max(1, Math.ceil(snapshot.countdownRemainingMs / 1_000)))
      this.countdownText.position.set(this.app.screen.width / 2, this.app.screen.height / 2)
      this.countdownText.visible = true
    } else this.countdownText.visible = false
  }

  private drawReferencePath(): void {
    if (this.referenceGraphic) this.drawPath(this.referenceGraphic, this.referenceSamples, 0x4da3ff, 3, 0.55)
  }

  private drawPath(graphic: Graphics, samples: readonly Pick<TrajectoryReferenceSample, 'x' | 'y'>[], color: number, width: number, alpha: number): void {
    graphic.clear()
    if (samples.length < 2) return
    const first = this.toScreen(samples[0].x, samples[0].y)
    graphic.moveTo(first.x, first.y)
    for (const sample of samples.slice(1)) {
      const point = this.toScreen(sample.x, sample.y)
      graphic.lineTo(point.x, point.y)
    }
    graphic.stroke({ width, color, alpha })
  }

  private drawDot(graphic: Graphics, x: number, y: number, radius: number, color: number, outline = false): void {
    const point = this.toScreen(x, y)
    graphic.clear().circle(point.x, point.y, radius)
    outline ? graphic.stroke({ width: 5, color, alpha: 1 }) : graphic.fill(color)
  }

  private toScreen(x: number, y: number): { x: number; y: number } {
    const screen = this.app!.screen
    const padding = 70
    return { x: screen.width / 2 + x * Math.max(0, screen.width / 2 - padding), y: screen.height / 2 - y * Math.max(0, screen.height / 2 - padding) }
  }

  private notifySessionState(): void {
    const state = this.session.getSnapshot().state
    if (state === this.lastNotifiedState) return
    this.lastNotifiedState = state
    this.events.onSessionStateChanged?.(state)
  }

  private publishHud(): void {
    const snapshot = this.session.getSnapshot()
    const ratio = this.metricErrors.length === 0 ? 0 : this.metricErrors.filter((value) => value <= this.config.toleranceRadius).length / this.metricErrors.length
    const title = snapshot.state === 'countdown' ? '准备开始' : snapshot.state === 'paused' ? '训练已暂停' : '正在跟随'
    this.events.onHudChanged?.({
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
