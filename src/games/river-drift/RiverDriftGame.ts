import { Application } from 'pixi.js'
import type { GameInput } from '../../core/game-input/GameInput'
import type { ITrainingGame } from '../../core/game/ITrainingGame'
import { browserClock } from '../../platform/time/BrowserClock'
import type { TrainingGameEvents } from '../../core/game/TrainingGameEvents'
import { RiverDriftArt } from './art/RiverDriftArt'
import { defaultRiverDriftGameConfig, type RiverDriftGameConfig } from './RiverDriftGameConfig'
import { createRiverDriftViewport } from './RiverDriftViewport'
import type { RiverDriftTrainingResult } from './RiverDriftTrainingResult'
import { RiverDriftController } from './RiverDriftController'

/** 原 APP 的 Pixi 图层继续处理纹理、粒子与窗口尺寸。 */
export class RiverDriftGame implements ITrainingGame<RiverDriftTrainingResult, HTMLElement> {
  private app: Application | null = null
  private art: RiverDriftArt | null = null
  private resizeObserver: ResizeObserver | null = null
  private readonly controller: RiverDriftController
  private nextWakeElapsedMs = 0

  constructor(
    private readonly config: RiverDriftGameConfig = structuredClone(defaultRiverDriftGameConfig),
    events: TrainingGameEvents<RiverDriftTrainingResult> = {},
  ) {
    this.controller = new RiverDriftController(browserClock, config, events, {
      makeSeed: createSeed,
      onStep: (world, boat, feedback, dtSeconds, elapsedMs) => {
        this.art?.updateParticles(dtSeconds)
        for (const id of feedback.collectedCoinIds) {
          const coin = world.coins.find((item) => item.id === id)
          if (coin) this.art?.spawnCoinBurst(coin)
        }
        for (const id of feedback.hitObstacleIds) {
          const obstacle = world.obstacles.find((item) => item.id === id)
          if (obstacle) this.art?.spawnHitSplash(obstacle, elapsedMs)
        }
        if (elapsedMs >= this.nextWakeElapsedMs) {
          this.art?.spawnWake(boat)
          this.nextWakeElapsedMs += 140
        }
      },
    })
  }

  async mount(container: HTMLElement): Promise<void> {
    this.destroy()
    const app = new Application()
    await app.init({ resizeTo: container, antialias: true, background: '#87cfe0', resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true })
    container.appendChild(app.canvas)
    this.app = app
    this.art = new RiverDriftArt(app, this.config)
    // 校准等待阶段也显示完整河道；正式开始时会再次按新种子重置。
    this.controller.resetPreview()
    // Canvas 尺寸变化时只重新映射坐标，训练模型和游戏实例保持不变。
    this.resizeObserver = new ResizeObserver(() => requestAnimationFrame(() => this.render(performance.now())))
    this.resizeObserver.observe(container)
    app.ticker.add(() => {
      const now = performance.now()
      this.controller.update(now)
      this.render(now)
    })
    this.render(performance.now())
  }

  setInput(input: GameInput): void { this.controller.setInput(input) }
  start(): void {
    this.nextWakeElapsedMs = 0
    this.controller.start()
  }
  pause(now?: number): void { this.controller.pause(now) }
  resume(now?: number): void { this.controller.resume(now) }
  abort(): void { this.controller.abort() }
  getTrainingElapsedMs(now?: number): number { return this.controller.getTrainingElapsedMs(now) }

  destroy(): void {
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.art?.destroy()
    this.art = null
    this.app?.destroy(true, { children: true })
    this.app = null
  }

  private render(now: number): void {
    if (!this.app || !this.art) return
    const frame = this.controller.getFrame(now)
    this.art.render({
      ...frame,
      viewport: createRiverDriftViewport(this.app.screen.width, this.app.screen.height),
      elapsedMs: frame.session.playingElapsedMs,
      countdownRemainingMs: frame.session.countdownRemainingMs,
      state: frame.session.state,
    })
  }
}

function createSeed(): number {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') return crypto.getRandomValues(new Uint32Array(1))[0]
  return Math.floor(Math.random() * 0xffffffff)
}
