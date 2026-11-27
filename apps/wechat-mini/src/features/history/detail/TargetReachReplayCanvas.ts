import type Taro from '@tarojs/taro'
import { downsampleForDisplay, sampleAtElapsed, type TrainingReplay } from '@/shared/core'
import { createTargetReachReplayGeometry, resolveTargetReachGameConfig, TargetReachReplayTimeline } from '@/shared/target-replay'
import { normalizedToScreen } from '@/shared/target-viewport'
import { prepareCanvas, type CanvasSurface } from '../../../platform/canvas/WeChatCanvasSurface'

export class TargetReachReplayCanvas {
  readonly node: Taro.Canvas
  private readonly context: CanvasRenderingContext2D
  private readonly geometry: ReturnType<typeof createTargetReachReplayGeometry>
  private readonly timeline: TargetReachReplayTimeline
  private readonly path

  constructor(surface: CanvasSurface, private readonly replay: TrainingReplay, config: unknown) {
    this.node = surface.node
    // 与实时训练共用原生 Canvas 的尺寸和像素比规则。
    this.context = prepareCanvas(surface)
    this.geometry = createTargetReachReplayGeometry(surface.width, surface.height, resolveTargetReachGameConfig(config))
    this.timeline = new TargetReachReplayTimeline(replay.events)
    this.path = downsampleForDisplay(replay.samples)
  }

  /** 根据已有轨迹和事实事件绘制回放，每帧不执行训练命中判定。 */
  draw(elapsed: number, trajectory: boolean): void {
    const ctx = this.context
    const { viewport, playerRadiusPx, targetRadiusPx } = this.geometry
    ctx.fillStyle = '#08111f'
    ctx.fillRect(0, 0, viewport.width, viewport.height)
    ctx.lineWidth = 2
    ctx.strokeStyle = '#91a3ba'
    ctx.beginPath()
    ctx.arc(viewport.centerX, viewport.centerY, 6, 0, 2 * Math.PI)
    ctx.stroke()

    const current = this.timeline.targetAt(elapsed)
    const targets = trajectory ? this.timeline.allTargets() : current ? [current] : []
    const from = this.timeline.currentTargetStartedAt(elapsed)
    const path = trajectory ? this.path : this.path.filter(({ elapsedMs }) => elapsedMs >= from && elapsedMs <= elapsed)
    ctx.beginPath()
    path.forEach((sample, index) => {
      const point = normalizedToScreen(sample, viewport)
      if (index === 0) ctx.moveTo(point.x, point.y)
      else ctx.lineTo(point.x, point.y)
    })
    ctx.strokeStyle = '#8fd8ff'
    ctx.stroke()
    for (const target of targets) {
      const point = normalizedToScreen(target, viewport)
      ctx.beginPath()
      ctx.arc(point.x, point.y, targetRadiusPx, 0, 2 * Math.PI)
      ctx.strokeStyle = target.outcome === 'success' ? '#68d391' : target.outcome === 'failed' ? '#fc8181' : '#4da3ff'
      ctx.stroke()
    }
    const sample = trajectory ? null : sampleAtElapsed(this.replay.samples, elapsed)
    if (sample) {
      const point = normalizedToScreen(sample, viewport)
      ctx.beginPath()
      ctx.arc(point.x, point.y, playerRadiusPx, 0, 2 * Math.PI)
      ctx.fillStyle = '#68d391'
      ctx.fill()
    }
  }
}
