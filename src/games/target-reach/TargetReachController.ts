import type { GameInput } from '../../core/game-input/GameInput'
import type { IClock } from '../../core/time/IClock'
import type { Direction } from '../../core/training/Direction'
import { TrainingSession } from '../../core/training/TrainingSession'
import type { TrainingSessionState } from '../../core/training/TrainingSessionState'
import type { TargetReachGameConfig } from './TargetReachGameConfig'
import type { TargetReachGameEvents } from './TargetReachGameEvents'
import { distanceBetween, getTargetHoldProgress, getTargetPosition } from './TargetReachMath'
import { buildTargetReachTrainingResult, type TargetAttemptResult } from './TargetReachTrainingResult'

/** 渲染器读取同一份归一化状态，目标判定仍按有效训练时间推进。 */
export interface TargetReachFrame {
  session: ReturnType<TrainingSession['getSnapshot']>
  input: GameInput
  target: { x: number; y: number; direction: Direction; label: string; holdProgress: number } | null
}

/** 四方挥腕挑战的业务状态，时间与绘制表面由外部提供。 */
export class TargetReachController {
  private readonly session: TrainingSession
  private latestInput: GameInput = emptyGameInput()
  private currentDirection: Direction | null = null
  private targetStartedAt = 0
  private targetStartedElapsedMs = 0
  private firstMovementAt: number | null = null
  private currentReactionTimeMs: number | null = null
  private targetHoldStartedElapsedMs: number | null = null
  private targetSuccessFeedbackStartedElapsedMs: number | null = null
  private currentMaxInput = 0
  private attempts: TargetAttemptResult[] = []
  private lastNotifiedState: TrainingSessionState = 'idle'

  constructor(
    private readonly clock: Pick<IClock, 'nowMonotonicMs'>,
    private readonly config: TargetReachGameConfig,
    private readonly events: TargetReachGameEvents = {},
    private readonly random: () => number = Math.random,
  ) {
    this.session = new TrainingSession(clock)
  }

  setInput(input: GameInput): void {
    this.latestInput = input
    const state = this.session.getSnapshot().state
    if (!input.connected && (state === 'playing' || state === 'countdown')) this.pause()
  }

  start(): void {
    if (!this.latestInput.connected) throw new Error('开始训练前必须连接 BS-BT91')
    if (!this.latestInput.calibrated) throw new Error('开始训练前必须完成中心校准')

    this.attempts = []
    this.clearCurrentTarget()
    this.currentReactionTimeMs = null
    this.session.start(this.clock.nowMonotonicMs(), 3000)
    this.notifySessionState()
  }

  pause(now = this.clock.nowMonotonicMs()): void {
    const state = this.session.getSnapshot(now).state
    if (state !== 'playing' && state !== 'countdown') return
    // 暂停会打断连续保持，恢复后必须重新满足完整 Hold 时间。
    this.targetHoldStartedElapsedMs = null
    this.events.onReplayEvent?.({ elapsedMs: this.getTrainingElapsedMs(now), type: 'pause' })
    this.session.pause(now)
    this.notifySessionState()
  }

  resume(now = this.clock.nowMonotonicMs()): void {
    if (!this.latestInput.connected) throw new Error('传感器未连接，无法继续训练')
    if (!this.latestInput.calibrated) throw new Error('请重新完成中心校准后继续训练')

    if (this.session.getSnapshot(now).state !== 'paused') return
    this.session.resume(now)
    this.events.onReplayEvent?.({ elapsedMs: this.getTrainingElapsedMs(now), type: 'resume' })
    this.notifySessionState()
  }

  abort(): void {
    this.session.abort(this.clock.nowMonotonicMs())
    this.clearCurrentTarget()
    this.notifySessionState()
  }

