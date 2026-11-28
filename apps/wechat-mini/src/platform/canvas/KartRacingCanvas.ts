import {
  createKartRacingViewport, projectKartEntity,
  type KartRacingGameConfig, type KartTrackSegment,
} from '@/shared/kart'
import { drawSceneCountdown, drawSceneLabel, fillCircle, fillPolygon } from './SceneCanvas'
import { prepareCanvas, type CanvasSurface } from './WeChatCanvasSurface'

interface RoadObject { distance: number; lateral: number; radius: number; active: boolean }
interface KartScene {
  track: readonly KartTrackSegment[]
  coins: readonly RoadObject[]
  obstacles: readonly (RoadObject & { obstacleType: string; hit: boolean })[]
  items: readonly (RoadObject & { itemType: string })[]
  kart: { lateral: number; distance: number }
  shieldActive: boolean
  boostActive: boolean
  countdown?: number
  label?: string
}

/** 从世界距离和横向位置投影出弯道、道具和车辆。 */
export class KartRacingCanvas {
  private readonly ctx: CanvasRenderingContext2D
  private readonly viewport
  private readonly sky: CanvasGradient

  constructor(surface: CanvasSurface, private readonly config: Pick<KartRacingGameConfig, 'trackLength' | 'spawnLookAheadDistance'>) {
    this.ctx = prepareCanvas(surface)
    this.viewport = createKartRacingViewport(surface.width, surface.height)
    this.sky = this.ctx.createLinearGradient(0, 0, 0, this.viewport.horizonY)
    this.sky.addColorStop(0, '#5fb8df')
    this.sky.addColorStop(1, '#d5f3f6')
  }

  draw(scene: KartScene, paintTrajectory?: (ctx: CanvasRenderingContext2D) => void): void {
    const { ctx, viewport } = this
    const { width, height, horizonY, roadBottomY, scale } = viewport
    ctx.fillStyle = '#5a984f'
    ctx.fillRect(0, 0, width, height)
    ctx.fillStyle = this.sky
    ctx.fillRect(0, 0, width, horizonY)
    fillPolygon(ctx, [
      { x: 0, y: horizonY }, { x: width * 0.15, y: horizonY * 0.58 },
      { x: width * 0.4, y: horizonY }, { x: width * 0.81, y: horizonY * 0.47 },
      { x: width, y: horizonY * 0.79 }, { x: width, y: horizonY },
    ], '#77a98e')

    const centerDistance = scene.kart.distance
    const limit = this.config.spawnLookAheadDistance
    const project = (distance: number, lateral = 0) => projectKartEntity({
      viewport, track: scene.track, kartDistance: centerDistance,
      entityDistance: distance, entityLateral: lateral, visibleDistance: limit,
    })
    const near = project(centerDistance)
    const nearEdge = near.roadHalfWidth
    const bottomHalf = Math.min(width * 0.49, nearEdge * 1.06)
    fillPolygon(ctx, [
      { x: near.screenX - nearEdge, y: near.screenY }, { x: near.screenX + nearEdge, y: near.screenY },
      { x: near.screenX + bottomHalf, y: roadBottomY }, { x: near.screenX - bottomHalf, y: roadBottomY },
    ], '#38485b')
    // 条纹按照固定赛道距离铺设，车辆加减速时自然改变滚动速度。
    // 留出浮点误差余量，确保最远端仍在投影可见范围。
    let far = project(centerDistance + limit - 0.0001)
    const stride = 5
    let band = Math.floor((centerDistance + limit) / stride)
    for (; band * stride > centerDistance; band -= 1) {
      const close = project(band * stride)
      this.roadBand(far, close, band)
      far = close
    }
    this.roadBand(far, near, band)

    const finish = project(this.config.trackLength)
    if (finish.visible) {
      const cell = finish.roadHalfWidth / 5
      const rowHeight = 2 + finish.scale * 4
      for (let row = 0; row < 2; row += 1) {
        for (let col = 0; col < 10; col += 1) {
          ctx.fillStyle = (row + col) % 2 ? '#273647' : '#fff9e8'
          ctx.fillRect(finish.screenX - finish.roadHalfWidth + col * cell, finish.screenY - row * rowHeight, cell, rowHeight)
        }
      }
    }
    // 赛道提示之后绘制概览，车辆及各类道具仍位于上层。
    paintTrajectory?.(ctx)
    // 先绘制远处物体，近处物体自然盖在前面。
    const objects = [
      ...scene.coins.filter(({ active }) => active).map((item) => ({ ...item, kind: 'coin', hit: false })),
      ...scene.obstacles.filter(({ active }) => active).map((item) => ({ ...item, kind: item.obstacleType })),
      ...scene.items.filter(({ active }) => active).map((item) => ({ ...item, kind: item.itemType, hit: false })),
    ].sort((a, b) => b.distance - a.distance)
    for (const object of objects) {
      const point = project(object.distance, object.lateral)
      if (!point.visible) continue
      const r = Math.max(2, object.radius * point.roadHalfWidth * 0.84)
      this.drawObject(point.screenX, point.screenY, r, object.kind, object.hit)
    }
    const player = project(centerDistance, scene.kart.lateral)
    const x = player.screenX, y = player.screenY
    const r = scale * 0.047
    if (scene.boostActive) {
      fillPolygon(ctx, [{ x: x - r * 0.7, y }, { x: x + r * 0.7, y }, { x, y: y + r * 2.1 }], '#ffab45')
    }
    ctx.fillStyle = '#172e3d'
    ctx.fillRect(x - r * 1.18, y - r * 0.3, r * 0.65, r * 1.02)
    ctx.fillRect(x + r * 0.53, y - r * 0.3, r * 0.65, r * 1.02)
    fillPolygon(ctx, [
      { x: x - r * 0.64, y: y - r }, { x: x + r * 0.64, y: y - r },
      { x: x + r, y: y + r * 0.58 }, { x: x - r, y: y + r * 0.58 },
    ], '#ed5345')
    ctx.fillStyle = '#fff4d8'
    ctx.fillRect(x - r * 0.42, y - r * 0.7, r * 0.84, r * 0.62)
    if (scene.shieldActive) {
      ctx.beginPath()
      ctx.arc(x, y, r * 1.55, 0, Math.PI * 2)
      ctx.strokeStyle = '#7febff'
      ctx.lineWidth = 2
      ctx.stroke()
    }
    // 开场倒计时盖在场景上方，暂停和回放提示沿用顶部标签。
    if (scene.countdown !== undefined) drawSceneCountdown(ctx, scene.countdown, width, height)
    else if (scene.label) drawSceneLabel(ctx, scene.label, width)
  }

