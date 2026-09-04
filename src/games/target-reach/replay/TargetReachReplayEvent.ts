import type { Direction } from '../../../core/training/Direction'

/** TargetReach 写入 Replay 的事实事件；播放器只展示，不重新进行游戏判定。 */
export type TargetReachReplayEvent =
  | {
      elapsedMs: number
      type: 'target-start'
      payload: { index: number; direction: Direction; targetX: number; targetY: number }
    }
  | { elapsedMs: number; type: 'target-success'; payload: { index: number } }
  | { elapsedMs: number; type: 'target-failed'; payload: { index: number } }
  | { elapsedMs: number; type: 'pause' }
  | { elapsedMs: number; type: 'resume' }