  update(now = this.clock.nowMonotonicMs(), hasNewInput = true): void {
    this.session.update(now)
    this.notifySessionState()
    const snapshot = this.session.getSnapshot(now)
    if (snapshot.state === 'countdown' || snapshot.state !== 'playing') return

    // 成功计分后保留完整圆环一小段时间，期间不再处理输入或生成目标。
    if (this.targetSuccessFeedbackStartedElapsedMs !== null) {
      const feedbackElapsedMs = snapshot.playingElapsedMs - this.targetSuccessFeedbackStartedElapsedMs
      if (feedbackElapsedMs < this.getSuccessFeedbackDurationMs()) return
      this.clearCurrentTarget()
    }
    if (snapshot.playingElapsedMs >= this.config.sessionDurationMs || this.attempts.length >= this.config.targetCount) {
      this.complete(now)
      return
    }
    if (this.currentDirection === null) {
      this.beginNextTarget(now)
      return
    }
    if (this.getCurrentTargetElapsedMs(now) >= this.config.targetTimeoutMs) {
      this.finishCurrentTarget(now, false)
      return
    }
    // 微信只在收到新姿态时评估命中，倒计时和超时可独立推进。
    if (hasNewInput) this.updateCurrentAttempt(now)
  }

  private beginNextTarget(now: number): void {
    this.currentDirection = this.pickNextDirection()
    this.targetStartedAt = now
    this.targetStartedElapsedMs = this.session.getSnapshot(now).playingElapsedMs
    this.firstMovementAt = null
    this.currentReactionTimeMs = null
    this.targetHoldStartedElapsedMs = null
    this.targetSuccessFeedbackStartedElapsedMs = null
    this.currentMaxInput = 0
    this.events.onTargetChanged?.(this.currentDirection, this.attempts.length + 1)
    const targetPoint = getTargetPosition(this.currentDirection, this.config.targetDistance)
    this.events.onReplayEvent?.({
      elapsedMs: this.getTrainingElapsedMs(now),
      type: 'target-start',
      payload: {
        index: this.attempts.length + 1,
        direction: this.currentDirection,
        targetX: targetPoint.x,
        targetY: targetPoint.y,
      },
    })
  }

  private updateCurrentAttempt(now: number): void {
    if (!this.currentDirection) return
    const targetPoint = getTargetPosition(this.currentDirection, this.config.targetDistance)
    const currentPoint = { x: this.latestInput.x, y: this.latestInput.y }
    const magnitude = Math.max(Math.abs(currentPoint.x), Math.abs(currentPoint.y))
    this.currentMaxInput = Math.max(this.currentMaxInput, magnitude)
    if (this.firstMovementAt === null && magnitude >= this.config.movementThreshold) {
      this.firstMovementAt = now
      // 反应时间在首次有效动作时固定，不会受后续暂停影响。
      this.currentReactionTimeMs = this.getCurrentTargetElapsedMs(now)
    }

    if (distanceBetween(currentPoint, targetPoint) <= this.config.targetRadius) {
      const sessionElapsed = this.session.getSnapshot(now).playingElapsedMs
      this.targetHoldStartedElapsedMs ??= sessionElapsed
      if (sessionElapsed - this.targetHoldStartedElapsedMs >= this.config.holdTimeMs) {
        this.finishCurrentTarget(now, true)
      }
    } else {
      this.targetHoldStartedElapsedMs = null
    }
  }

