import { Application, Graphics, Text } from 'pixi.js'
import type { GameInput } from '../../core/game-input/GameInput'
import type { ITrainingGame } from '../../core/game/ITrainingGame'
import { browserClock } from '../../platform/time/BrowserClock'
import { defaultTargetReachGameConfig, type TargetReachGameConfig } from './TargetReachGameConfig'
import type { TargetReachGameEvents } from './TargetReachGameEvents'
import { TargetReachController } from './TargetReachController'
import {
  createTargetReachViewport,
  getPlayerRadiusPx,
  getTargetReachViewportInsets,
  normalizedToScreen,
} from './TargetReachViewportMapper'
import type { TargetReachTrainingResult } from './TargetReachTrainingResult'

/** APP 的 Pixi 渲染与生命周期入口，训练规则由公共控制器执行。 */
export class TargetReachGame implements ITrainingGame<TargetReachTrainingResult, HTMLElement> {
  private readonly controller: TargetReachController
  private app: Application | null = null
  private player: Graphics | null = null
  private target: Graphics | null = null
  private targetProgress: Graphics | null = null
  private countdownText: Text | null = null
  private directionText: Text | null = null
  private resizeObserver: ResizeObserver | null = null
  private renderedInteractionScale = -1

  constructor(
    private readonly config: TargetReachGameConfig = structuredClone(defaultTargetReachGameConfig),
    events: TargetReachGameEvents = {},
  ) {
    this.controller = new TargetReachController(browserClock, config, events)
  }

  async mount(container: HTMLElement): Promise<void> {
    this.destroy()
    const app = new Application()
    await app.init({
      resizeTo: container,
      antialias: true,
      background: '#08111f',
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    })
    container.appendChild(app.canvas)

    // 玩家球和目标圈的半径取决于最终视口，首次 render 时再绘制。
    const player = new Graphics()
    const target = new Graphics()
    const targetProgress = new Graphics()
    const countdownText = new Text({ text: '', style: { fill: '#ffffff', fontSize: 72, fontWeight: '700' } })
    const directionText = new Text({ text: '', style: { fill: '#8fd8ff', fontSize: 22, fontWeight: '600' } })
    countdownText.anchor.set(0.5)
    directionText.anchor.set(0.5)
    target.visible = false
    targetProgress.visible = false
    directionText.visible = false
    app.stage.addChild(target, targetProgress, player, directionText, countdownText)

    this.app = app
    this.player = player
    this.target = target
    this.targetProgress = targetProgress
    this.countdownText = countdownText
    this.directionText = directionText
    // 容器旋转或分屏后重新按最新 screen 计算目标、玩家和倒计时位置。
    this.resizeObserver = new ResizeObserver(() => requestAnimationFrame(() => this.render(performance.now())))
    this.resizeObserver.observe(container)
    app.ticker.add(() => {
      const now = performance.now()
      this.controller.update(now)
      this.render(now)
    })
  }

  setInput(input: GameInput): void { this.controller.setInput(input) }
  start(): void { this.controller.start() }
  pause(now?: number): void { this.controller.pause(now) }
  resume(now?: number): void { this.controller.resume(now) }
  abort(): void {
    this.controller.abort()
    this.render(browserClock.nowMonotonicMs())
  }
  getTrainingElapsedMs(now?: number): number { return this.controller.getTrainingElapsedMs(now) }

  destroy(): void {
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.app?.destroy(true, { children: true })
    this.app = null
    this.player = null
    this.target = null
    this.targetProgress = null
    this.countdownText = null
    this.directionText = null
    this.renderedInteractionScale = -1
  }

  private render(now: number): void {
    const { app, player, target, targetProgress, countdownText, directionText } = this
    if (!app || !player || !target || !targetProgress || !countdownText || !directionText) return
    const insets = getTargetReachViewportInsets(app.screen.width, app.screen.height)
    const viewport = createTargetReachViewport(app.screen.width, app.screen.height, insets)
    this.redrawViewportGeometry(viewport.interactionScale)
    const { input, session: snapshot, target: activeTarget } = this.controller.getFrame(now)
    const playerPoint = normalizedToScreen(input, viewport)
    player.position.set(playerPoint.x, playerPoint.y)
    player.alpha = input.connected ? 1 : 0.35
    target.visible = activeTarget !== null

    if (activeTarget) {
      const targetPoint = normalizedToScreen(activeTarget, viewport)
      target.position.set(targetPoint.x, targetPoint.y)
      targetProgress.position.set(targetPoint.x, targetPoint.y)
      this.redrawTargetProgress(targetProgress, this.config.targetRadius * viewport.interactionScale, activeTarget.holdProgress)
      directionText.text = activeTarget.label
      // 方向文字位于顶部预留区中线，不与左右两侧 HUD 抢占空间。
      directionText.position.set(viewport.centerX, Math.max(22, viewport.insets.top / 2))
      directionText.visible = snapshot.state === 'playing'
    }
    if (snapshot.state === 'countdown') {
      countdownText.text = String(Math.max(1, Math.ceil(snapshot.countdownRemainingMs / 1000)))
      countdownText.position.set(viewport.centerX, viewport.centerY)
      countdownText.visible = true
      target.visible = false
      targetProgress.visible = false
      directionText.visible = false
    } else {
      countdownText.visible = false
    }
    if (!activeTarget) {
      targetProgress.clear().visible = false
      directionText.visible = false
    }
  }

  /** 进度从目标圆顶部顺时针增长，完整时改画整圆避免圆弧端点缝隙。 */
  private redrawTargetProgress(graphic: Graphics, radius: number, progress: number): void {
    graphic.clear()
    if (progress <= 0 || radius <= 0) {
      graphic.visible = false
      return
    }
    if (progress >= 1) graphic.circle(0, 0, radius)
    else graphic.arc(0, 0, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress)
    graphic.stroke({ width: 9, color: '#68d391', alpha: 1 })
    graphic.visible = true
  }

  /** 仅在视口比例变化时重绘半径，避免 Pixi 每帧重复创建相同几何。 */
  private redrawViewportGeometry(interactionScale: number): void {
    if (!this.player || !this.target || this.renderedInteractionScale === interactionScale) return
    const playerRadiusPx = getPlayerRadiusPx(interactionScale, this.config.playerRadius)
    const targetRadiusPx = this.config.targetRadius * interactionScale
    this.player.clear().circle(0, 0, playerRadiusPx).fill('#68d391')
    this.target.clear().circle(0, 0, targetRadiusPx).stroke({ width: 5, color: '#4da3ff', alpha: 1 })
    this.renderedInteractionScale = interactionScale
  }

}
