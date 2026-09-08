import { Application } from 'pixi.js'
import type { GameInput } from '../../core/game-input/GameInput'
import type { ITrainingGame } from '../../core/game/ITrainingGame'
import type { TrainingGameEvents } from '../../core/game/TrainingGameEvents'
import { TrainingSession } from '../../core/training/TrainingSession'
import type { TrainingSessionState } from '../../core/training/TrainingSessionState'
import { KartRacingArt } from './art/KartRacingArt'
import { defaultKartRacingGameConfig, type KartRacingGameConfig } from './KartRacingGameConfig'
import { stepKartRacing, type KartState } from './KartRacingPhysics'
import { createDefaultKartTrack, getKartTrackSegment, kartTrackProgress, type KartTrackSegment } from './KartRacingTrack'
import { buildKartRacingTrainingResult, type KartRacingMetricSample, type KartRacingTrainingResult } from './KartRacingTrainingResult'
import { createKartRacingViewport } from './KartRacingViewport'
import { KartRacingWorld } from './KartRacingWorld'

/** 欢乐卡丁车把标准化四方向输入转换成平滑转向和动态速度。 */
export class KartRacingGame implements ITrainingGame<KartRacingTrainingResult> {
  private app: Application | null = null
  private art: KartRacingArt | null = null
  private resizeObserver: ResizeObserver | null = null
  private session = new TrainingSession()
  private latestInput: GameInput = emptyKartInput()
  private track: KartTrackSegment[]
  private world: KartRacingWorld
  private kart: KartState
  private metricSamples: KartRacingMetricSample[] = []
  private nextMetricElapsedMs = 0
  private nextHudElapsedMs = 0
  private nextCheckpoint = 0.25
  private currentSegmentId = ''
  private simulatedElapsedMs = 0
  private accumulatorMs = 0
  private lastFrameAt = 0
  private lastNotifiedState: TrainingSessionState = 'idle'
  private finishStartedAt = 0
  private pendingResult: KartRacingTrainingResult | null = null
  private completionDelivered = false

  constructor(
    private readonly config: KartRacingGameConfig = structuredClone(defaultKartRacingGameConfig),
    private readonly events: TrainingGameEvents<KartRacingTrainingResult> = {},
  ) {
    this.track = createDefaultKartTrack(config.trackLength)
    this.world = new KartRacingWorld(config, events)
    this.kart = initialKart(config)
  }

  async mount(container: HTMLElement): Promise<void> {
    this.destroy()
    const app = new Application()
    await app.init({ resizeTo: container, antialias: true, background: '#72c7f2', resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true })
    container.appendChild(app.canvas)
    this.app = app
    this.art = new KartRacingArt(app, this.config)
    this.world.reset(1)
    this.resizeObserver = new ResizeObserver(() => requestAnimationFrame(() => this.render(performance.now())))
    this.resizeObserver.observe(container)
    app.ticker.add(() => this.tick(performance.now()))
    this.render(performance.now())
  }

  setInput(input: GameInput): void {
    this.latestInput = input
    const state = this.session.getSnapshot().state
    if (!input.connected && (state === 'playing' || state === 'countdown')) this.pause()
  }

  start(): void {
    if (!this.latestInput.connected) throw new Error('开始训练前必须连接 BS-BT91')
    if (!this.latestInput.calibrated) throw new Error('开始训练前必须完成中心校准')
    const seed = createSeed()
    this.kart = initialKart(this.config)
    this.metricSamples = []
    this.nextMetricElapsedMs = 0
    this.nextHudElapsedMs = 0
    this.nextCheckpoint = 0.25
    this.currentSegmentId = this.track[0]?.id ?? ''
    this.simulatedElapsedMs = 0
    this.accumulatorMs = 0
    this.finishStartedAt = 0
    this.pendingResult = null
    this.completionDelivered = false
    this.world.reset(seed)
    this.events.onReplayEvent?.({ elapsedMs: 0, type: 'kart-start', payload: { version: 1, lateral: 0, speed: this.config.cruiseSpeed, seed } })
    if (this.currentSegmentId) this.events.onReplayEvent?.({ elapsedMs: 0, type: 'track-segment', payload: { segmentId: this.currentSegmentId, distance: 0 } })
    this.session.start(performance.now(), 3_000)
    this.lastFrameAt = performance.now()
    this.notifySessionState()
    this.publishHud(true)
  }

