import { Application, Graphics } from 'pixi.js'
import type { ITrainingReplayPlayer, ReplayMode, ReplayPlayerSnapshot, ReplayPlayerState, ReplayRenderContext } from '../../../core/replay/ITrainingReplayPlayer'
import { sampleAtElapsed } from '../../../core/replay/ReplayMath'
import type { ReplayEvent, TrainingReplay } from '../../../core/replay/TrainingReplay'
import { copyTrainingReplay } from '../../../core/replay/TrainingReplayCopy'
import { KartRacingArt } from '../art/KartRacingArt'
import { isKartRacingReplayEvent, type KartEntitySpawnPayload, type KartObstacleHitPayload, type KartStartPayload } from '../KartRacingGameEvents'
import { defaultKartRacingGameConfig, type KartRacingGameConfig } from '../KartRacingGameConfig'
import { stepKartRacing, type KartState } from '../KartRacingPhysics'
import { createDefaultKartTrack } from '../KartRacingTrack'
import { createKartRacingViewport } from '../KartRacingViewport'
import type { KartCoin, KartItem, KartItemType, KartObstacle, KartObstacleType } from '../KartRacingWorld'

export interface KartRacingReplayFrame extends KartState { elapsedMs: number }

/** 旧记录或损坏配置仅覆盖有效字段，其余回退当前安全默认值。 */
export function resolveKartRacingGameConfig(value: unknown): KartRacingGameConfig {
  const resolved = structuredClone(defaultKartRacingGameConfig)
  if (!value || typeof value !== 'object') return resolved
  const candidate = value as Record<string, unknown>
  for (const key of Object.keys(resolved) as Array<keyof KartRacingGameConfig>) {
    const current = resolved[key]
    const next = candidate[key]
    if (typeof current === 'number' && typeof next === 'number' && Number.isFinite(next) && next > 0) {
      ;(resolved as unknown as Record<string, number>)[key] = next
    } else if (typeof current === 'boolean' && typeof next === 'boolean') {
      ;(resolved as unknown as Record<string, boolean>)[key] = next
    }
  }
  resolved.cruiseSpeed = clamp(resolved.cruiseSpeed, resolved.minSpeed, resolved.maxSpeed)
  resolved.lateralLimit = clamp(resolved.lateralLimit, 0.2, 1)
  resolved.highSpeedSteeringMinFactor = clamp(resolved.highSpeedSteeringMinFactor, 0.5, 1)
  return resolved
}

/** 卡丁车动态回放根据输入和事实事件预计算，不调用随机数。 */
export class KartRacingReplayPlayer implements ITrainingReplayPlayer {
  private app: Application | null = null
  private art: KartRacingArt | null = null
  private trajectory = new Graphics({ label: 'kart-replay-trajectory' })
  private replay: TrainingReplay | null = null
  private config = structuredClone(defaultKartRacingGameConfig)
  private frames: KartRacingReplayFrame[] = []
  private events: ReplayEvent[] = []
  private mode: ReplayMode = 'dynamic'
  private state: ReplayPlayerState = 'idle'
  private currentTimeMs = 0
  private playbackRate = 1
  private lastTickAt = 0
  private listeners = new Set<(snapshot: ReplayPlayerSnapshot) => void>()
  private resizeObserver: ResizeObserver | null = null

  async mount(container: HTMLElement): Promise<void> {
    this.destroy()
    const app = new Application()
    await app.init({ resizeTo: container, antialias: true, background: '#72c7f2', resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true })
    container.appendChild(app.canvas)
    this.app = app
    this.art = new KartRacingArt(app, this.config)
    this.trajectory = new Graphics({ label: 'kart-replay-trajectory' })
    app.stage.addChild(this.trajectory)
    this.resizeObserver = new ResizeObserver(() => requestAnimationFrame(() => this.render()))
    this.resizeObserver.observe(container)
    app.ticker.add(() => this.tick(performance.now()))
    this.render()
  }

