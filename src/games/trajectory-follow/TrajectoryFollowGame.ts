import { Application, Graphics, Text } from 'pixi.js'
import type { GameInput } from '../../core/game-input/GameInput'
import type { ITrainingGame } from '../../core/game/ITrainingGame'
import type { TrainingGameEvents } from '../../core/game/TrainingGameEvents'
import { browserClock } from '../../platform/time/BrowserClock'
import { TrajectoryFollowController } from './TrajectoryFollowController'
import type { TrajectoryReferenceSample } from './TrajectoryFollowMath'
import { defaultTrajectoryFollowGameConfig, type TrajectoryFollowGameConfig } from './TrajectoryFollowGameConfig'
import type { TrajectoryFollowTrainingResult } from './TrajectoryFollowTrainingResult'

/** APP 的 Pixi 图层读取共享控制器，原有训练入口仍可直接使用。 */
export class TrajectoryFollowGame implements ITrainingGame<TrajectoryFollowTrainingResult, HTMLElement> {
  private readonly controller: TrajectoryFollowController
  private app: Application | null = null
  private referenceGraphic: Graphics | null = null
  private trailGraphic: Graphics | null = null
  private playerGraphic: Graphics | null = null
  private guideGraphic: Graphics | null = null
  private countdownText: Text | null = null
  private resizeObserver: ResizeObserver | null = null

  constructor(
    private readonly config: TrajectoryFollowGameConfig = structuredClone(defaultTrajectoryFollowGameConfig),
    events: TrainingGameEvents<TrajectoryFollowTrainingResult> = {},
  ) {
    this.controller = new TrajectoryFollowController(browserClock, config, events)
  }

  async mount(container: HTMLElement): Promise<void> {
    this.destroy()
    const app = new Application()
    await app.init({ resizeTo: container, antialias: true, background: '#08111f', resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true })
    container.appendChild(app.canvas)
    this.referenceGraphic = new Graphics()
    this.trailGraphic = new Graphics()
    this.playerGraphic = new Graphics()
    this.guideGraphic = new Graphics()
    this.countdownText = new Text({ text: '', style: { fill: '#ffffff', fontSize: 72, fontWeight: '700' } })
    this.countdownText.anchor.set(0.5)
    app.stage.addChild(this.referenceGraphic, this.trailGraphic, this.guideGraphic, this.playerGraphic, this.countdownText)
    this.app = app
    // Reference Path 是静态图层，横竖屏切换后必须用新画布尺寸重新绘制。
    this.resizeObserver = new ResizeObserver(() => requestAnimationFrame(() => {
      this.drawReferencePath()
      this.render(performance.now())
    }))
    this.resizeObserver.observe(container)
    app.ticker.add(() => {
      const now = performance.now()
      this.controller.update(now)
      this.render(now)
    })
  }

  setInput(input: GameInput): void { this.controller.setInput(input) }

  start(): void {
    this.controller.start()
    this.drawReferencePath()
  }

  pause(now?: number): void { this.controller.pause(now) }
  resume(now?: number): void { this.controller.resume(now) }
  abort(): void { this.controller.abort() }
  getTrainingElapsedMs(now?: number): number { return this.controller.getTrainingElapsedMs(now) }

  destroy(): void {
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.app?.destroy(true, { children: true })
    this.app = null
    this.referenceGraphic = null
    this.trailGraphic = null
    this.playerGraphic = null
    this.guideGraphic = null
    this.countdownText = null
  }

  private render(now: number): void {
    if (!this.app || !this.playerGraphic || !this.guideGraphic || !this.trailGraphic || !this.countdownText) return
    const { session: snapshot, guide, input, trail } = this.controller.getFrame(now)
    this.drawDot(this.playerGraphic, input.x, input.y, this.config.playerRadius, 0x68d391)
    this.playerGraphic.alpha = input.connected ? 1 : 0.35
    if (guide) this.drawDot(this.guideGraphic, guide.x, guide.y, this.config.guideRadius, 0x8fd8ff, true)
    this.drawPath(this.trailGraphic, trail, 0x68d391, 4, 0.85)
    if (snapshot.state === 'countdown') {
      this.countdownText.text = String(Math.max(1, Math.ceil(snapshot.countdownRemainingMs / 1_000)))
      this.countdownText.position.set(this.app.screen.width / 2, this.app.screen.height / 2)
      this.countdownText.visible = true
    } else this.countdownText.visible = false
  }

  private drawReferencePath(): void {
    if (this.referenceGraphic) this.drawPath(this.referenceGraphic, this.controller.getFrame().reference, 0x4da3ff, 3, 0.55)
  }

  private drawPath(graphic: Graphics, samples: readonly Pick<TrajectoryReferenceSample, 'x' | 'y'>[], color: number, width: number, alpha: number): void {
    graphic.clear()
    if (samples.length < 2) return
    const first = this.toScreen(samples[0].x, samples[0].y)
    graphic.moveTo(first.x, first.y)
    for (const sample of samples.slice(1)) {
      const point = this.toScreen(sample.x, sample.y)
      graphic.lineTo(point.x, point.y)
    }
    graphic.stroke({ width, color, alpha })
  }

  private drawDot(graphic: Graphics, x: number, y: number, radius: number, color: number, outline = false): void {
    const point = this.toScreen(x, y)
    graphic.clear().circle(point.x, point.y, radius)
    outline ? graphic.stroke({ width: 5, color, alpha: 1 }) : graphic.fill(color)
  }

  private toScreen(x: number, y: number): { x: number; y: number } {
    const screen = this.app!.screen
    const padding = 70
    return { x: screen.width / 2 + x * Math.max(0, screen.width / 2 - padding), y: screen.height / 2 - y * Math.max(0, screen.height / 2 - padding) }
  }
}
