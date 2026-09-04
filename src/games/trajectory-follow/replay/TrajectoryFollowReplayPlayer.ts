import { Application, Graphics } from 'pixi.js'
import type {
  ITrainingReplayPlayer,
  ReplayMode,
  ReplayPlayerSnapshot,
  ReplayPlayerState,
} from '../../../core/replay/ITrainingReplayPlayer'
import { clamp, downsampleForDisplay, sampleAtElapsed } from '../../../core/replay/ReplayMath'
import type { ReplayEvent, TrainingReplay } from '../../../core/replay/TrainingReplay'
import { copyTrainingReplay } from '../../../core/replay/TrainingReplayCopy'
import type { TrajectoryReferenceSample } from '../TrajectoryFollowMath'

/** 只播放保存的患者轨迹和参考路径，不重新计算 8 字公式或训练指标。 */
export class TrajectoryFollowReplayPlayer implements ITrainingReplayPlayer {
  private app: Application | null = null
  private replay: TrainingReplay | null = null
  private referenceSamples: TrajectoryReferenceSample[] = []
  private mode: ReplayMode = 'dynamic'
  private state: ReplayPlayerState = 'idle'
  private currentTimeMs = 0
  private playbackRate = 1
  private lastTickAt = 0
  private referenceGraphic: Graphics | null = null
  private patientPathGraphic: Graphics | null = null
  private playerGraphic: Graphics | null = null
  private guideGraphic: Graphics | null = null
  private listeners = new Set<(snapshot: ReplayPlayerSnapshot) => void>()
  private resizeObserver: ResizeObserver | null = null

  async mount(container: HTMLElement): Promise<void> {
    this.destroy()
    const app = new Application()
    await app.init({ resizeTo: container, antialias: true, background: '#08111f', resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true })
    container.appendChild(app.canvas)
    this.referenceGraphic = new Graphics()
    this.patientPathGraphic = new Graphics()
    this.guideGraphic = new Graphics()
    this.playerGraphic = new Graphics()
    app.stage.addChild(this.referenceGraphic, this.patientPathGraphic, this.guideGraphic, this.playerGraphic)
    this.app = app
    // 参考路径和患者完整轨迹在弹窗尺寸变化后按新画布重新绘制。
    this.resizeObserver = new ResizeObserver(() => requestAnimationFrame(() => this.render()))
    this.resizeObserver.observe(container)
    app.ticker.add(() => this.tick(performance.now()))
    this.render()
  }

  load(replay: TrainingReplay): void {
    this.replay = copyTrainingReplay(replay)
    this.referenceSamples = extractReferenceSamples(this.replay.events)
    if (this.referenceSamples.length === 0) throw new Error('轨迹回放缺少训练时保存的参考路径。')
    this.currentTimeMs = 0
    this.state = 'paused'
    this.lastTickAt = 0
    this.render()
    this.publish()
  }

  setMode(mode: ReplayMode): void {
    this.mode = mode
    this.pause()
    this.render()
  }

  play(): void {
    if (!this.replay || this.replay.durationMs <= 0 || this.referenceSamples.length === 0) return
    if (this.currentTimeMs >= this.replay.durationMs) this.currentTimeMs = 0
    this.state = 'playing'
    this.lastTickAt = performance.now()
    this.publish()
  }

  pause(): void {
    if (this.state !== 'playing') return
    this.state = 'paused'
    this.publish()
  }

  restart(): void { this.seek(0); this.pause() }

  seek(elapsedMs: number): void {
    const duration = this.replay?.durationMs ?? 0
    this.currentTimeMs = Math.max(0, Math.min(duration, Math.round(elapsedMs)))
    if (duration > 0 && this.currentTimeMs >= duration) this.state = 'ended'
    else if (this.state === 'ended') this.state = 'paused'
    this.render()
    this.publish()
  }

  setPlaybackRate(rate: number): void {
    this.playbackRate = [0.5, 1, 2].includes(rate) ? rate : 1
    this.publish()
  }

