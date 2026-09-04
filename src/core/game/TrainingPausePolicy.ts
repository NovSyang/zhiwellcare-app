import type { TrainingSessionState } from '../training/TrainingSessionState'

export type PauseReason = 'none' | 'manual' | 'disconnect' | 'app-background'

/** 断线时保留用户主动暂停，否则标记为可自动恢复的系统暂停。 */
export function pauseReasonAfterDisconnect(current: PauseReason, state: TrainingSessionState): PauseReason {
  if (state === 'paused') return current
  return state === 'playing' || state === 'countdown' ? 'disconnect' : current
}

/** 进入后台时保留手动暂停，否则标记为需要回前台重新校准的系统暂停。 */
export function pauseReasonAfterBackground(current: PauseReason, state: TrainingSessionState): PauseReason {
  if (current === 'manual' || state === 'paused') return current
  return state === 'playing' || state === 'countdown' ? 'app-background' : current
}

/** 只有断线造成的暂停可在重新中心校准后自动恢复。 */
export function shouldAutoResume(reason: PauseReason): boolean {
  return reason === 'disconnect' || reason === 'app-background'
}
