import { downsampleForDisplay } from '@/shared/core'
import { prepareCanvas, type CanvasSurface } from './WeChatCanvasSurface'

type Point = { x: number; y: number }

interface TrajectoryScene {
  reference: readonly Point[]
  trail: readonly Point[]
  player: Point | null
  guide: Point | null
  tolerance?: number
  label?: string
}

/** 训练和回放使用相同的正方形坐标比例，容差圈对应实际评分范围。 */
export class TrajectoryFollowCanvas {
  readonly node: CanvasSurface['node']
  private readonly context: CanvasRenderingContext2D
  private readonly scale: number
  private reference: readonly Point[] | null = null
  private displayReference: readonly Point[] = []

  constructor(private readonly surface: CanvasSurface) {
    this.node = surface.node
    this.context = prepareCanvas(surface)
    this.scale = Math.max(1, Math.min(surface.width, surface.height) / 2 - 28)
  }

  draw(scene: TrajectoryScene): void {
    const { context: ctx, surface } = this
    ctx.fillStyle = '#08111f'
    ctx.fillRect(0, 0, surface.width, surface.height)
    if (scene.reference !== this.reference) {
      // 仅在参考路径改变时准备绘制点，完整样本仍在训练记录和回放中保留。
      this.reference = scene.reference
      this.displayReference = downsampleForDisplay(scene.reference, 241)
    }
    this.line(this.displayReference, '#55799e', 2)
    this.line(scene.trail, '#68d391', 3)
    if (scene.guide) {
      if (scene.tolerance) this.dot(scene.guide, scene.tolerance * this.scale, '#4da3ff', true)
      this.dot(scene.guide, 4, '#8fd8ff', false)
    }
    if (scene.player) this.dot(scene.player, 6, '#aeef8f', false)
    if (scene.label) {
      ctx.font = 'bold 20px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#f4c368'
      ctx.fillText(scene.label, surface.width / 2, 24)
    }
  }

  private line(points: readonly Point[], color: string, width: number): void {
    if (points.length < 2) return
    const ctx = this.context
    ctx.beginPath()
    points.forEach((point, index) => {
      const [x, y] = this.toCanvas(point)
      if (index === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.lineWidth = width
    ctx.strokeStyle = color
    ctx.stroke()
  }

  private dot(point: Point, radius: number, color: string, outline: boolean): void {
    const ctx = this.context
    const [x, y] = this.toCanvas(point)
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, 2 * Math.PI)
    if (outline) {
      ctx.lineWidth = 2
      ctx.strokeStyle = color
      ctx.stroke()
    } else {
      ctx.fillStyle = color
      ctx.fill()
    }
  }

  private toCanvas(point: Point): [number, number] {
    return [this.surface.width / 2 + this.scale * point.x, this.surface.height / 2 - this.scale * point.y]
  }
}
