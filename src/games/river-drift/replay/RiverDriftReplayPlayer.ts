import { Application, Graphics } from 'pixi.js'
import type { ITrainingReplayPlayer, ReplayMode, ReplayPlayerSnapshot, ReplayPlayerState, ReplayRenderContext } from '../../../core/replay/ITrainingReplayPlayer'
import { sampleAtElapsed } from '../../../core/replay/ReplayMath'
import { copyTrainingReplay } from '../../../core/replay/TrainingReplayCopy'
import type { ReplayEvent, TrainingReplay } from '../../../core/replay/TrainingReplay'
import { isRiverDriftReplayEvent, type CoinSpawnPayload, type ObstacleSpawnPayload, type SegmentSpawnPayload } from '../RiverDriftGameEvents'
import { defaultRiverDriftGameConfig, type RiverDriftGameConfig } from '../RiverDriftGameConfig'
import { stepRiverDriftBoat, type RiverDriftBoatState } from '../RiverDriftPhysics'
import { RiverDriftDynamicReplayArt, type ReplayCoinVisualState, type ReplayObstacleVisualState } from '../art/RiverDriftDynamicReplayArt'

interface RiverDriftReplayFrame extends RiverDriftBoatState {
  elapsedMs: number
  worldDistance: number
}

/** 旧记录或损坏字段只覆盖有效配置，其余继续使用当前默认值。 */
export function resolveRiverDriftGameConfig(value: unknown): RiverDriftGameConfig {
  const resolved = structuredClone(defaultRiverDriftGameConfig)
  if (!value || typeof value !== 'object') return resolved
  const candidate = value as Record<string, unknown>
  for (const key of Object.keys(resolved) as Array<keyof RiverDriftGameConfig>) {
    const current = resolved[key]
    const next = candidate[key]
    if (typeof current === 'number' && typeof next === 'number' && Number.isFinite(next) && next > 0) {
      ;(resolved as unknown as Record<string, number>)[key] = next
    } else if (typeof current === 'boolean' && typeof next === 'boolean') {
      ;(resolved as unknown as Record<string, boolean>)[key] = next
    }
  }
  return resolved
}

/** 漂流回放根据已保存输入和事件预计算画面，不读取设备也不调用随机函数。 */
export class RiverDriftReplayPlayer implements ITrainingReplayPlayer {
  private app: Application | null = null
  private replay: TrainingReplay | null = null
  private config = structuredClone(defaultRiverDriftGameConfig)
  private frames: RiverDriftReplayFrame[] = []
  private events: ReplayEvent[] = []
  private mode: ReplayMode = 'dynamic'
  private state: ReplayPlayerState = 'idle'
  private currentTimeMs = 0
  private playbackRate = 1
  private lastTickAt = 0
  private scene = new Graphics()
  private dynamicArt: RiverDriftDynamicReplayArt | null = null
  private listeners = new Set<(snapshot: ReplayPlayerSnapshot) => void>()
  private resizeObserver: ResizeObserver | null = null

  async mount(container: HTMLElement): Promise<void> {
    this.destroy()
    const app = new Application()
    await app.init({ resizeTo: container, antialias: true, background: '#87cfe0', resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true })
    container.appendChild(app.canvas)
    this.scene = new Graphics()
    app.stage.addChild(this.scene)
    this.app = app
    this.resizeObserver = new ResizeObserver(() => requestAnimationFrame(() => this.render()))
    this.resizeObserver.observe(container)
    app.ticker.add(() => this.tick(performance.now()))
    this.render()
  }

  load(replay: TrainingReplay, context?: ReplayRenderContext): void {
    this.replay = copyTrainingReplay(replay)
    this.config = resolveRiverDriftGameConfig(context?.gameConfig)
    this.events = this.replay.events.filter(isRiverDriftReplayEvent).sort((first, second) => first.elapsedMs - second.elapsedMs)
    const start = this.events.find((event) => event.type === 'river-start')
    if (!start) throw new Error('漂流回放缺少训练开始事件。')
    this.frames = buildRiverDriftReplayFrames(this.replay, this.events, this.config)
    this.rebuildDynamicArt()
    this.currentTimeMs = 0
    this.state = 'paused'
    this.lastTickAt = 0
    this.render()
    this.publish()
  }

