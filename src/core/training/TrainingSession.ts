import type { TrainingSessionState } from './TrainingSessionState'
import type { IClock } from '../time/IClock'

export interface TrainingSessionSnapshot {
  state: TrainingSessionState
  countdownRemainingMs: number
  playingElapsedMs: number
  startedAt: number | null
  completedAt: number | null
}

/** 管理训练倒计时、暂停与有效训练时长，不包含游戏判定逻辑。 */
export class TrainingSession {
  private state: TrainingSessionState = 'idle'
  private countdownDurationMs = 3000
  private countdownStartedAt = 0
  private playingStartedAt: number | null = null
  private pausedAt = 0
  private pausedFrom: 'countdown' | 'playing' | null = null
  private pausedCountdownRemainingMs = 0
  private totalPausedMs = 0
  private completedAt: number | null = null

  constructor(private readonly clock: Pick<IClock, 'nowMonotonicMs'>) {}

  start(now = this.clock.nowMonotonicMs(), countdownMs = 3000): void {
    this.countdownDurationMs = Math.max(0, countdownMs)
    this.countdownStartedAt = now
    this.playingStartedAt = this.countdownDurationMs === 0 ? now : null
    this.pausedAt = 0
    this.pausedFrom = null
    this.pausedCountdownRemainingMs = 0
    this.totalPausedMs = 0
    this.completedAt = null
    this.state = this.countdownDurationMs === 0 ? 'playing' : 'countdown'
  }

  update(now = this.clock.nowMonotonicMs()): void {
    if (this.state === 'countdown' && now - this.countdownStartedAt >= this.countdownDurationMs) {
      this.playingStartedAt = now
      this.state = 'playing'
    }
  }

  pause(now = this.clock.nowMonotonicMs()): void {
    if (this.state !== 'playing' && this.state !== 'countdown') return
    this.pausedFrom = this.state
    if (this.state === 'countdown') {
      // 断线可能发生在 3 秒倒计时内，保存剩余时间后才能安全恢复。
      this.pausedCountdownRemainingMs = Math.max(0, this.countdownDurationMs - (now - this.countdownStartedAt))
    }
    this.pausedAt = now
    this.state = 'paused'
  }

  resume(now = this.clock.nowMonotonicMs()): void {
    if (this.state !== 'paused') return
    if (this.pausedFrom === 'countdown') {
      this.countdownStartedAt = now - (this.countdownDurationMs - this.pausedCountdownRemainingMs)
      this.state = 'countdown'
    } else {
      this.totalPausedMs += now - this.pausedAt
      this.state = 'playing'
    }
    this.pausedAt = 0
    this.pausedFrom = null
    this.pausedCountdownRemainingMs = 0
  }

  complete(now = this.clock.nowMonotonicMs()): void {
    if (this.state !== 'playing' && this.state !== 'paused') return
    this.finish(now, 'completed')
  }

  abort(now = this.clock.nowMonotonicMs()): void {
    if (this.state === 'idle' || this.state === 'completed' || this.state === 'aborted') return
    this.finish(now, 'aborted')
  }

  reset(): void {
    this.state = 'idle'
    this.countdownStartedAt = 0
    this.playingStartedAt = null
    this.pausedAt = 0
    this.pausedFrom = null
    this.pausedCountdownRemainingMs = 0
    this.totalPausedMs = 0
    this.completedAt = null
  }

  getSnapshot(now = this.clock.nowMonotonicMs()): TrainingSessionSnapshot {
    const countdownRemainingMs = this.state === 'countdown'
      ? Math.max(0, this.countdownDurationMs - (now - this.countdownStartedAt))
      : this.state === 'paused' && this.pausedFrom === 'countdown'
        ? this.pausedCountdownRemainingMs
        : 0
    const end = this.completedAt ?? (this.state === 'paused' ? this.pausedAt : now)
    // 单调时钟可以从零开始，用 null 表示训练尚未开始。
    const playingElapsedMs = this.playingStartedAt === null
      ? 0
      : Math.max(0, end - this.playingStartedAt - this.totalPausedMs)

    return {
      state: this.state,
      countdownRemainingMs,
      playingElapsedMs,
      startedAt: this.playingStartedAt,
      completedAt: this.completedAt,
    }
  }

  private finish(now: number, state: 'completed' | 'aborted'): void {
    if (this.state === 'paused' && this.pausedFrom === 'playing') this.totalPausedMs += now - this.pausedAt
    this.pausedAt = 0
    this.pausedFrom = null
    this.pausedCountdownRemainingMs = 0
    this.completedAt = now
    this.state = state
  }
}