  pause(now = performance.now()): void {
    const state = this.session.getSnapshot(now).state
    if (state !== 'playing' && state !== 'countdown') return
    this.events.onReplayEvent?.({ elapsedMs: this.getTrainingElapsedMs(now), type: 'pause' })
    this.session.pause(now)
    this.accumulatorMs = 0
    this.lastFrameAt = now
    this.notifySessionState()
    this.publishHud(true)
  }

  resume(now = performance.now()): void {
    if (!this.latestInput.connected) throw new Error('传感器未连接，无法继续训练')
    if (!this.latestInput.calibrated) throw new Error('请重新完成中心校准后继续训练')
    if (this.session.getSnapshot(now).state !== 'paused') return
    // 恢复时回到巡航速度，避免重连后第一帧突然高速或横向跳动。
    this.kart = { ...this.kart, speed: this.config.cruiseSpeed, lateralVelocity: 0 }
    this.session.resume(now)
    this.events.onReplayEvent?.({ elapsedMs: this.getTrainingElapsedMs(now), type: 'resume' })
    this.lastFrameAt = now
    this.notifySessionState()
    this.publishHud(true)
  }

  abort(): void {
    this.session.abort(performance.now())
    this.notifySessionState()
  }

  destroy(): void {
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.art?.destroy()
    this.art = null
    this.app?.destroy(true, { children: true })
    this.app = null
  }

  getTrainingElapsedMs(now = performance.now()): number {
    return this.session.getSnapshot(now).playingElapsedMs
  }

  private tick(now: number): void {
    const particleDeltaSeconds = Math.max(0, Math.min(50, now - this.lastFrameAt)) / 1_000
    const before = this.session.getSnapshot(now).state
    this.session.update(now)
    this.notifySessionState()
    const snapshot = this.session.getSnapshot(now)
    if (snapshot.state === 'playing') {
      if (before !== 'playing') this.lastFrameAt = now
      const frameDelta = Math.max(0, Math.min(this.config.maxFrameDeltaMs, now - this.lastFrameAt))
      this.lastFrameAt = now
      this.accumulatorMs += frameDelta
      let steps = 0
      while (this.accumulatorMs >= this.config.fixedStepMs && steps < this.config.maxCatchUpSteps) {
        this.simulatedElapsedMs = Math.min(snapshot.playingElapsedMs, this.simulatedElapsedMs + this.config.fixedStepMs)
        this.fixedUpdate(this.config.fixedStepMs / 1_000, this.simulatedElapsedMs)
        this.accumulatorMs -= this.config.fixedStepMs
        steps += 1
      }
      if (steps === this.config.maxCatchUpSteps) this.accumulatorMs = 0
      this.publishHud(false)
      if (this.kart.distance >= this.config.trackLength) this.beginFinish(now, 'finish-line')
      else if (snapshot.playingElapsedMs >= this.config.maxSessionDurationMs) this.beginFinish(now, 'max-duration')
    } else this.lastFrameAt = now
    this.art?.updateParticles(particleDeltaSeconds)
    this.render(now)
    if (this.pendingResult && !this.completionDelivered && now - this.finishStartedAt >= this.config.finishCelebrationMs) {
      this.completionDelivered = true
      this.events.onCompleted?.(this.pendingResult)
    }
  }

  private fixedUpdate(dtSeconds: number, elapsedMs: number): void {
    const effects = this.world.getPhysicsEffects(elapsedMs)
    this.kart = stepKartRacing(this.kart, this.latestInput, this.track, this.config, dtSeconds, effects)
    const feedback = this.world.update(elapsedMs, this.kart)
    for (const id of feedback.collectedCoinIds) {
      const coin = this.world.coins.find((item) => item.id === id)
      if (coin) this.art?.spawnCoinFeedback(coin)
    }
    for (const id of feedback.hitObstacleIds) {
      if (this.world.obstacles.some((item) => item.id === id)) this.art?.spawnHitFeedback(elapsedMs)
    }
    for (const collected of feedback.collectedItems) {
      const item = this.world.items.find((candidate) => candidate.id === collected.id)
      if (item) this.art?.spawnItemFeedback(item, collected.type === 'shield' ? 0x61d8ff : 0xff9b42)
    }
    this.publishTrackEvents(elapsedMs)
    while (elapsedMs >= this.nextMetricElapsedMs) {
      this.metricSamples.push({
        x: this.latestInput.x,
        y: this.latestInput.y,
        speedRatio: this.kart.speed / this.config.maxSpeed,
        distance: this.kart.distance,
      })
      this.nextMetricElapsedMs += Math.max(1, this.config.metricSampleIntervalMs)
    }
  }

