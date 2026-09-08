import { Application } from 'pixi.js'
import type { GameInput } from '../../core/game-input/GameInput'
import type { ITrainingGame } from '../../core/game/ITrainingGame'
import type { TrainingGameEvents } from '../../core/game/TrainingGameEvents'
import { TrainingSession } from '../../core/training/TrainingSession'
import type { TrainingSessionState } from '../../core/training/TrainingSessionState'
import { RiverDriftArt } from './art/RiverDriftArt'
import { defaultRiverDriftGameConfig, type RiverDriftGameConfig } from './RiverDriftGameConfig'
import { stepRiverDriftBoat, type RiverDriftBoatState } from './RiverDriftPhysics'
import { buildRiverDriftTrainingResult, type RiverDriftMetricSample, type RiverDriftTrainingResult } from './RiverDriftTrainingResult'
import { createRiverDriftViewport } from './RiverDriftViewport'
import { emptyRiverDriftInput, RiverDriftWorld } from './RiverDriftWorld'

/** 森林溪谷漂流把标准化腕部输入转换成平稳的小船速度。 */
export class RiverDriftGame implements ITrainingGame<RiverDriftTrainingResult> {
  private app: Application | null = null
  private art: RiverDriftArt | null = null
  private resizeObserver: ResizeObserver | null = null
  private session = new TrainingSession()
  private latestInput: GameInput = emptyRiverDriftInput()
  private world: RiverDriftWorld
  private boat: RiverDriftBoatState = initialBoat()
  private metricSamples: RiverDriftMetricSample[] = []
  private nextMetricElapsedMs = 0
  private nextHudElapsedMs = 0
  private nextWakeElapsedMs = 0
  private simulatedElapsedMs = 0
  private accumulatorMs = 0
  private lastFrameAt = 0
  private lastNotifiedState: TrainingSessionState = 'idle'

  constructor(
    private readonly config: RiverDriftGameConfig = structuredClone(defaultRiverDriftGameConfig),
    private readonly events: TrainingGameEvents<RiverDriftTrainingResult> = {},
  ) {
    this.world = new RiverDriftWorld(config, events)
  }

  async mount(container: HTMLElement): Promise<void> {
    this.destroy()
    const app = new Application()
    await app.init({ resizeTo: container, antialias: true, background: '#87cfe0', resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true })
    container.appendChild(app.canvas)
    this.app = app
    this.art = new RiverDriftArt(app, this.config)
    // 校准等待阶段也显示完整河道；正式开始时会再次按新种子重置。
    this.world.reset(1)
    // Canvas 尺寸变化时只重新映射坐标，训练模型和游戏实例保持不变。
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
    this.boat = initialBoat()
    this.metricSamples = []
    this.nextMetricElapsedMs = 0
    this.nextHudElapsedMs = 0
    this.nextWakeElapsedMs = 0
    this.simulatedElapsedMs = 0
    this.accumulatorMs = 0
    this.events.onReplayEvent?.({ elapsedMs: 0, type: 'river-start', payload: { version: 1, boatX: this.boat.x, boatY: this.boat.y } })
    this.world.reset(createSeed())
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
      if (snapshot.playingElapsedMs >= this.config.sessionDurationMs) this.complete(now)
    } else this.lastFrameAt = now
    this.render(now)
  }

  private fixedUpdate(dtSeconds: number, elapsedMs: number): void {
    const horizontal = this.world.getBoatHorizontalBounds(this.boat.y)
    this.boat = stepRiverDriftBoat(this.boat, this.latestInput, {
      ...horizontal,
      minY: this.config.boatVerticalMin,
      maxY: this.config.boatVerticalMax,
    }, this.config, dtSeconds)
    const feedback = this.world.update(dtSeconds, elapsedMs, this.boat)
    this.art?.updateParticles(dtSeconds)
    for (const id of feedback.collectedCoinIds) {
      const coin = this.world.coins.find((item) => item.id === id)
      if (coin) this.art?.spawnCoinBurst(coin)
    }
    for (const id of feedback.hitObstacleIds) {
      const obstacle = this.world.obstacles.find((item) => item.id === id)
      if (obstacle) this.art?.spawnHitSplash(obstacle, elapsedMs)
    }
    if (feedback.collectedCoinIds.length || feedback.hitObstacleIds.length) this.publishHud(true)
    while (elapsedMs >= this.nextMetricElapsedMs) {
      this.metricSamples.push({ x: this.latestInput.x, y: this.latestInput.y })
      this.nextMetricElapsedMs += Math.max(1, this.config.metricSampleIntervalMs)
    }
    if (elapsedMs >= this.nextWakeElapsedMs) {
      this.art?.spawnWake(this.boat)
      this.nextWakeElapsedMs += 140
    }
  }

  private complete(now: number): void {
    if (this.session.getSnapshot(now).state !== 'playing') return
    this.session.complete(now)
    const snapshot = this.session.getSnapshot(now)
    const result = buildRiverDriftTrainingResult({
      startedAt: snapshot.startedAt ?? now,
      endedAt: snapshot.completedAt ?? now,
      durationMs: Math.min(snapshot.playingElapsedMs, this.config.sessionDurationMs),
      collectedCoins: this.world.collectedCoins,
      totalCoins: this.world.totalCoins,
      spawnedObstacles: this.world.spawnedObstacles,
      collisionCount: this.world.collisionCount,
      samples: this.metricSamples,
      movementThreshold: this.config.movementThreshold,
    })
    this.events.onReplayEvent?.({ elapsedMs: result.durationMs, type: 'river-complete' })
    this.notifySessionState()
    this.publishHud(true)
    this.events.onCompleted?.(result)
  }

  private render(now: number): void {
    if (!this.app || !this.art) return
    const snapshot = this.session.getSnapshot(now)
    this.art.render({
      viewport: createRiverDriftViewport(this.app.screen.width, this.app.screen.height),
      segments: this.world.segments,
      coins: this.world.coins,
      obstacles: this.world.obstacles,
      boat: this.boat,
      gameInput: this.latestInput,
      elapsedMs: snapshot.playingElapsedMs,
      countdownRemainingMs: snapshot.countdownRemainingMs,
      state: snapshot.state,
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
    const title = snapshot.state === 'countdown' ? '准备出发' : snapshot.state === 'paused' ? '训练已暂停' : snapshot.state === 'completed' ? '漂流完成' : '平稳漂流中'
    this.events.onHudChanged?.({
      title,
      subtitle: '保持平稳，收集金币并避开障碍',
      metrics: [
        { label: '金币', value: String(this.world.collectedCoins) },
        { label: '碰撞', value: String(this.world.collisionCount) },
        { label: '时间', value: `${formatClock(snapshot.playingElapsedMs)} / 01:30` },
      ],
    })
  }
}

function initialBoat(): RiverDriftBoatState { return { x: 0.5, y: 0.74, velocityX: 0, velocityY: 0 } }

function createSeed(): number {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') return crypto.getRandomValues(new Uint32Array(1))[0]
  return Math.floor(Math.random() * 0xffffffff)
}

function formatClock(value: number): string {
  const seconds = Math.floor(Math.max(0, value) / 1_000)
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}
