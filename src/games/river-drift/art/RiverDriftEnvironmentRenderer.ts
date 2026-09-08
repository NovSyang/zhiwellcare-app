import { Container, FillGradient, Graphics } from 'pixi.js'
import type { RiverDriftGameConfig } from '../RiverDriftGameConfig'
import type { RiverDriftViewport } from '../RiverDriftViewport'
import { riverDriftToScreen } from '../RiverDriftViewport'
import type { RiverDriftSegment } from '../RiverDriftWorld'
import { riverDriftEnvironmentScale, riverDriftPerspectiveScale } from './RiverDriftPerspective'
import { riverDriftColors } from './RiverDriftVisualStyle'

interface DecorationView {
  root: Container
  left: Container
  right: Container
}

/** 绘制河水、河岸、水纹和循环装饰，物理河道边界保持不变。 */
export class RiverDriftEnvironmentRenderer {
  readonly background = new Graphics({ label: 'river-background' })
  readonly waterLines = new Graphics({ label: 'river-water-lines' })
  readonly decorations = new Container({ label: 'river-decorations' })
  private readonly segmentViews: DecorationView[]
  private readonly grassGradient = new FillGradient({
    type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, textureSpace: 'local',
    colorStops: [{ offset: 0, color: riverDriftColors.grassTop }, { offset: 1, color: riverDriftColors.grassBottom }],
  })
  private readonly waterGradient = new FillGradient({
    type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, textureSpace: 'local',
    colorStops: [{ offset: 0, color: riverDriftColors.waterTop }, { offset: 1, color: riverDriftColors.waterBottom }],
  })

  constructor(private readonly config: RiverDriftGameConfig) {
    this.segmentViews = Array.from({ length: config.riverSegmentCount }, (_, index) => createDecorationView(index))
    this.segmentViews.forEach((view) => this.decorations.addChild(view.root))
  }

  render(viewport: RiverDriftViewport, segments: readonly RiverDriftSegment[], elapsedMs: number): void {
    this.drawRiver(viewport, segments)
    this.drawWaterLines(viewport, segments, elapsedMs)
    this.drawDecorations(viewport, segments)
  }

  destroy(): void {
    this.grassGradient.destroy()
    this.waterGradient.destroy()
  }

  private drawRiver(viewport: RiverDriftViewport, segments: readonly RiverDriftSegment[]): void {
    const left: Array<{ x: number; y: number }> = []
    const right: Array<{ x: number; y: number }> = []
    for (let index = 0; index <= 28; index += 1) {
      const y = index / 28
      const center = riverDriftCenterAt(segments, y)
      left.push(riverDriftToScreen({ x: center - this.config.riverWidthRatio / 2, y }, viewport))
      right.push(riverDriftToScreen({ x: center + this.config.riverWidthRatio / 2, y }, viewport))
    }
    const riverShape = [...left, ...[...right].reverse()]
    this.background.clear().rect(0, 0, viewport.width, viewport.height).fill(this.grassGradient)
    this.background.poly(flatten(riverShape)).fill(this.waterGradient)

    // 浅水带位于视觉边缘内侧，不会改变可航行区域或碰撞范围。
    const shallowWidth = Math.max(8, viewport.width * 0.018)
    const leftShallow = [...left.map((point) => ({ x: point.x - shallowWidth, y: point.y })), ...[...left].reverse()]
    const rightShallow = [...right, ...[...right].reverse().map((point) => ({ x: point.x + shallowWidth, y: point.y }))]
    this.background.poly(flatten(leftShallow)).fill({ color: riverDriftColors.shallowWater, alpha: 0.72 })
    this.background.poly(flatten(rightShallow)).fill({ color: riverDriftColors.shallowWater, alpha: 0.72 })
    this.background.poly(flatten(left)).stroke({ width: 8, color: riverDriftColors.bankDark, alpha: 0.72 })
    this.background.poly(flatten(right)).stroke({ width: 8, color: riverDriftColors.bankDark, alpha: 0.72 })
    this.background.poly(flatten(left.map((point) => ({ x: point.x - 5, y: point.y }))))
      .stroke({ width: 4, color: riverDriftColors.grassHighlight, alpha: 0.9 })
    this.background.poly(flatten(right.map((point) => ({ x: point.x + 5, y: point.y }))))
      .stroke({ width: 4, color: riverDriftColors.grassHighlight, alpha: 0.9 })
  }