  getSnapshot(): ReplayPlayerSnapshot {
    return { state: this.state, currentTimeMs: this.currentTimeMs, durationMs: this.replay?.durationMs ?? 0, playbackRate: this.playbackRate }
  }

  onChanged(callback: (snapshot: ReplayPlayerSnapshot) => void): () => void {
    this.listeners.add(callback)
    callback(this.getSnapshot())
    return () => this.listeners.delete(callback)
  }

  destroy(): void {
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.app?.destroy(true, { children: true })
    this.app = null
    this.referenceGraphic = null
    this.patientPathGraphic = null
    this.playerGraphic = null
    this.guideGraphic = null
    this.state = 'idle'
  }

  private tick(now: number): void {
    if (this.state !== 'playing' || !this.replay) return
    const next = this.currentTimeMs + Math.max(0, now - this.lastTickAt) * this.playbackRate
    this.lastTickAt = now
    if (next >= this.replay.durationMs) {
      this.currentTimeMs = this.replay.durationMs
      this.state = 'ended'
    } else this.currentTimeMs = next
    this.render()
    this.publish()
  }

  private render(): void {
    if (!this.app || !this.replay || !this.referenceGraphic || !this.patientPathGraphic || !this.playerGraphic || !this.guideGraphic) return
    this.drawPath(this.referenceGraphic, downsampleForDisplay(this.referenceSamples), 0x4da3ff, 3, 0.58)
    if (this.mode === 'trajectory') this.renderFullTrajectory()
    else this.renderDynamic()
  }

  private renderDynamic(): void {
    const patient = sampleAtElapsed(this.replay!.samples, this.currentTimeMs)
    const guide = sampleAtElapsed(this.referenceSamples, this.currentTimeMs)
    const trailStart = Math.max(0, this.currentTimeMs - 2_500)
    const trail = this.replay!.samples.filter((sample) => sample.elapsedMs >= trailStart && sample.elapsedMs <= this.currentTimeMs)
    this.drawPath(this.patientPathGraphic!, trail, 0x68d391, 4, 0.85)
    if (patient) this.drawDot(this.playerGraphic!, patient.x, patient.y, 15, 0x68d391)
    else this.playerGraphic!.clear()
    if (guide) this.drawDot(this.guideGraphic!, guide.x, guide.y, 18, 0x8fd8ff, true)
    else this.guideGraphic!.clear()
  }

  private renderFullTrajectory(): void {
    this.playerGraphic!.clear()
    this.guideGraphic!.clear()
    this.drawPath(this.patientPathGraphic!, downsampleForDisplay(this.replay!.samples), 0x68d391, 3, 0.88)
  }

  private drawPath(graphic: Graphics, samples: readonly { x: number; y: number }[], color: number, width: number, alpha: number): void {
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
    const padding = 60
    return { x: screen.width / 2 + x * Math.max(0, screen.width / 2 - padding), y: screen.height / 2 - y * Math.max(0, screen.height / 2 - padding) }
  }

  private publish(): void {
    const snapshot = this.getSnapshot()
    for (const listener of this.listeners) listener(snapshot)
  }
}

/** 从保存事件中严格读取参考样本，缺失时让页面保持静态而不是重算路径。 */
export function extractReferenceSamples(events: readonly ReplayEvent[]): TrajectoryReferenceSample[] {
  const event = events.find((item) => item.type === 'reference-path')
  if (!event?.payload || typeof event.payload !== 'object') return []
  const values = (event.payload as { samples?: unknown }).samples
  if (!Array.isArray(values)) return []
  return values.flatMap((value) => {
    if (!value || typeof value !== 'object') return []
    const sample = value as Partial<TrajectoryReferenceSample>
    if (![sample.elapsedMs, sample.x, sample.y].every((item) => typeof item === 'number' && Number.isFinite(item))) return []
    return [{ elapsedMs: Math.max(0, Math.round(sample.elapsedMs as number)), x: clamp(sample.x as number, -1, 1), y: clamp(sample.y as number, -1, 1) }]
  }).sort((a, b) => a.elapsedMs - b.elapsedMs)
}
