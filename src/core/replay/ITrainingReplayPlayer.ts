import type { TrainingReplay } from './TrainingReplay'

export type ReplayPlayerState = 'idle' | 'playing' | 'paused' | 'ended'
export type ReplayMode = 'dynamic' | 'trajectory'

/** 页面控制条需要的播放器状态快照。 */
export interface ReplayPlayerSnapshot {
  state: ReplayPlayerState
  currentTimeMs: number
  durationMs: number
  playbackRate: number
}

/** 每款游戏只实现绘制，播放控制由历史面板统一提供。 */
export interface ITrainingReplayPlayer {
  mount(container: HTMLElement): Promise<void>
  load(replay: TrainingReplay): void
  setMode(mode: ReplayMode): void
  play(): void
  pause(): void
  restart(): void
  seek(elapsedMs: number): void
  setPlaybackRate(rate: number): void
  getSnapshot(): ReplayPlayerSnapshot
  onChanged(callback: (snapshot: ReplayPlayerSnapshot) => void): () => void
  destroy(): void
}