  private drawWaterLines(viewport: RiverDriftViewport, segments: readonly RiverDriftSegment[], elapsedMs: number): void {
    this.waterLines.clear()
    for (let index = 0; index < 12; index += 1) {
      const y = ((index / 12 + elapsedMs / 8_000) % 1.12) - 0.06
      const center = riverDriftCenterAt(segments, y)
      const point = riverDriftToScreen({ x: center + (index % 3 - 1) * 0.09, y }, viewport)
      const perspective = riverDriftPerspectiveScale(y)
      const halfLength = viewport.scale * 0.032 * perspective
      this.waterLines.moveTo(point.x - halfLength, point.y)
        .bezierCurveTo(point.x - halfLength * 0.3, point.y - 3, point.x + halfLength * 0.3, point.y + 3, point.x + halfLength, point.y)
        .stroke({ width: 1.4 * perspective, color: riverDriftColors.waterHighlight, alpha: 0.28 + Math.max(0, y) * 0.24 })
    }
  }

  private drawDecorations(viewport: RiverDriftViewport, segments: readonly RiverDriftSegment[]): void {
    for (let index = 0; index < this.segmentViews.length; index += 1) {
      const view = this.segmentViews[index]
      const segment = segments[index]
      if (!segment) { view.root.visible = false; continue }
      const y = segment.y + segment.height / 2
      view.root.visible = segment.y + segment.height >= -0.1 && segment.y <= 1.1
      const center = riverDriftToScreen({ x: segment.endCenterX, y }, viewport)
      const scale = Math.max(0.55, viewport.scale / 720) * riverDriftEnvironmentScale(y)
      const bankOffset = this.config.riverWidthRatio * viewport.width / 2 / scale + 32
      view.root.position.set(center.x, center.y)
      view.root.scale.set(scale)
      view.left.position.x = -bankOffset
      view.right.position.x = bankOffset
      view.root.rotation = (segment.decorationVariant - 2) * 0.018
    }
  }
}

/** 河流与回放共用相同的中心线插值规则。 */
export function riverDriftCenterAt(segments: readonly RiverDriftSegment[], y: number): number {
  const sorted = [...segments].sort((first, second) => first.y - second.y)
  if (sorted.length === 0) return 0.5
  const segment = sorted.find((item) => y >= item.y && y <= item.y + item.height)
    ?? (y < sorted[0].y ? sorted[0] : sorted.at(-1)!)
  const ratio = Math.max(0, Math.min(1, (y - segment.y) / Math.max(0.001, segment.height)))
  return segment.startCenterX + (segment.endCenterX - segment.startCenterX) * ratio
}

function flatten(points: readonly { x: number; y: number }[]): number[] {
  return points.flatMap((point) => [point.x, point.y])
}

function createDecorationView(index: number): DecorationView {
  const root = new Container({ label: `decoration-${index}` })
  const left = createBankCluster(index, false)
  const right = createBankCluster(index + 2, true)
  root.addChild(left, right)
  return { root, left, right }
}

function createBankCluster(variant: number, mirrored: boolean): Container {
  const root = new Container({ label: mirrored ? 'right-bank-cluster' : 'left-bank-cluster' })
  const shadow = new Graphics().ellipse(4, 18, 34, 10).fill({ color: riverDriftColors.shadow, alpha: 0.14 })
  const bush = new Graphics()
    .circle(-16, 2, 16).circle(4, -8, 21).circle(22, 5, 15)
    .fill(variant % 2 ? 0x4f9955 : 0x5aaa5d)
    .circle(-12, -4, 8).circle(2, -15, 10).fill({ color: 0x9ad276, alpha: 0.8 })
  const flowers = new Graphics()
    .circle(-18, 0, 3).circle(16, -4, 3).fill(variant % 3 ? 0xffd86d : 0xf6a9bd)
  root.addChild(shadow, bush, flowers)
  if (mirrored) root.scale.x = -1
  return root
}