  setMode(mode: ReplayMode): void { this.mode = mode; this.pause(); this.render() }
  play(): void {
    if (!this.replay || this.replay.durationMs <= 0) return
    if (this.currentTimeMs >= this.replay.durationMs) this.currentTimeMs = 0
    this.state = 'playing'
    this.lastTickAt = performance.now()
    this.publish()
  }
  pause(): void { if (this.state === 'playing') { this.state = 'paused'; this.publish() } }
  restart(): void { this.seek(0); this.pause() }
  seek(elapsedMs: number): void {
    const duration = this.replay?.durationMs ?? 0
    this.currentTimeMs = Math.max(0, Math.min(duration, Math.round(elapsedMs)))
    if (duration > 0 && this.currentTimeMs >= duration) this.state = 'ended'
    else if (this.state === 'ended') this.state = 'paused'
    this.render()
    this.publish()
  }
  setPlaybackRate(rate: number): void { this.playbackRate = [0.5, 1, 2].includes(rate) ? rate : 1; this.publish() }
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
    this.dynamicArt?.destroy()
    this.dynamicArt = null
    this.app?.destroy(true, { children: true })
    this.app = null
    this.scene = new Graphics()
    this.state = 'idle'
    this.frames = []
  }

  private tick(now: number): void {
    if (this.state !== 'playing' || !this.replay) return
    const next = this.currentTimeMs + Math.max(0, now - this.lastTickAt) * this.playbackRate
    this.lastTickAt = now
    if (next >= this.replay.durationMs) { this.currentTimeMs = this.replay.durationMs; this.state = 'ended' }
    else this.currentTimeMs = next
    this.render()
    this.publish()
  }

  private render(): void {
    if (!this.app || !this.replay || this.frames.length === 0) return
    this.scene.clear()
    const trajectory = this.mode === 'trajectory'
    this.scene.visible = trajectory
    this.dynamicArt?.setVisible(!trajectory)
    if (trajectory) this.renderTrajectory()
    else this.renderDynamic()
  }

  private renderDynamic(): void {
    const frame = frameAt(this.frames, this.currentTimeMs)
    if (!frame || !this.dynamicArt) return
    const coins: ReplayCoinVisualState[] = []
    const obstacles: ReplayObstacleVisualState[] = []
    for (const event of this.events) {
      if (event.elapsedMs > this.currentTimeMs) break
      const distance = frame.worldDistance - worldDistanceAt(this.frames, event.elapsedMs)
      if (event.type === 'coin-spawn') {
        const payload = event.payload as CoinSpawnPayload
        const collected = this.hasEntityEvent('coin-collected', payload.id)
        const y = payload.y + distance
        if (!collected && y >= -0.15 && y <= 1.15) coins.push({ id: payload.id, x: payload.x, y, radius: payload.radius })
      }
      if (event.type === 'obstacle-spawn') {
        const payload = event.payload as ObstacleSpawnPayload
        const y = payload.y + distance
        if (y >= -0.15 && y <= 1.15) {
          obstacles.push({ id: payload.id, x: payload.x, y, radius: payload.radius, obstacleType: payload.obstacleType, hit: this.hasEntityEvent('obstacle-hit', payload.id) })
        }
      }
    }
    const hit = this.events.some((event) => event.type === 'obstacle-hit' && event.elapsedMs <= this.currentTimeMs && this.currentTimeMs < event.elapsedMs + 380)
    this.dynamicArt.render({ segments: this.visibleSegments(frame), coins, obstacles, boat: frame, elapsedMs: this.currentTimeMs, hit })
  }

  private renderTrajectory(): void {
    if (!this.app || !this.replay) return
    const width = this.app.screen.width
    const height = this.app.screen.height
    const padding = Math.max(28, Math.min(width, height) * 0.08)
    const usableWidth = width - padding * 2
    const usableHeight = height - padding * 2
    this.scene.roundRect(padding, padding, usableWidth, usableHeight, 18).fill(0xe5f4d0)
    const visibleFrames = this.frames.filter((_, index) => index % 3 === 0)
    if (visibleFrames.length > 1) {
      const first = trajectoryPoint(visibleFrames[0], this.replay.durationMs, padding, usableWidth, usableHeight)
      this.scene.moveTo(first.x, first.y)
      for (const frame of visibleFrames.slice(1)) {
        const point = trajectoryPoint(frame, this.replay.durationMs, padding, usableWidth, usableHeight)
        this.scene.lineTo(point.x, point.y)
      }
      this.scene.stroke({ width: 3, color: 0x287eaa, alpha: 0.9 })
    }
    for (const event of this.events) {
      if (event.type !== 'coin-spawn' && event.type !== 'obstacle-spawn') continue
      const payload = event.payload as CoinSpawnPayload | ObstacleSpawnPayload
      const encounter = this.encounterElapsed(event.elapsedMs, payload.y)
      const x = padding + payload.x * usableWidth
      const y = padding + encounter / Math.max(1, this.replay.durationMs) * usableHeight
      this.scene.circle(x, y, event.type === 'coin-spawn' ? 3 : 5).fill(event.type === 'coin-spawn' ? 0xf0b429 : 0x6b7280)
    }
    for (const event of this.events.filter((item) => item.type === 'obstacle-hit')) {
      const payload = event.payload as { id: string }
      const spawn = this.events.find((item) => item.type === 'obstacle-spawn' && (item.payload as { id?: string })?.id === payload.id)
      const x = padding + ((spawn?.payload as ObstacleSpawnPayload | undefined)?.x ?? frameAt(this.frames, event.elapsedMs)?.x ?? 0.5) * usableWidth
      const y = padding + event.elapsedMs / Math.max(1, this.replay.durationMs) * usableHeight
      this.scene.moveTo(x - 6, y - 6).lineTo(x + 6, y + 6).moveTo(x + 6, y - 6).lineTo(x - 6, y + 6).stroke({ width: 3, color: 0xe25555 })
    }
  }

  private visibleSegments(frame: RiverDriftReplayFrame): SegmentSpawnPayload[] {
    return this.events.filter((event) => event.type === 'segment-spawn' && event.elapsedMs <= this.currentTimeMs)
      .map((event) => {
        const payload = event.payload as SegmentSpawnPayload
        return { ...payload, y: payload.y + frame.worldDistance - worldDistanceAt(this.frames, event.elapsedMs) }
      })
      .filter((segment) => segment.y < 1.3 && segment.y + segment.height > -0.3)
  }

  private hasEntityEvent(type: 'coin-collected' | 'obstacle-hit', id: string): boolean {
    return this.events.some((event) => event.type === type && event.elapsedMs <= this.currentTimeMs && (event.payload as { id?: string })?.id === id)
  }

  /** 配置在 load 时才确定，因此动态场景也在此时按记录配置重建。 */
  private rebuildDynamicArt(): void {
    if (!this.app) return
    this.dynamicArt?.destroy()
    this.dynamicArt = new RiverDriftDynamicReplayArt(this.app, this.config)
    this.app.stage.addChild(this.scene)
  }

  private encounterElapsed(spawnElapsed: number, spawnY: number): number {
    const startDistance = worldDistanceAt(this.frames, spawnElapsed)
    const target = startDistance + Math.max(0, 0.74 - spawnY)
    return this.frames.find((frame) => frame.elapsedMs >= spawnElapsed && frame.worldDistance >= target)?.elapsedMs ?? this.replay!.durationMs
  }

  private publish(): void { const snapshot = this.getSnapshot(); for (const listener of this.listeners) listener(snapshot) }
}