  private finishCurrentTarget(now: number, success: boolean): void {
    const direction = this.currentDirection
    if (!direction) return
    this.attempts.push({
      index: this.attempts.length + 1,
      direction,
      startedAt: this.targetStartedAt,
      firstMovementAt: this.firstMovementAt,
      reachedAt: success ? now : null,
      endedAt: now,
      success,
      // 所有受暂停影响的业务时间使用 TrainingSession 的有效训练时间轴。
      reactionTimeMs: this.currentReactionTimeMs === null ? null : Math.max(0, this.currentReactionTimeMs),
      reachTimeMs: success ? Math.max(0, this.getCurrentTargetElapsedMs(now)) : null,
      maxInput: this.currentMaxInput,
    })
    this.events.onReplayEvent?.({
      elapsedMs: this.getTrainingElapsedMs(now),
      type: success ? 'target-success' : 'target-failed',
      payload: { index: this.attempts.length },
    })
    this.targetHoldStartedElapsedMs = null
    if (success && this.getSuccessFeedbackDurationMs() > 0) {
      // 使用有效训练时间计时，断线或暂停不会悄悄消耗完整圆环的展示时间。
      this.targetSuccessFeedbackStartedElapsedMs = this.session.getSnapshot(now).playingElapsedMs
    } else {
      this.clearCurrentTarget()
    }
    const successCount = this.attempts.filter((attempt) => attempt.success).length
    this.events.onScoreChanged?.(successCount, this.attempts.length)
  }

  private complete(now: number): void {
    this.session.complete(now)
    this.clearCurrentTarget()
    const snapshot = this.session.getSnapshot(now)
    const result = buildTargetReachTrainingResult(
      snapshot.startedAt ?? now,
      snapshot.completedAt ?? now,
      snapshot.playingElapsedMs,
      this.attempts,
    )
    this.notifySessionState()
    this.events.onCompleted?.(result)
  }

  /** 返回当前目标已消耗的有效训练时间，自动排除任意次数的暂停。 */
  private getCurrentTargetElapsedMs(now: number): number {
    const sessionElapsed = this.session.getSnapshot(now).playingElapsedMs
    return Math.max(0, sessionElapsed - this.targetStartedElapsedMs)
  }

  /** 供训练页 Recorder 使用的有效训练时间，不包含真实暂停时长。 */
  getTrainingElapsedMs(now = this.clock.nowMonotonicMs()): number {
    return this.session.getSnapshot(now).playingElapsedMs
  }

  private pickNextDirection(): Direction {
    const directions = this.config.enabledDirections
    if (directions.length === 0) throw new Error('至少启用一个训练方向')
    if (directions.length === 1) return directions[0]
    // 直接索引末项，兼容微信端较旧的 JavaScript 运行时。
    const lastDirection = this.attempts[this.attempts.length - 1]?.direction
    const candidates = lastDirection ? directions.filter((direction) => direction !== lastDirection) : directions
    return candidates[Math.floor(this.random() * candidates.length)]
  }

  private getSuccessFeedbackDurationMs(): number {
    return Number.isFinite(this.config.successFeedbackMs) ? Math.max(0, this.config.successFeedbackMs) : 0
  }

  /** 清理当前目标和进度，下一次更新可以生成新目标。 */
  private clearCurrentTarget(): void {
    this.currentDirection = null
    this.targetHoldStartedElapsedMs = null
    this.targetSuccessFeedbackStartedElapsedMs = null
  }

  getFrame(now = this.clock.nowMonotonicMs()): TargetReachFrame {
    const session = this.session.getSnapshot(now)
    const direction = this.currentDirection
    return {
      session,
      input: this.latestInput,
      target: direction === null ? null : {
        ...getTargetPosition(direction, this.config.targetDistance),
        direction,
        label: directionLabel(direction),
        holdProgress: this.targetSuccessFeedbackStartedElapsedMs !== null
          ? 1
          : getTargetHoldProgress(session.playingElapsedMs, this.targetHoldStartedElapsedMs, this.config.holdTimeMs),
      },
    }
  }

  private notifySessionState(): void {
    const state = this.session.getSnapshot().state
    if (state === this.lastNotifiedState) return
    this.lastNotifiedState = state
    this.events.onSessionStateChanged?.(state)
  }
}

function emptyGameInput(): GameInput {
  return { x: 0, y: 0, connected: false, calibrated: false, timestamp: 0 }
}

function directionLabel(direction: Direction): string {
  return { left: '向左挥动', right: '向右挥动', forward: '向前挥动', backward: '向后挥动' }[direction]
}
