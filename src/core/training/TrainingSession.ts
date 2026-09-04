import type { TrainingSessionState } from './TrainingSessionState'

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
  private playingStartedAt = 0
  private pausedAt = 0
  private pausedFrom: 'countdown' | 'playing' | null = null
  private pausedCountdownRemainingMs = 0
  private totalPausedMs = 0
  private completedAt: number | null = null

  start(now = performance.now(), countdownMs = 3000): void {
    this.countdownDurationMs = Math.max(0, countdownMs)
    this.countdownStartedAt = now
    this.playingStartedAt = this.countdownDurationMs === 0 ? now : 0
    this.pausedAt = 0
    this.pausedFrom = null
    this.pausedCountdownRemainingMs = 0
    this.totalPausedMs = 0
    this.completedAt = null
    this.state = this.countdownDurationMs === 0 ? 'playing' : 'countdown'
  }

  update(now = performance.now()): void {
    if (this.state === 'countdown' && now - this.countdownStartedAt >= this.countdownDurationMs) {
      this.playingStartedAt = now
      this.state = 'playing'
    }
  }

  pause(now = performance.now()): void {
    if (this.state !== 'playing' && this.state !== 'countdown') return
    this.pausedFrom = this.state
    if (this.state === 'countdown') {
      // 断线可能发生在 3 秒倒计时内，保存剩余时间后才能安全恢复。
      this.pausedCountdownRemainingMs = Math.max(0, this.countdownDurationMs - (now - this.countdownStartedAt))
    }
    this.pausedAt = now
    this.state = 'paused'
  }

  resume(now = performance.now()): void {
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

  complete(now = performance.now()): void {
    if (this.state !== 'playing' && this.state !== 'paused') return
    this.finish(now, 'completed')
  }

  abort(now = performance.now()): void {
    if (this.state === 'idle' || this.state === 'completed' || this.state === 'aborted') return
    this.finish(now, 'aborted')
  }

  reset(): void {
    this.state = 'idle'
    this.countdownStartedAt = 0
    this.playingStartedAt = 0
    this.pausedAt = 0
    this.pausedFrom = null
    this.pausedCountdownRemainingMs = 0
    this.totalPausedMs = 0
    this.completedAt = null
  }

  getSnapshot(now = performance.now()): TrainingSessionSnapshot {
    const countdownRemainingMs = this.state === 'countdown'
      ? Math.max(0, this.countdownDurationMs - (now - this.countdownStartedAt))
      : this.state === 'paused' && this.pausedFrom === 'countdown'
        ? this.pausedCountdownRemainingMs
        : 0
    const end = this.completedAt ?? (this.state === 'paused' ? this.pausedAt : now)
    const playingElapsedMs = this.playingStartedAt === 0
      ? 0
      : Math.max(0, end - this.playingStartedAt - this.totalPausedMs)

    return {
      state: this.state,
      countdownRemainingMs,
      playingElapsedMs,
      // 时间戳可能为 0，不能使用逻辑或运算符把它误判为未开始。
      startedAt: this.playingStartedAt > 0 ? this.playingStartedAt : null,
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
