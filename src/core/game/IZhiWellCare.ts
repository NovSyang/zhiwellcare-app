import type { GameInput } from '../game-input/GameInput'

/** 正式训练游戏的最小生命周期约定，避免过早引入复杂基类。 */
export interface IZhiWellCare {
  mount(container: HTMLElement): Promise<void>
  setInput(input: GameInput): void
  start(): void
  pause(): void
  resume(): void
  abort(): void
  destroy(): void
}