  private publishTrackEvents(elapsedMs: number): void {
    const segment = getKartTrackSegment(this.track, this.kart.distance)
    if (segment.id !== this.currentSegmentId) {
      this.currentSegmentId = segment.id
      this.events.onReplayEvent?.({ elapsedMs, type: 'track-segment', payload: { segmentId: segment.id, distance: this.kart.distance } })
    }
    const progress = kartTrackProgress(this.kart.distance, this.config.trackLength)
    while (progress >= this.nextCheckpoint && this.nextCheckpoint < 1) {
      this.events.onReplayEvent?.({ elapsedMs, type: 'checkpoint', payload: { distance: this.kart.distance } })
      this.nextCheckpoint += 0.25
    }
  }

  private beginFinish(now: number, reason: KartRacingTrainingResult['completionReason']): void {
    if (this.pendingResult || this.session.getSnapshot(now).state !== 'playing') return
    this.session.complete(now)
    const snapshot = this.session.getSnapshot(now)
    const progress = kartTrackProgress(this.kart.distance, this.config.trackLength)
    this.pendingResult = buildKartRacingTrainingResult({
      startedAt: snapshot.startedAt ?? now,
      endedAt: snapshot.completedAt ?? now,
      durationMs: Math.min(snapshot.playingElapsedMs, this.config.maxSessionDurationMs),
      completionReason: reason,
      trackProgress: progress,
      collectedCoins: this.world.collectedCoins,
      totalCoins: this.world.totalCoins,
      spawnedObstacles: this.world.spawnedObstacles,
      collisionCount: this.world.collisionCount,
      samples: this.metricSamples,
      movementThreshold: this.config.movementThreshold,
    })
    this.finishStartedAt = now
    this.events.onReplayEvent?.({ elapsedMs: this.pendingResult.durationMs, type: 'kart-complete', payload: { reason, distance: this.kart.distance } })
    this.notifySessionState()
    this.publishHud(true)
  }

  private render(now: number): void {
    if (!this.app || !this.art) return
    const snapshot = this.session.getSnapshot(now)
    const effects = this.world.getPhysicsEffects(snapshot.playingElapsedMs)
    this.art.render({
      viewport: createKartRacingViewport(this.app.screen.width, this.app.screen.height),
      track: this.track,
      coins: this.world.coins,
      obstacles: this.world.obstacles,
      items: this.world.items,
      kart: this.kart,
      gameInput: this.latestInput,
      elapsedMs: snapshot.playingElapsedMs,
      countdownRemainingMs: snapshot.countdownRemainingMs,
      state: snapshot.state,
      progress: kartTrackProgress(this.kart.distance, this.config.trackLength),
      shieldActive: this.world.shieldHitsRemaining > 0,
      boostActive: effects.boostFactor > 1,
      finishing: this.pendingResult !== null && !this.completionDelivered,
    })
  }

  private notifySessionState(): void {
    const state = this.session.getSnapshot().state
    if (state === this.lastNotifiedState) return
    this.lastNotifiedState = state
    this.events.onSessionStateChanged?.(state)
  }

  private publishHud(force: boolean): void {
    const snapshot = this.session.getSnapshot()
    if (!force && snapshot.playingElapsedMs < this.nextHudElapsedMs) return
    this.nextHudElapsedMs = snapshot.playingElapsedMs + 250
    const progress = kartTrackProgress(this.kart.distance, this.config.trackLength)
    const title = snapshot.state === 'countdown' ? '准备出发' : snapshot.state === 'paused' ? '训练已暂停' : snapshot.state === 'completed' ? '驾驶完成' : '平稳驾驶中'
    this.events.onHudChanged?.({
      title,
      subtitle: '保持平稳，沿安全路线收集金币',
      metrics: [
        { label: '金币', value: String(this.world.collectedCoins) },
        { label: '进度', value: `${Math.round(progress * 100)}%` },
        { label: '时间', value: formatClock(snapshot.playingElapsedMs) },
      ],
    })
  }
}

function initialKart(config: KartRacingGameConfig): KartState {
  return { lateral: 0, lateralVelocity: 0, speed: config.cruiseSpeed, distance: 0 }
}

function emptyKartInput(): GameInput {
  return { x: 0, y: 0, connected: false, calibrated: false, timestamp: 0 }
}

function createSeed(): number {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') return crypto.getRandomValues(new Uint32Array(1))[0]
  return Math.floor(Math.random() * 0xffffffff)
}

function formatClock(value: number): string {
  const seconds = Math.floor(Math.max(0, value) / 1_000)
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}
