import {
  copyMotionProfile, TrainingReplayRecorder, type BaseTrainingResult, type TrainingGameEvents, type TrainingSessionSnapshot, type GameInput, type IClock, type MotionProfile,
  type TrainingRecord, type TrainingRecordDeviceSnapshot,
} from '../../../../../../src/core/shared'
import type { SceneOverviewPoint } from '../../../platform/canvas/SceneOverviewProjection'
import { RuntimeTrajectory, type RuntimeTrajectoryMode } from './RuntimeTrajectory'

export type TrainingPauseReason = 'manual' | 'background' | 'disconnect' | 'calibration' | 'signal'
export interface TrainingRunOptions {
  clock: IClock
  profile: MotionProfile
  device: TrainingRecordDeviceSnapshot
  makeId?: () => string
}

interface RunController<Frame> {
  getFrame(now?: number): Frame
  getTrainingElapsedMs(now?: number): number
  setInput(input: GameInput): void
  start(): void
  pause(now?: number): void
  resume(now?: number): void
  abort(): void
  update(now: number, hasNewInput: boolean): void
}

type CaptureScenePoint = (elapsedMs: number, point: SceneOverviewPoint, distance: number) => void
const SENSOR_FRESH_MS = 250

/** 所有训练共用设备检查、前后台暂停、回放采样和保存快照。 */
export class MiniTrainingRun<Result extends BaseTrainingResult, Config, Frame extends { session: TrainingSessionSnapshot }> {
  private readonly controller: RunController<Frame>
  private readonly recorder = new TrainingReplayRecorder()
  private readonly trajectory = new RuntimeTrajectory()
  private lastTrajectorySampleAt = -Infinity
  private recordingSceneTrajectory = false
  private readonly clock: IClock
  private input: GameInput | null = null
  private lastFrameAt: number | null = null
  private newFrame = false
  private foreground = true
  private reason: TrainingPauseReason | null = null
  private record: TrainingRecord<Result, Config> | null = null

  constructor(
    options: TrainingRunOptions,
    game: { id: string; name: string; config: Config },
    createController: (events: TrainingGameEvents<Result>, captureScenePoint: CaptureScenePoint) => RunController<Frame>,
    private readonly trajectorySource: 'input' | 'scene' = 'input',
  ) {
    const { clock, makeId = makeRecordId } = options
    this.clock = clock
    const motionProfile = copyMotionProfile(options.profile)
    const device = { ...options.device, capabilityTags: [...options.device.capabilityTags] }
    this.controller = createController({
      onReplayEvent: (event) => this.recorder.recordEvent(event),
      onCompleted: (result) => {
        this.record = {
          schemaVersion: 2,
          id: makeId(),
          gameId: game.id,
          gameName: game.name,
          completedAt: clock.nowEpochMs(),
          result,
          motionProfile,
          device,
          gameConfig: game.config,
          replay: this.recorder.finish(result.durationMs),
        }
      },
    }, (elapsedMs, point, distance) => {
      if (this.recordingSceneTrajectory) this.trajectory.appendScene(elapsedMs, point, distance)
    })
  }

  receive(input: GameInput): void {
    if (!Number.isFinite(input.x) || !Number.isFinite(input.y)) this.trajectory.breakSegment()
    if (!input.connected) {
      this.lastFrameAt = null
      this.newFrame = false
      this.pause('disconnect')
    } else if (this.foreground && input.timestamp !== this.input?.timestamp) {
      // 先在 Epoch 上确认首帧有效，再用单调时间记录本地到达时刻。
      const age = this.clock.nowEpochMs() - input.timestamp
      this.lastFrameAt = input.timestamp > 0 && age >= 0 && age <= SENSOR_FRESH_MS
        ? this.clock.nowMonotonicMs() : null
      this.newFrame = this.lastFrameAt !== null
      if (!this.newFrame) this.trajectory.breakSegment()
    }
    if (input.connected && !input.calibrated) this.pause('calibration')
    this.input = input
    this.controller.setInput(input)
  }

  setForeground(visible: boolean): void {
    this.foreground = visible
    if (!visible) {
      this.lastFrameAt = null
      this.newFrame = false
      this.pause('background')
    }
  }

  start(): void {
    if (this.controller.getFrame().session.state !== 'idle') return
    this.checkReady()
    this.controller.start()
  }

  resume(): void {
    if (this.controller.getFrame().session.state !== 'paused') return
    this.checkReady()
    this.reason = null
    this.controller.resume()
  }

  pause(reason: TrainingPauseReason = 'manual'): void {
    // 连续暂停期间也可能断线或重置中心，下一条有效数据应独立起笔。
    if (reason !== 'manual') this.trajectory.breakSegment()
    const now = this.clock.nowMonotonicMs()
    const state = this.controller.getFrame(now).session.state
    if (state !== 'playing' && state !== 'countdown') return
    this.reason = reason
    this.controller.pause(now)
  }

  abort(): void { this.controller.abort() }

  tick(): void {
    const now = this.clock.nowMonotonicMs()
    const state = this.controller.getFrame(now).session.state
    if (state !== 'countdown' && state !== 'playing') return
    if (!this.isReady(now)) {
      this.pause('signal')
      return
    }
    // 定时器按业务时钟推进；与 Canvas 刷新频率无关。
    const playing = state === 'playing'
    const validPosition = this.input && Number.isFinite(this.input.x) && Number.isFinite(this.input.y)
    if (playing && this.input && this.newFrame) {
      this.recorder.recordInput(this.input, this.controller.getTrainingElapsedMs(now))
      if (this.trajectorySource === 'input') {
        const sample = this.recorder.readLatestInputSample(this.lastTrajectorySampleAt)
        if (sample) {
          this.lastTrajectorySampleAt = sample.elapsedMs
          if (validPosition) this.trajectory.appendInput(sample)
        }
      }
    }
    // 场景回调与已有历史位姿同源，只接受有效训练中的采样。
    this.recordingSceneTrajectory = this.trajectorySource === 'scene' && playing && Boolean(validPosition)
    try { this.controller.update(now, this.newFrame) }
    finally { this.recordingSceneTrajectory = false }
    this.newFrame = false
  }

  getFrame(): Frame { return this.controller.getFrame() }
  getRecord(): TrainingRecord<Result, Config> | null { return this.record }

  getTrajectory(mode: RuntimeTrajectoryMode, elapsedMs: number, tailMs?: number) {
    return this.trajectory.snapshot(mode, elapsedMs, tailMs)
  }

  getStatus() {
    return { ready: this.isReady(this.clock.nowMonotonicMs()), reason: this.reason }
  }

  private isReady(now: number): boolean {
    return this.foreground && this.input?.connected === true && this.input.calibrated
      && this.lastFrameAt !== null && now - this.lastFrameAt <= SENSOR_FRESH_MS
  }

  private checkReady(): void {
    if (!this.isReady(this.clock.nowMonotonicMs())) throw new Error('请连接训练设备、完成中心校准并确认收到姿态数据。')
  }
}

/** 同一局生成一次记录 ID，保存失败后的重试使用同一条记录。 */
function makeRecordId(): string {
  return typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `mini-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
