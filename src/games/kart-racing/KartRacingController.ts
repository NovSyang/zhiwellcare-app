import type { GameInput } from '../../core/game-input/GameInput'
import type { IClock } from '../../core/time/IClock'
import type { TrainingGameEvents } from '../../core/game/TrainingGameEvents'
import { TrainingSession } from '../../core/training/TrainingSession'
import type { TrainingSessionState } from '../../core/training/TrainingSessionState'
import type { KartRacingGameConfig } from './KartRacingGameConfig'
import { stepKartRacing, type KartState } from './KartRacingPhysics'
import { createDefaultKartTrack, getKartTrackSegment, kartTrackProgress, type KartTrackSegment } from './KartRacingTrack'
import { buildKartRacingTrainingResult, type KartRacingMetricSample, type KartRacingTrainingResult } from './KartRacingTrainingResult'
import { KartRacingWorld, type KartWorldFeedback } from './KartRacingWorld'

import { round4 } from '../../core/replay/ReplayMath'

interface KartRacingControllerOptions {
  makeSeed?: () => number
  recordScene?: boolean
  /** 沿用历史位姿采样时机，向实时概览发布真实车位和赛道距离。 */
  onScenePose?: (elapsedMs: number, lateral: number, distance: number) => void
  onStep?: (world: KartRacingWorld, feedback: KartWorldFeedback, elapsedMs: number) => void
  onRenderTick?: (now: number, particleDelta: number) => void
}

/** APP 和微信共用原有的世界生成、固定步进、碰撞和计分。 */
export class KartRacingController {
  private readonly session: TrainingSession
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

  private scenePoses: number[][] = []

  constructor(
    private readonly clock: Pick<IClock, 'nowMonotonicMs'>,
    private readonly config: KartRacingGameConfig,
    private readonly events: TrainingGameEvents<KartRacingTrainingResult> = {},
    private readonly options: KartRacingControllerOptions = {},
  ) {
    this.session = new TrainingSession(clock)
    this.track = createDefaultKartTrack(config.trackLength)
    this.world = new KartRacingWorld(config, events)
    this.kart = initialKart(config)
  }

  /** 视图在当前帧读取世界模型，坐标与计分独立于画布尺寸。 */
  getFrame(now = this.clock.nowMonotonicMs()) {
    const session = this.session.getSnapshot(now)
    return {
      session,
      gameInput: this.latestInput,
      kart: this.kart,
      coins: this.world.coins,
      obstacles: this.world.obstacles,
      collectedCoins: this.world.collectedCoins,
      collisionCount: this.world.collisionCount,
      track: this.track,
      items: this.world.items,
      progress: kartTrackProgress(this.kart.distance, this.config.trackLength),
      shieldActive: this.world.shieldHitsRemaining > 0,
      boostActive: this.world.getPhysicsEffects(session.playingElapsedMs).boostFactor > 1,
      finishing: this.pendingResult !== null && !this.completionDelivered,
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
    const seed = this.options.makeSeed?.() ?? Math.floor(Math.random() * 0xffffffff)
    this.kart = initialKart(this.config)
    this.metricSamples = []
    this.scenePoses = []
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
    this.captureScene(0)
    this.session.start(this.clock.nowMonotonicMs(), 3_000)
    this.lastFrameAt = this.clock.nowMonotonicMs()
    this.notifySessionState()
    this.publishHud(true)
  }

  pause(now = this.clock.nowMonotonicMs()): void {
    const state = this.session.getSnapshot(now).state
    if (state !== 'playing' && state !== 'countdown') return
    this.events.onReplayEvent?.({ elapsedMs: this.getTrainingElapsedMs(now), type: 'pause' })
    this.session.pause(now)
    this.accumulatorMs = 0
    this.lastFrameAt = now
    this.notifySessionState()
    this.publishHud(true)
  }

  resume(now = this.clock.nowMonotonicMs()): void {
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
    this.session.abort(this.clock.nowMonotonicMs())
    this.notifySessionState()
  }

  getTrainingElapsedMs(now = this.clock.nowMonotonicMs()): number {
    return this.session.getSnapshot(now).playingElapsedMs
  }

  /** 用固定物理步长推进训练，绘制和粒子由宿主处理。 */
  update(now = this.clock.nowMonotonicMs()): void {
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
    this.options.onRenderTick?.(now, particleDeltaSeconds)
    if (this.pendingResult && !this.completionDelivered && now - this.finishStartedAt >= this.config.finishCelebrationMs) {
      this.completionDelivered = true
      this.events.onCompleted?.(this.pendingResult)
    }
  }

  private fixedUpdate(dtSeconds: number, elapsedMs: number): void {
    const effects = this.world.getPhysicsEffects(elapsedMs)
    this.kart = stepKartRacing(this.kart, this.latestInput, this.track, this.config, dtSeconds, effects)
    const feedback = this.world.update(elapsedMs, this.kart)
    this.options.onStep?.(this.world, feedback, elapsedMs)
    this.publishTrackEvents(elapsedMs)
    if (elapsedMs >= this.nextMetricElapsedMs) this.captureScene(elapsedMs)
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
    this.finishScene(this.pendingResult.durationMs)
    this.finishStartedAt = now
    this.events.onReplayEvent?.({ elapsedMs: this.pendingResult.durationMs, type: 'kart-complete', payload: { reason, distance: this.kart.distance } })
    this.notifySessionState()
    this.publishHud(true)
  }

  /** 保存稀疏的实际位姿，回放拖动进度时可以直接定位。 */
  private captureScene(elapsedMs: number): void {
    if (!this.options.recordScene || !this.events.onReplayEvent) return
    const { lateral, speed, distance } = this.kart
    const flags = Number(this.world.shieldHitsRemaining > 0) + 2 * Number(this.world.getPhysicsEffects(elapsedMs).boostFactor > 1)
    const time = Math.round(elapsedMs)
    const values = [time, lateral, speed, distance, flags].map(round4)
    const last = this.scenePoses[this.scenePoses.length - 1]
    if (last?.[0] === time) this.scenePoses[this.scenePoses.length - 1] = values
    else this.scenePoses.push(values)
    this.options.onScenePose?.(time, lateral, distance)
  }

  private finishScene(elapsedMs: number): void {
    if (!this.options.recordScene) return
    this.captureScene(elapsedMs)
    this.events.onReplayEvent?.({ elapsedMs: 0, type: 'kart-scene', payload: { version: 1, poses: this.scenePoses } })
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

function formatClock(value: number): string {
  const seconds = Math.floor(Math.max(0, value) / 1_000)
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}