  load(replay: TrainingReplay, context?: ReplayRenderContext): void {
    this.replay = copyTrainingReplay(replay)
    this.config = resolveKartRacingGameConfig(context?.gameConfig)
    this.events = this.replay.events.filter(isKartRacingReplayEvent).sort((first, second) => first.elapsedMs - second.elapsedMs)
    if (!this.events.some((event) => event.type === 'kart-start')) throw new Error('卡丁车回放缺少训练开始事件。')
    this.frames = buildKartRacingReplayFrames(this.replay, this.events, this.config)
    this.rebuildArt()
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
    this.currentTimeMs = clamp(Math.round(elapsedMs), 0, duration)
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
    this.art?.destroy()
    this.art = null
    this.app?.destroy(true, { children: true })
    this.app = null
    this.trajectory = new Graphics({ label: 'kart-replay-trajectory' })
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
    const trajectoryMode = this.mode === 'trajectory'
    this.trajectory.visible = trajectoryMode
    this.art?.setVisible(!trajectoryMode)
    if (trajectoryMode) this.renderTrajectory()
    else this.renderDynamic()
  }

  private renderDynamic(): void {
    if (!this.app || !this.art || !this.replay) return
    const frame = frameAt(this.frames, this.currentTimeMs)
    if (!frame) return
    const track = createDefaultKartTrack(this.config.trackLength)
    const sample = sampleAtElapsed(this.replay.samples, this.currentTimeMs) ?? { x: 0, y: 0 }
    const finish = this.events.some((event) => event.type === 'kart-complete' && event.elapsedMs <= this.currentTimeMs)
    this.art.render({
      viewport: createKartRacingViewport(this.app.screen.width, this.app.screen.height),
      track,
      coins: this.spawnedCoinsAt(this.currentTimeMs),
      obstacles: this.spawnedObstaclesAt(this.currentTimeMs),
      items: this.spawnedItemsAt(this.currentTimeMs),
      kart: frame,
      gameInput: { x: sample.x, y: sample.y, connected: true },
      elapsedMs: this.currentTimeMs,
      countdownRemainingMs: 0,
      state: finish ? 'completed' : 'playing',
      progress: clamp(frame.distance / this.config.trackLength, 0, 1),
      shieldActive: effectActive(this.events, 'shield-activated', 'shield-consumed', this.currentTimeMs),
      boostActive: effectActive(this.events, 'boost-start', 'boost-end', this.currentTimeMs),
      finishing: finish,
    })
  }

  private renderTrajectory(): void {
    if (!this.app) return
    const width = this.app.screen.width
    const height = this.app.screen.height
    const padding = Math.max(30, Math.min(width, height) * 0.08)
    const usableWidth = width - padding * 2
    const usableHeight = height - padding * 2
    const graphic = this.trajectory.clear()
    graphic.roundRect(padding, padding, usableWidth, usableHeight, 18).fill(0xdff1cf)
    const visibleFrames = this.frames.filter((_, index) => index % 4 === 0)
    if (visibleFrames.length > 1) {
      const first = trajectoryPoint(visibleFrames[0], this.config.trackLength, padding, usableWidth, usableHeight)
      graphic.moveTo(first.x, first.y)
      for (const frame of visibleFrames.slice(1)) {
        const point = trajectoryPoint(frame, this.config.trackLength, padding, usableWidth, usableHeight)
        graphic.lineTo(point.x, point.y)
      }
      graphic.stroke({ width: 4, color: 0x247eb2, alpha: 0.92 })
    }
    for (const event of this.events.filter((item) => item.type === 'obstacle-hit')) {
      const point = trajectoryPoint(frameAt(this.frames, event.elapsedMs) ?? this.frames[0], this.config.trackLength, padding, usableWidth, usableHeight)
      graphic.moveTo(point.x - 6, point.y - 6).lineTo(point.x + 6, point.y + 6).moveTo(point.x + 6, point.y - 6).lineTo(point.x - 6, point.y + 6).stroke({ width: 3, color: 0xe25555 })
    }
  }

  private spawnedCoinsAt(elapsedMs: number): KartCoin[] {
    return this.events.filter((event) => event.type === 'coin-spawn' && event.elapsedMs <= elapsedMs).map((event) => {
      const payload = event.payload as KartEntitySpawnPayload
      return { id: payload.id, distance: payload.distance, lateral: payload.lateral, radius: payload.radius, active: !this.hasEntityEvent('coin-collected', payload.id, elapsedMs), patternId: '', patternType: payload.kind as KartCoin['patternType'] }
    })
  }

  private spawnedObstaclesAt(elapsedMs: number): KartObstacle[] {
    return this.events.filter((event) => event.type === 'obstacle-spawn' && event.elapsedMs <= elapsedMs).map((event) => {
      const payload = event.payload as KartEntitySpawnPayload
      return { id: payload.id, distance: payload.distance, lateral: payload.lateral, radius: payload.radius, active: true, obstacleType: payload.kind as KartObstacleType, groupId: '', hit: this.hasEntityEvent('obstacle-hit', payload.id, elapsedMs) }
    })
  }

