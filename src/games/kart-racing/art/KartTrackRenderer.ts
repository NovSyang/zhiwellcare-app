import { Container, Graphics } from 'pixi.js'
import type { KartRacingViewport } from '../KartRacingViewport'
import type { KartTrackSegment } from '../KartRacingTrack'
import { kartTrackCenterOffset } from '../KartRacingTrack'
import { kartDepthToScreenY, kartRoadHalfWidthAtDepth } from './KartPerspective'
import { kartColors } from './KartVisualStyle'

/** 通过离散横条绘制弯曲道路、路肩、标线和固定终点。 */
export class KartTrackRenderer {
  private graphic = new Graphics({ label: 'kart-track' })

  constructor(parent: Container) {
    parent.addChild(this.graphic)
  }

  render(input: {
    viewport: KartRacingViewport
    track: readonly KartTrackSegment[]
    kartDistance: number
    trackLength: number
    visibleDistance: number
  }): void {
    const { viewport, track, kartDistance, trackLength, visibleDistance } = input
    const graphic = this.graphic.clear()
    const slices = 36
    for (let index = 0; index < slices; index += 1) {
      const farDepth = index / slices
      const nearDepth = (index + 1) / slices
      const farRelative = (1 - farDepth) * visibleDistance
      const nearRelative = (1 - nearDepth) * visibleDistance
      const far = roadEdge(viewport, track, kartDistance, farRelative, farDepth)
      const near = roadEdge(viewport, track, kartDistance, nearRelative, nearDepth)
      const stripe = Math.floor((kartDistance + nearRelative) / 12)
      const roadColor = stripe % 2 === 0 ? kartColors.road : kartColors.roadShade
      graphic.poly([far.left - far.curb, far.y, far.right + far.curb, far.y, near.right + near.curb, near.y, near.left - near.curb, near.y])
        .fill(stripe % 2 === 0 ? kartColors.curbWhite : kartColors.curbRed)
      graphic.poly([far.left, far.y, far.right, far.y, near.right, near.y, near.left, near.y]).fill(roadColor)
      // 稀疏中心线强化速度变化，但不干扰金币路线。
      if (stripe % 3 !== 1) {
        const farLine = Math.max(1, far.halfWidth * 0.018)
        const nearLine = Math.max(1, near.halfWidth * 0.018)
        graphic.poly([far.center - farLine, far.y, far.center + farLine, far.y, near.center + nearLine, near.y, near.center - nearLine, near.y])
          .fill({ color: kartColors.roadLine, alpha: 0.72 })
      }
    }
    this.drawFinishLine(graphic, viewport, track, kartDistance, trackLength, visibleDistance)
    this.drawGuardRails(graphic, viewport, track, kartDistance, visibleDistance)
  }

  destroy(): void {
    this.graphic.destroy()
  }

  private drawFinishLine(
    graphic: Graphics,
    viewport: KartRacingViewport,
    track: readonly KartTrackSegment[],
    kartDistance: number,
    trackLength: number,
    visibleDistance: number,
  ): void {
    const relative = trackLength - kartDistance
    if (relative < -5 || relative > visibleDistance) return
    const depth = Math.max(0, Math.min(1, 1 - Math.max(0, relative) / visibleDistance))
    const edge = roadEdge(viewport, track, kartDistance, Math.max(0, relative), depth)
    const height = Math.max(3, 5 + depth * 18)
    const cellWidth = edge.halfWidth * 2 / 10
    for (let row = 0; row < 2; row += 1) {
      for (let column = 0; column < 10; column += 1) {
        graphic.rect(edge.left + column * cellWidth, edge.y - height + row * height / 2, cellWidth + 1, height / 2 + 1)
          .fill((row + column) % 2 === 0 ? 0xffffff : 0x20262c)
      }
    }
    const postHeight = 25 + depth * 115
    graphic.rect(edge.left - 8, edge.y - postHeight, 8, postHeight).fill(0xffffff)
    graphic.rect(edge.right, edge.y - postHeight, 8, postHeight).fill(0xffffff)
    graphic.roundRect(edge.center - edge.halfWidth * 0.42, edge.y - postHeight - 18, edge.halfWidth * 0.84, 23, 7).fill(0x245f8e)
  }

  private drawGuardRails(
    graphic: Graphics,
    viewport: KartRacingViewport,
    track: readonly KartTrackSegment[],
    kartDistance: number,
    visibleDistance: number,
  ): void {
    for (let index = 2; index < 18; index += 2) {
      const depth = index / 18
      const relative = (1 - depth) * visibleDistance
      const edge = roadEdge(viewport, track, kartDistance, relative, depth)
      const height = 4 + depth * 22
      graphic.rect(edge.left - edge.curb - 3, edge.y - height, 4 + depth * 5, height).fill(0xf5f7f8)
      graphic.rect(edge.right + edge.curb - 1, edge.y - height, 4 + depth * 5, height).fill(0xf5f7f8)
    }
  }
}

function roadEdge(
  viewport: KartRacingViewport,
  track: readonly KartTrackSegment[],
  kartDistance: number,
  relative: number,
  depth: number,
): { center: number; halfWidth: number; curb: number; left: number; right: number; y: number } {
  const halfWidth = kartRoadHalfWidthAtDepth(depth, viewport)
  const center = viewport.width / 2 + kartTrackCenterOffset(track, kartDistance, relative) * halfWidth * (1 - depth * 0.35)
  return {
    center,
    halfWidth,
    curb: Math.max(2, halfWidth * 0.075),
    left: center - halfWidth,
    right: center + halfWidth,
    y: kartDepthToScreenY(depth, viewport),
  }
}
