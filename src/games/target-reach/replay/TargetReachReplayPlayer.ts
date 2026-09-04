import { Application, Container, Graphics, Text } from 'pixi.js'
import type { ITrainingReplayPlayer, ReplayMode, ReplayPlayerSnapshot, ReplayPlayerState } from '../../../core/replay/ITrainingReplayPlayer'
import { downsampleForDisplay, sampleAtElapsed } from '../../../core/replay/ReplayMath'
import { copyTrainingReplay } from '../../../core/replay/TrainingReplayCopy'
import type { ReplayEvent, TrainingReplay } from '../../../core/replay/TrainingReplay'

export type { ReplayMode, ReplayPlayerSnapshot, ReplayPlayerState } from '../../../core/replay/ITrainingReplayPlayer'
export { copyTrainingReplay } from '../../../core/replay/TrainingReplayCopy'

interface HistoricalTarget {
  index: number
  x: number
  y: number
  outcome: 'success' | 'failed' | null
}

/**
 * 只绘制已保存的 TargetReach 历史事实。
 * 它不会生成随机目标、连接 BLE 或重新执行任何命中判定。
 */
export class TargetReachReplayPlayer implements ITrainingReplayPlayer {
  private app: Application | null = null
  private replay: TrainingReplay | null = null
  private mode: ReplayMode = 'dynamic'
  private state: ReplayPlayerState = 'idle'
  private currentTimeMs = 0
  private playbackRate = 1
  private lastTickAt = 0
  private playerGraphic: Graphics | null = null
  private targetGraphic: Graphics | null = null
  private pathGraphic: Graphics | null = null
  private labels = new Container()
  private listeners = new Set<(snapshot: ReplayPlayerSnapshot) => void>()
  private resizeObserver: ResizeObserver | null = null

  async mount(container: HTMLElement): Promise<void> {
    this.destroy()
    const app = new Application()
    await app.init({ resizeTo: container, antialias: true, background: '#08111f', resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true })
    container.appendChild(app.canvas)
    this.playerGraphic = new Graphics()
    this.targetGraphic = new Graphics()
    this.pathGraphic = new Graphics()
    app.stage.addChild(this.pathGraphic, this.targetGraphic, this.playerGraphic, this.labels)
    this.app = app
    // 回放的完整轨迹是静态几何，Dialog 尺寸变化后需要重新映射坐标。
    this.resizeObserver = new ResizeObserver(() => requestAnimationFrame(() => this.render()))
    this.resizeObserver.observe(container)
    app.ticker.add(() => this.tick(performance.now()))
    this.render()
  }

  load(replay: TrainingReplay): void {
    // 调用方可能传入 Vue Proxy；显式复制基础字段，避免 structuredClone 直接克隆 Proxy。
    this.replay = copyTrainingReplay(replay)
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
    if (!this.replay || this.replay.durationMs <= 0) return
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
    this.playerGraphic = null
    this.targetGraphic = null
    this.pathGraphic = null
    this.labels = new Container()
    this.state = 'idle'
  }

  private tick(now: number): void {
    if (this.state !== 'playing' || !this.replay) return
    const delta = Math.max(0, now - this.lastTickAt)
    this.lastTickAt = now
    const next = this.currentTimeMs + delta * this.playbackRate
    if (next >= this.replay.durationMs) {
      this.currentTimeMs = this.replay.durationMs
      this.state = 'ended'
    } else this.currentTimeMs = next
    this.render()
    this.publish()
  }

  private render(): void {
    if (!this.app || !this.playerGraphic || !this.targetGraphic || !this.pathGraphic || !this.replay) return
    if (this.mode === 'trajectory') this.renderFullTrajectory()
    else this.renderDynamic()
  }

  private renderDynamic(): void {
    const replay = this.replay!
    const point = sampleAtElapsed(replay.samples, this.currentTimeMs)
    this.pathGraphic!.clear()
    this.targetGraphic!.clear()
    this.clearLabels()
    this.drawCenter()
    const target = this.targetAt(this.currentTimeMs)
    if (target) this.drawTarget(target)
    if (point) {
      this.drawPath(replay.samples.filter((sample) => sample.elapsedMs >= this.currentTargetStartedAt(this.currentTimeMs) && sample.elapsedMs <= this.currentTimeMs), 0x68d391, 3)
      const screen = this.toScreen(point.x, point.y)
      this.playerGraphic!.clear().circle(screen.x, screen.y, 14).fill(0x68d391)
    } else this.playerGraphic!.clear()
  }

