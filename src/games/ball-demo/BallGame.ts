import { Application, Graphics } from 'pixi.js'
import type { GameInput } from '../../core/game-input/GameInput'

export class BallGame {
  private app: Application | null = null
  private latestInput: GameInput = {
    x: 0,
    y: 0,
    connected: false,
    calibrated: false,
    timestamp: 0,
  }

  async mount(container: HTMLElement): Promise<void> {
    const app = new Application()
    await app.init({
      resizeTo: container,
      antialias: true,
      background: '#08111f',
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    })
    container.appendChild(app.canvas)

    const crosshair = new Graphics()
      .moveTo(-28, 0)
      .lineTo(28, 0)
      .moveTo(0, -28)
      .lineTo(0, 28)
      .stroke({ width: 2, color: '#38506e', alpha: 0.8 })
    app.stage.addChild(crosshair)

    const ball = new Graphics().circle(0, 0, 24).fill('#68d391')
    app.stage.addChild(ball)

    app.ticker.add(() => {
      const centerX = app.screen.width / 2
      const centerY = app.screen.height / 2
      crosshair.position.set(centerX, centerY)

      const rangeX = Math.max(0, app.screen.width / 2 - 52)
      const rangeY = Math.max(0, app.screen.height / 2 - 52)
      ball.position.set(
        centerX + this.latestInput.x * rangeX,
        centerY - this.latestInput.y * rangeY,
      )
      ball.alpha = this.latestInput.connected ? 1 : 0.35
    })

    this.app = app
  }

  setInput(input: GameInput): void {
    this.latestInput = input
  }

  destroy(): void {
    this.app?.destroy(true, { children: true })
    this.app = null
  }
}