/** 预计算后，拖动进度条只需读取最近快照，不会从头反复模拟。 */
export function buildRiverDriftReplayFrames(replay: TrainingReplay, events: readonly ReplayEvent[], config: RiverDriftGameConfig): RiverDriftReplayFrame[] {
  const start = events.find((event) => event.type === 'river-start')?.payload as { boatX?: number; boatY?: number } | undefined
  let boat: RiverDriftBoatState = { x: start?.boatX ?? 0.5, y: start?.boatY ?? 0.74, velocityX: 0, velocityY: 0 }
  let worldDistance = 0
  const frames: RiverDriftReplayFrame[] = [{ ...boat, elapsedMs: 0, worldDistance }]
  const hitTimes = events.filter((event) => event.type === 'obstacle-hit').map((event) => event.elapsedMs)
  const step = Math.max(1, config.fixedStepMs)
  for (let elapsed = step; elapsed <= replay.durationMs + step / 2; elapsed += step) {
    const current = Math.min(replay.durationMs, elapsed)
    const input = sampleAtElapsed(replay.samples, current) ?? { x: 0, y: 0 }
    boat = stepRiverDriftBoat(boat, input, {
      minX: 0.5 - config.riverWidthRatio / 2 + config.boatRadius,
      maxX: 0.5 + config.riverWidthRatio / 2 - config.boatRadius,
      minY: config.boatVerticalMin,
      maxY: config.boatVerticalMax,
    }, config, step / 1_000)
    const slowed = hitTimes.some((time) => current >= time && current < time + config.hitSlowdownMs)
    worldDistance += config.worldSpeed * (slowed ? config.hitSlowdownFactor : 1) * step / 1_000
    frames.push({ ...boat, elapsedMs: current, worldDistance })
    if (current >= replay.durationMs) break
  }
  return frames
}

function frameAt(frames: readonly RiverDriftReplayFrame[], elapsedMs: number): RiverDriftReplayFrame | null {
  if (frames.length === 0) return null
  let low = 0
  let high = frames.length - 1
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (frames[middle].elapsedMs <= elapsedMs) low = middle
    else high = middle - 1
  }
  return frames[low]
}

function worldDistanceAt(frames: readonly RiverDriftReplayFrame[], elapsedMs: number): number { return frameAt(frames, elapsedMs)?.worldDistance ?? 0 }

function trajectoryPoint(frame: RiverDriftReplayFrame, duration: number, padding: number, width: number, height: number): { x: number; y: number } {
  return { x: padding + frame.x * width, y: padding + frame.elapsedMs / Math.max(1, duration) * height }
}