  private roadBand(far: ReturnType<typeof projectKartEntity>, near: ReturnType<typeof projectKartEntity>, band: number): void {
    const quad = (from: number, to: number, color: string) => fillPolygon(this.ctx, [
      { x: far.screenX + far.roadHalfWidth * from, y: far.screenY },
      { x: far.screenX + far.roadHalfWidth * to, y: far.screenY },
      { x: near.screenX + near.roadHalfWidth * to, y: near.screenY },
      { x: near.screenX + near.roadHalfWidth * from, y: near.screenY },
    ], color)
    quad(-1.07, 1.07, band % 2 ? '#ee715b' : '#fff1cc')
    quad(-1, 1, band % 2 ? '#39495d' : '#435467')
    if (band % 3 === 0) quad(-0.019, 0.019, '#f7e8c4')
  }

  private drawObject(x: number, y: number, r: number, kind: string, hit: boolean): void {
    const ctx = this.ctx
    ctx.globalAlpha = hit ? 0.5 : 1
    if (kind === 'coin') {
      fillCircle(ctx, x, y, r, '#efa634')
      fillCircle(ctx, x, y, r * 0.67, '#ffe489')
    } else if (kind === 'cone') {
      fillPolygon(ctx, [{ x, y: y - r * 1.6 }, { x: x + r, y: y + r * 0.5 }, { x: x - r, y: y + r * 0.5 }], '#ff8e52')
    } else if (kind === 'shield' || kind === 'boost') {
      const color = kind === 'shield' ? '#67dfff' : '#ffbd52'
      fillPolygon(ctx, [{ x, y: y - r }, { x: x + r, y }, { x, y: y + r }, { x: x - r, y }], color)
      fillCircle(ctx, x, y, r * 0.28, '#fffef2')
    } else {
      ctx.fillStyle = kind === 'puddle' ? '#639eb7' : '#1f2c37'
      ctx.fillRect(x - r, y - r * 0.47, r * 2, r * 0.94)
    }
    ctx.globalAlpha = 1
  }
}
