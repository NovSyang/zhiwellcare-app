import { Application } from 'pixi.js'
import type { GameInput } from '../../core/game-input/GameInput'
import type { ITrainingGame } from '../../core/game/ITrainingGame'
import { browserClock } from '../../platform/time/BrowserClock'
import type { TrainingGameEvents } from '../../core/game/TrainingGameEvents'
import { KartRacingArt } from './art/KartRacingArt'
import { defaultKartRacingGameConfig, type KartRacingGameConfig } from './KartRacingGameConfig'
import { createKartRacingViewport } from './KartRacingViewport'
import type { KartRacingTrainingResult } from './KartRacingTrainingResult'
import { KartRacingController } from './KartRacingController'

/** 原 APP 的 Pixi 图层继续处理纹理、粒子与窗口尺寸。 */
export class KartRacingGame implements ITrainingGame<KartRacingTrainingResult, HTMLElement> {
  private app: Application | null = null
  private art: KartRacingArt | null = null
  private resizeObserver: ResizeObserver | null = null
  private readonly controller: KartRacingController

  constructor(
    private readonly config: KartRacingGameConfig = structuredClone(defaultKartRacingGameConfig),
    events: TrainingGameEvents<KartRacingTrainingResult> = {},
  ) {
    this.controller = new KartRacingController(browserClock, config, events, {
      makeSeed: createSeed,
      onStep: (world, feedback, elapsedMs) => {
        for (const id of feedback.collectedCoinIds) {
          const coin = world.coins.find((item) => item.id === id)
          if (coin) this.art?.spawnCoinFeedback(coin)
        }
        for (const id of feedback.hitObstacleIds) {
          if (world.obstacles.some((item) => item.id === id)) this.art?.spawnHitFeedback(elapsedMs)
        }
        for (const collected of feedback.collectedItems) {
          const item = world.items.find((candidate) => candidate.id === collected.id)
          if (item) this.art?.spawnItemFeedback(item, collected.type === 'shield' ? 0x61d8ff : 0xff9b42)
        }
      },
      onRenderTick: (now, dt) => {
        this.art?.updateParticles(dt)
        this.render(now)
      },
    })
  }

  async mount(container: HTMLElement): Promise<void> {
    this.destroy()
    const app = new Application()
    await app.init({ resizeTo: container, antialias: true, background: '#72c7f2', resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true })
    container.appendChild(app.canvas)
    this.app = app
    this.art = new KartRacingArt(app, this.config)
    this.resizeObserver = new ResizeObserver(() => requestAnimationFrame(() => this.render(performance.now())))
    this.resizeObserver.observe(container)
    app.ticker.add(() => this.controller.update(performance.now()))
    this.render(performance.now())
  }

  setInput(input: GameInput): void { this.controller.setInput(input) }
  start(): void { this.controller.start() }
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
      viewport: createKartRacingViewport(this.app.screen.width, this.app.screen.height),
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
