import {
  createRiverDriftViewport, riverDriftBoatScale, riverDriftCenterAt, riverDriftPerspectiveScale,
  type RiverDriftGameConfig, type RiverDriftPoint, type RiverDriftSegment,
} from '@/shared/river'
import { drawSceneCountdown, drawSceneLabel, fillCircle, fillPolygon } from './SceneCanvas'
import { prepareCanvas, type CanvasSurface } from './WeChatCanvasSurface'

interface RiverScene {
  segments: readonly RiverDriftSegment[]
  coins: readonly (RiverDriftPoint & { radius: number; active: boolean })[]
  obstacles: readonly (RiverDriftPoint & { radius: number; active: boolean; obstacleType: string; hit: boolean })[]
  boat: RiverDriftPoint
  worldDistance: number
  countdown?: number
  label?: string
}

/** 用实际河岸和实体坐标绘制漂流，Canvas 不决定移动或碰撞。 */
export class RiverDriftCanvas {
  private readonly ctx: CanvasRenderingContext2D
  private readonly viewport
  private readonly water: CanvasGradient

  constructor(surface: CanvasSurface, private readonly config: Pick<RiverDriftGameConfig, 'riverWidthRatio'>) {
    this.ctx = prepareCanvas(surface)
    this.viewport = createRiverDriftViewport(surface.width, surface.height)
    this.water = this.ctx.createLinearGradient(0, 0, 0, surface.height)
    this.water.addColorStop(0, '#267c9e')
    this.water.addColorStop(1, '#52baca')
  }

  draw(scene: RiverScene, paintTrajectory?: (ctx: CanvasRenderingContext2D) => void): void {
    const { ctx, viewport: { width, height, scale } } = this
    ctx.fillStyle = '#337758'
    ctx.fillRect(0, 0, width, height)
    const left = [], right = []
    const halfWidth = this.config.riverWidthRatio * width / 2
    for (let index = 0; index <= 18; index += 1) {
      const y = index / 18
      const center = riverDriftCenterAt(scene.segments, y) * width
      left.push({ x: center - halfWidth, y: y * height })
      right.push({ x: center + halfWidth, y: y * height })
    }
    const banks = [...left, ...right.reverse()]
    ctx.beginPath()
    banks.forEach(({ x, y }, index) => index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y))
    ctx.closePath()
    ctx.strokeStyle = '#86d08a'
    ctx.lineWidth = 8
    ctx.stroke()
    ctx.fillStyle = this.water
    ctx.fill()

    // 水纹速度跟随有效世界距离，暂停时河面和小船一同停住。
    for (let index = 0; index < 13; index += 1) {
      const y = (index / 13 + scene.worldDistance) % 1
      const center = riverDriftCenterAt(scene.segments, y) * width
      const x = center + (index % 5 - 2) * halfWidth * 0.36
      const lineWidth = scale * (0.02 + y * 0.035)
      ctx.fillStyle = 'rgba(207, 249, 244, 0.35)'
      ctx.fillRect(x - lineWidth / 2, y * height, lineWidth, 1.6)
    }
    for (const segment of scene.segments) {
      const y = segment.y + segment.height * 0.5
      if (y < -0.05 || y > 1.05) continue
      const center = riverDriftCenterAt(scene.segments, y) * width
      const r = scale * (0.025 + Math.max(0, y) * 0.038)
      for (const side of [-1, 1]) {
        const x = center + side * (halfWidth + 13 + segment.decorationVariant)
        fillCircle(ctx, x, y * height + r * 0.25, r, '#235944')
        fillCircle(ctx, x - r * 0.23, y * height - r * 0.2, r * 0.78, '#6bad69')
      }
    }
    // 概览位于场景背景层，小船、金币及障碍保持可见。
    paintTrajectory?.(ctx)
    for (const coin of scene.coins) {
      if (!coin.active || coin.y < -0.1 || coin.y > 1.1) continue
      const r = scale * coin.radius * riverDriftPerspectiveScale(coin.y)
      fillCircle(ctx, coin.x * width, coin.y * height, r, '#e69e30')
      fillCircle(ctx, coin.x * width, coin.y * height, r * 0.68, '#ffe080')
    }
    for (const obstacle of scene.obstacles) {
      if (!obstacle.active || obstacle.y < -0.15 || obstacle.y > 1.15) continue
      const x = obstacle.x * width, y = obstacle.y * height
      const r = scale * obstacle.radius * riverDriftPerspectiveScale(obstacle.y)
      ctx.globalAlpha = obstacle.hit ? 0.5 : 1
      if (obstacle.obstacleType === 'crate') {
        ctx.fillStyle = '#8c5f43'
        ctx.fillRect(x - r, y - r, r * 2, r * 2)
        ctx.strokeStyle = '#e7ba79'
        ctx.strokeRect(x - r, y - r, r * 2, r * 2)
      } else {
        const color = obstacle.obstacleType === 'weed' ? '#3c6c3a' : obstacle.obstacleType === 'stump' ? '#8c5f43' : '#536777'
        fillCircle(ctx, x, y, r, color)
        fillCircle(ctx, x - r * 0.2, y - r * 0.25, r * 0.49, '#c5d3ab')
      }
      ctx.globalAlpha = 1
    }
    const x = scene.boat.x * width, y = scene.boat.y * height
    const r = Math.max(7, scale * 0.055 * riverDriftBoatScale(scene.boat.y))
    fillPolygon(ctx, [
      { x, y: y - r * 1.4 }, { x: x + r, y }, { x: x + r * 0.67, y: y + r },
      { x: x - r * 0.67, y: y + r }, { x: x - r, y },
    ], '#ff9662')
    fillCircle(ctx, x, y, r * 0.51, '#fff4d5')
    // 开场倒计时盖在场景上方，暂停和回放提示沿用顶部标签。
    if (scene.countdown !== undefined) drawSceneCountdown(ctx, scene.countdown, width, height)
    else if (scene.label) drawSceneLabel(ctx, scene.label, width)
  }
}
