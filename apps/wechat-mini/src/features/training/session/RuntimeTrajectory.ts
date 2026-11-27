import type { ReplaySample } from '../../../../../../src/core/replay/TrainingReplay'
import type { SceneOverviewPoint } from '../../../platform/canvas/SceneOverviewProjection'

export type RuntimeTrajectoryMode = 'tail' | 'full'

export interface RuntimeTrajectorySnapshot {
  mode: RuntimeTrajectoryMode
  currentPoint: Readonly<{ x: number; y: number }> | null
  totalPointCount: number
  visit: (draw: (x: number, y: number, segment: number) => void) => void
}

type Point = ReplaySample & { segment: number }
const DISPLAY_POINT_LIMIT = 520
const DEFAULT_TAIL_MS = 4000

/** 缓存只服务实时显示，二维点来自 recorder，场景点已经投影为概览坐标。 */
export class RuntimeTrajectory {
  private readonly points: Point[] = []
  private segment = 0
  private needsBreak = false
  private lastSceneDistance?: number

  breakSegment() { this.needsBreak = true }

  appendInput(sample: ReplaySample) {
    const previous = this.points[this.points.length - 1]
    if (previous) {
      const jump = Math.hypot(sample.x - previous.x, sample.y - previous.y)
      const touchesZero = (sample.x === 0 && sample.y === 0) || (previous.x === 0 && previous.y === 0)
      // 进入或离开异常归零，以及接近跨屏的位置跳变时另起一段。
      if (jump >= 1.3 || (touchesZero && jump >= 0.5)) this.breakSegment()
    }
    this.append(sample.elapsedMs, sample.x, sample.y)
  }

  appendScene(elapsedMs: number, point: SceneOverviewPoint, distance: number) {
    if (!Number.isFinite(distance) || distance < 0) { this.breakSegment(); return }
    // 世界或赛道距离回退时保留此前路径，防止回到起点时画出跨图直线。
    if (this.lastSceneDistance !== undefined && distance < this.lastSceneDistance) this.breakSegment()
    this.lastSceneDistance = distance
    this.append(elapsedMs, point.lateralRatio, point.progressRatio)
  }

  snapshot(mode: RuntimeTrajectoryMode, elapsedMs: number, tailMs = DEFAULT_TAIL_MS): RuntimeTrajectorySnapshot {
    const points = this.points
    const totalPointCount = points.length
    const start = mode === 'tail' ? this.firstAtOrAfter(elapsedMs - tailMs) : 0
    const count = totalPointCount - start
    const visibleCount = Math.min(count, DISPLAY_POINT_LIMIT)
    const last = points[totalPointCount - 1]
    const currentPoint = last ? { x: last.x, y: last.y } : null
    return {
      mode,
      currentPoint,
      totalPointCount,
      // 直接按索引做与回放相同的均匀降采样，保留首尾，无需切片或暴露原数组。
      visit: (draw) => {
        const step = visibleCount > 1 ? (count - 1) / (visibleCount - 1) : 1
        for (let index = 0; index < visibleCount; index += 1) {
          const { x, y, segment } = points[start + Math.round(index * step)]
          draw(x, y, segment)
        }
      },
    }
  }

  private append(elapsedMs: number, x: number, y: number) {
    if (!Number.isFinite(elapsedMs) || !Number.isFinite(x) || !Number.isFinite(y)) { this.breakSegment(); return }
    const last = this.points[this.points.length - 1]
    if (last && elapsedMs < last.elapsedMs) { this.breakSegment(); return }
    if (last?.elapsedMs === elapsedMs && !this.needsBreak) return
    if (this.needsBreak || (last && elapsedMs - last.elapsedMs > 250)) this.segment += 1
    this.needsBreak = false
    this.points.push({ elapsedMs, x, y, segment: this.segment })
  }

  private firstAtOrAfter(elapsedMs: number) {
    let low = 0
    let high = this.points.length
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (this.points[middle].elapsedMs < elapsedMs) low = middle + 1
      else high = middle
    }
    return low
  }
}