  private renderFullTrajectory(): void {
    const replay = this.replay!
    this.playerGraphic!.clear()
    this.targetGraphic!.clear()
    this.clearLabels()
    this.drawCenter()
    this.drawPath(downsampleForDisplay(replay.samples), 0x8fd8ff, 2)
    for (const target of this.allTargets()) this.drawTarget(target, true)
  }

  private drawPath(samples: readonly { x: number; y: number }[], color: number, width: number): void {
    this.pathGraphic!.clear()
    if (samples.length < 2) return
    const first = this.toScreen(samples[0].x, samples[0].y)
    this.pathGraphic!.moveTo(first.x, first.y)
    for (const sample of samples.slice(1)) {
      const point = this.toScreen(sample.x, sample.y)
      this.pathGraphic!.lineTo(point.x, point.y)
    }
    this.pathGraphic!.stroke({ width, color, alpha: 0.82 })
  }

  private drawTarget(target: HistoricalTarget, withLabel = false): void {
    const point = this.toScreen(target.x, target.y)
    const color = target.outcome === 'success' ? 0x68d391 : target.outcome === 'failed' ? 0xfc8181 : 0x4da3ff
    this.targetGraphic!.circle(point.x, point.y, 24).stroke({ width: 4, color, alpha: 1 })
    if (withLabel) {
      const label = new Text({ text: String(target.index), style: { fill: '#ffffff', fontSize: 13, fontWeight: '700' } })
      label.anchor.set(0.5)
      label.position.set(point.x, point.y)
      this.labels.addChild(label)
    }
  }

  /** 中心点帮助查看者判断是否回到中立位置，不代表新的游戏事件。 */
  private drawCenter(): void {
    const center = this.toScreen(0, 0)
    this.targetGraphic!.circle(center.x, center.y, 8).stroke({ width: 2, color: 0x91a3ba, alpha: 0.8 })
  }

  private targetAt(elapsedMs: number): HistoricalTarget | null {
    let current: HistoricalTarget | null = null
    for (const event of this.sortedEvents()) {
      if (event.elapsedMs > elapsedMs) break
      if (isTargetStart(event)) current = { index: event.payload.index, x: event.payload.targetX, y: event.payload.targetY, outcome: null }
      if (isTargetOutcome(event) && current?.index === event.payload.index) current = null
    }
    return current
  }

  private currentTargetStartedAt(elapsedMs: number): number {
    let startedAt = 0
    for (const event of this.sortedEvents()) {
      if (event.elapsedMs > elapsedMs) break
      if (isTargetStart(event)) startedAt = event.elapsedMs
    }
    return startedAt
  }

  private allTargets(): HistoricalTarget[] {
    const targets = new Map<number, HistoricalTarget>()
    for (const event of this.sortedEvents()) {
      if (isTargetStart(event)) targets.set(event.payload.index, { index: event.payload.index, x: event.payload.targetX, y: event.payload.targetY, outcome: null })
      if (isTargetOutcome(event)) {
        const target = targets.get(event.payload.index)
        if (target) target.outcome = event.type === 'target-success' ? 'success' : 'failed'
      }
    }
    return [...targets.values()]
  }

  private sortedEvents(): ReplayEvent[] { return [...(this.replay?.events ?? [])].sort((a, b) => a.elapsedMs - b.elapsedMs) }

  private toScreen(x: number, y: number): { x: number; y: number } {
    const screen = this.app!.screen
    const padding = 60
    return { x: screen.width / 2 + x * Math.max(0, screen.width / 2 - padding), y: screen.height / 2 - y * Math.max(0, screen.height / 2 - padding) }
  }

  private clearLabels(): void { this.labels.removeChildren().forEach((label) => label.destroy()) }

  private publish(): void { const snapshot = this.getSnapshot(); for (const callback of this.listeners) callback(snapshot) }
}

function isTargetStart(event: ReplayEvent): event is ReplayEvent & { type: 'target-start'; payload: { index: number; targetX: number; targetY: number } } {
  const payload = event.payload as Partial<{ index: number; targetX: number; targetY: number }> | undefined
  return event.type === 'target-start' && typeof payload?.index === 'number' && typeof payload.targetX === 'number' && typeof payload.targetY === 'number'
}

function isTargetOutcome(event: ReplayEvent): event is ReplayEvent & { type: 'target-success' | 'target-failed'; payload: { index: number } } {
  const payload = event.payload as Partial<{ index: number }> | undefined
  return (event.type === 'target-success' || event.type === 'target-failed') && typeof payload?.index === 'number'
}
