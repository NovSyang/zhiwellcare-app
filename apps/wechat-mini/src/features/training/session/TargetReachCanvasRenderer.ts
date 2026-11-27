import type { TargetReachFrame } from '@/shared/target-controller'
import type { TargetReachGameConfig } from '@/shared/target-config'
import { createTargetReachViewport, getPlayerRadiusPx, normalizedToScreen } from '@/shared/target-viewport'
import { prepareCanvas, type CanvasSurface } from '../../../platform/canvas/WeChatCanvasSurface'

/** 微信实时训练画布只消费共享控制器的快照。 */
export class TargetReachCanvasRenderer {
  private readonly context: CanvasRenderingContext2D
  private readonly viewport
  constructor(surface: CanvasSurface, private readonly config: TargetReachGameConfig) {
    this.context = prepareCanvas(surface)
    // 指令在上方单独占位，剩余区域保持四个方向的同一空间比例。
    this.viewport = createTargetReachViewport(surface.width, surface.height, { top: 46, right: 16, bottom: 16, left: 16 })
  }

  draw(frame: TargetReachFrame): void {
    const { context: ctx, viewport } = this
    const { state, countdownRemainingMs } = frame.session
    ctx.fillStyle = '#08111f'
    ctx.fillRect(0, 0, viewport.width, viewport.height)

    ctx.beginPath()
    ctx.arc(viewport.centerX, viewport.centerY, 6, 0, Math.PI * 2)
    ctx.lineWidth = 1.5
    ctx.strokeStyle = '#657a93'
    ctx.stroke()

    if (frame.target && (state === 'playing' || state === 'paused')) {
      const target = normalizedToScreen(frame.target, viewport)
      const radius = this.config.targetRadius * viewport.interactionScale
      ctx.beginPath()
      ctx.arc(target.x, target.y, radius, 0, Math.PI * 2)
      ctx.lineWidth = 3
      ctx.strokeStyle = '#4da3ff'
      ctx.stroke()
      if (frame.target.holdProgress > 0) {
        ctx.beginPath()
        ctx.arc(target.x, target.y, radius, -Math.PI / 2, Math.PI * 2 * frame.target.holdProgress - Math.PI / 2)
        ctx.lineWidth = 5
        ctx.strokeStyle = '#68d391'
        ctx.stroke()
      }
      if (state === 'playing') this.label(frame.target.label, 22, 18, '#8fd8ff')
    }

    const player = normalizedToScreen(frame.input, viewport)
    ctx.beginPath()
    ctx.arc(player.x, player.y, getPlayerRadiusPx(viewport.interactionScale, this.config.playerRadius), 0, Math.PI * 2)
    ctx.fillStyle = frame.input.connected && frame.input.calibrated ? '#68d391' : '#61788a'
    ctx.fill()

    if (state === 'countdown') this.label(String(Math.max(1, Math.ceil(countdownRemainingMs / 1000))), 45, viewport.centerY - 40, '#ffffff')
    else if (state === 'paused') this.label('训练已暂停', 22, 18, '#f4c368')
  }

  private label(text: string, size: number, y: number, color: string): void {
    this.context.font = `bold ${size}px sans-serif`
    this.context.textAlign = 'center'
    this.context.textBaseline = 'middle'
    this.context.fillStyle = color
    this.context.fillText(text, this.viewport.centerX, y)
  }
}