  private spawnedItemsAt(elapsedMs: number): KartItem[] {
    return this.events.filter((event) => event.type === 'item-spawn' && event.elapsedMs <= elapsedMs).map((event) => {
      const payload = event.payload as KartEntitySpawnPayload
      return { id: payload.id, distance: payload.distance, lateral: payload.lateral, radius: payload.radius, active: !this.hasEntityEvent('item-collected', payload.id, elapsedMs), itemType: payload.kind as KartItemType }
    })
  }

  private hasEntityEvent(type: string, id: string, elapsedMs: number): boolean {
    return this.events.some((event) => event.type === type && event.elapsedMs <= elapsedMs && (event.payload as { id?: string } | undefined)?.id === id)
  }

  private rebuildArt(): void {
    if (!this.app) return
    this.art?.destroy()
    this.art = new KartRacingArt(this.app, this.config)
    this.app.stage.addChild(this.trajectory)
  }

  private publish(): void {
    const snapshot = this.getSnapshot()
    for (const listener of this.listeners) listener(snapshot)
  }
}

/** 相同输入、配置和事实事件必定得到相同车辆轨迹。 */
export function buildKartRacingReplayFrames(replay: TrainingReplay, events: readonly ReplayEvent[], config: KartRacingGameConfig): KartRacingReplayFrame[] {
  const start = events.find((event) => event.type === 'kart-start')?.payload as KartStartPayload | undefined
  let kart: KartState = { lateral: start?.lateral ?? 0, lateralVelocity: 0, speed: start?.speed ?? config.cruiseSpeed, distance: 0 }
  const track = createDefaultKartTrack(config.trackLength)
  const frames: KartRacingReplayFrame[] = [{ ...kart, elapsedMs: 0 }]
  const hitEvents = events.filter((event) => event.type === 'obstacle-hit' && (event.payload as KartObstacleHitPayload).slowdownApplied)
  const step = Math.max(1, config.fixedStepMs)
  for (let elapsed = step; elapsed <= replay.durationMs + step / 2; elapsed += step) {
    const current = Math.min(replay.durationMs, elapsed)
    const input = sampleAtElapsed(replay.samples, current) ?? { x: 0, y: 0 }
    // 事件由本步碰撞结束后写入，因此减速从下一物理步开始生效。
    const slowed = hitEvents.some((event) => current > event.elapsedMs && current < event.elapsedMs + config.hitSlowdownMs)
    const boosted = effectActiveForStep(events, 'boost-start', 'boost-end', current)
    kart = stepKartRacing(kart, input, track, config, step / 1_000, {
      slowdownFactor: slowed ? config.hitSlowdownFactor : 1,
      boostFactor: boosted ? config.boostFactor : 1,
    })
    frames.push({ ...kart, elapsedMs: current })
    if (current >= replay.durationMs) break
  }
  return frames
}

function effectActive(events: readonly ReplayEvent[], startType: string, endType: string, elapsedMs: number): boolean {
  const start = [...events].reverse().find((event) => event.type === startType && event.elapsedMs <= elapsedMs)
  if (!start) return false
  return !events.some((event) => event.type === endType && event.elapsedMs >= start.elapsedMs && event.elapsedMs <= elapsedMs)
}

/** 回放物理步只消费此前已经发生的效果事件，避免把本步收集提前应用。 */
function effectActiveForStep(events: readonly ReplayEvent[], startType: string, endType: string, elapsedMs: number): boolean {
  const start = [...events].reverse().find((event) => event.type === startType && event.elapsedMs < elapsedMs)
  if (!start) return false
  return !events.some((event) => event.type === endType && event.elapsedMs >= start.elapsedMs && event.elapsedMs <= elapsedMs)
}

function frameAt(frames: readonly KartRacingReplayFrame[], elapsedMs: number): KartRacingReplayFrame | null {
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

function trajectoryPoint(frame: KartRacingReplayFrame, trackLength: number, padding: number, width: number, height: number): { x: number; y: number } {
  return { x: padding + (frame.lateral + 1) / 2 * width, y: padding + clamp(frame.distance / Math.max(1, trackLength), 0, 1) * height }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
}
