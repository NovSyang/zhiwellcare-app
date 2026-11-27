import type { GameInput } from '../game-input/GameInput'

/** 各平台自行声明挂载表面的类型，训练生命周期可以共享。 */
export interface IZhiWellCare<TSurface = unknown> {
  mount(container: TSurface): Promise<void>
  setInput(input: GameInput): void
  start(): void
  pause(): void
  resume(): void
  abort(): void
  destroy(): void
}
