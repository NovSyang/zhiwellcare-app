import type { GameInput } from '../../core/game-input/GameInput'
import type { IClock } from '../../core/time/IClock'
import type { TrainingGameEvents } from '../../core/game/TrainingGameEvents'
import { TrainingSession } from '../../core/training/TrainingSession'
import type { TrainingSessionState } from '../../core/training/TrainingSessionState'
import type { RiverDriftGameConfig } from './RiverDriftGameConfig'
import { stepRiverDriftBoat, type RiverDriftBoatState } from './RiverDriftPhysics'
import { buildRiverDriftTrainingResult, type RiverDriftMetricSample, type RiverDriftTrainingResult } from './RiverDriftTrainingResult'
import { emptyRiverDriftInput, RiverDriftWorld, type RiverDriftWorldFeedback } from './RiverDriftWorld'

import { round4 } from '../../core/replay/ReplayMath'

interface RiverDriftControllerOptions {
  makeSeed?: () => number
  recordScene?: boolean
  /** 在原有位姿采样点发布船位与河流距离，供实时概览使用。 */
  onScenePose?: (elapsedMs: number, boatX: number, worldDistance: number) => void
  onStep?: (world: RiverDriftWorld, boat: RiverDriftBoatState, feedback: RiverDriftWorldFeedback, dt: number, elapsedMs: number) => void
}

/** APP 和微信共用原有的世界生成、固定步进、碰撞和计分。 */
export class RiverDriftController {
  private readonly session: TrainingSession
  private latestInput: GameInput = emptyRiverDriftInput()
  private world: RiverDriftWorld
  private boat: RiverDriftBoatState = initialBoat()
  private metricSamples: RiverDriftMetricSample[] = []
  private nextMetricElapsedMs = 0
  private nextHudElapsedMs = 0
  private simulatedElapsedMs = 0
  private accumulatorMs = 0
  private lastFrameAt = 0
  private lastNotifiedState: TrainingSessionState = 'idle'

  private scenePoses: number[][] = []

  constructor(
    private readonly clock: Pick<IClock, 'nowMonotonicMs'>,
    private readonly config: RiverDriftGameConfig,
    private readonly events: TrainingGameEvents<RiverDriftTrainingResult> = {},
    private readonly options: RiverDriftControllerOptions = {},
  ) {
    this.session = new TrainingSession(clock)
    this.world = new RiverDriftWorld(config, events)
  }

  /** 视图在当前帧读取世界模型，坐标与计分独立于画布尺寸。 */
  getFrame(now = this.clock.nowMonotonicMs()) {
    const session = this.session.getSnapshot(now)
    return {
      session,
      gameInput: this.latestInput,
      boat: this.boat,
      coins: this.world.coins,
      obstacles: this.world.obstacles,
      collectedCoins: this.world.collectedCoins,
      collisionCount: this.world.collisionCount,
      segments: this.world.segments,
      worldDistance: this.world.worldDistance,
    }
  }

  /** APP 等待校准时用固定种子预览河道。 */
  resetPreview(): void { this.world.reset(1) }

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
    this.scenePoses = []
    this.nextMetricElapsedMs = 0
    this.nextHudElapsedMs = 0
    this.simulatedElapsedMs = 0
    this.accumulatorMs = 0
    this.events.onReplayEvent?.({ elapsedMs: 0, type: 'river-start', payload: { version: 1, boatX: this.boat.x, boatY: this.boat.y } })
    this.world.reset(this.options.makeSeed?.() ?? Math.floor(Math.random() * 0xffffffff))
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
  }

  private fixedUpdate(dtSeconds: number, elapsedMs: number): void {
    const horizontal = this.world.getBoatHorizontalBounds(this.boat.y)
    this.boat = stepRiverDriftBoat(this.boat, this.latestInput, {
      ...horizontal,
      minY: this.config.boatVerticalMin,
      maxY: this.config.boatVerticalMax,
    }, this.config, dtSeconds)
    const feedback = this.world.update(dtSeconds, elapsedMs, this.boat)
    this.options.onStep?.(this.world, this.boat, feedback, dtSeconds, elapsedMs)
    if (feedback.collectedCoinIds.length || feedback.hitObstacleIds.length) this.publishHud(true)
    if (elapsedMs >= this.nextMetricElapsedMs) this.captureScene(elapsedMs)
    while (elapsedMs >= this.nextMetricElapsedMs) {
      this.metricSamples.push({ x: this.latestInput.x, y: this.latestInput.y })
      this.nextMetricElapsedMs += Math.max(1, this.config.metricSampleIntervalMs)
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
    this.finishScene(result.durationMs)
    this.events.onReplayEvent?.({ elapsedMs: result.durationMs, type: 'river-complete' })
    this.notifySessionState()
    this.publishHud(true)
    this.events.onCompleted?.(result)
  }

  /** 保存稀疏的实际位姿，回放拖动进度时可以直接定位。 */
  private captureScene(elapsedMs: number): void {
    if (!this.options.recordScene || !this.events.onReplayEvent) return
    const { x, y } = this.boat
    const time = Math.round(elapsedMs)
    const distance = this.world.worldDistance
    const values = [time, x, y, distance].map(round4)
    const last = this.scenePoses[this.scenePoses.length - 1]
    if (last?.[0] === time) this.scenePoses[this.scenePoses.length - 1] = values
    else this.scenePoses.push(values)
    this.options.onScenePose?.(time, x, distance)
  }

  private finishScene(elapsedMs: number): void {
    if (!this.options.recordScene) return
    this.captureScene(elapsedMs)
    this.events.onReplayEvent?.({ elapsedMs: 0, type: 'river-scene', payload: { version: 1, poses: this.scenePoses } })
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

function formatClock(value: number): string {
  const seconds = Math.floor(Math.max(0, value) / 1_000)
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}
