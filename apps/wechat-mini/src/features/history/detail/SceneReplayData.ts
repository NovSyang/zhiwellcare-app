import { downsampleForDisplay, type ReplayEvent, type TrainingReplay } from '@/shared/core'
import type { CanvasSurface } from '../../../platform/canvas/WeChatCanvasSurface'
import { drawSceneLabel, fillCircle } from '../../../platform/canvas/SceneCanvas'
import type { SceneOverviewPoint } from '../../../platform/canvas/SceneOverviewProjection'

interface Pose { elapsedMs: number; x: number; y: number; distance: number; flags: number }

/** 在已保存的位姿间插值，动态回放无需再次步进物理或碰撞。 */
export class SceneReplayData {
  readonly poses: readonly Pose[]

  constructor(replay: TrainingReplay, type: 'river-scene' | 'kart-scene') {
    const event = replay.events.find((item) => item.type === type)
    const payload = event?.payload as { version?: unknown; poses?: unknown } | undefined
    const rows = payload?.version === 1 && Array.isArray(payload.poses) ? payload.poses : []
    const poses: Pose[] = []
    for (const row of rows) {
      if (!Array.isArray(row)) continue
      const [elapsedMs, x, y, distance, flags = 0] = row as unknown[]
      if (finite(elapsedMs) && elapsedMs >= 0 && elapsedMs <= replay.durationMs && finite(x) && finite(y)
        && finite(distance) && distance >= 0 && finite(flags)) {
        if (poses.length && poses[poses.length - 1].elapsedMs >= elapsedMs) continue
        poses.push({ elapsedMs, x, y, distance, flags })
      }
    }
    if (!poses.length) throw new Error('这条记录缺少训练时保存的场景轨迹。')
    this.poses = poses
  }

  at(elapsedMs: number): Pose {
    let low = 0
    let high = this.poses.length - 1
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (this.poses[middle].elapsedMs <= elapsedMs) low = middle
      else high = middle - 1
    }
    const before = this.poses[low]
    const after = this.poses[low + 1]
    if (!after || elapsedMs <= before.elapsedMs) return before
    const ratio = (elapsedMs - before.elapsedMs) / (after.elapsedMs - before.elapsedMs)
    return {
      elapsedMs,
      x: before.x + (after.x - before.x) * ratio,
      y: before.y + (after.y - before.y) * ratio,
      distance: before.distance + (after.distance - before.distance) * ratio,
      flags: before.flags,
    }
  }
}

/** 每个实体 ID 在一局唯一，预先索引事件，避免每帧重复遍历全部记录。 */
export function eventTimes(events: readonly ReplayEvent[], type: string): Map<string, number> {
  const times = new Map<string, number>()
  for (const event of events) {
    if (event.type !== type) continue
    const payload = event.payload as { id?: unknown } | undefined
    if (typeof payload?.id === 'string') times.set(payload.id, event.elapsedMs)
  }
  return times
}

export function readPositiveConfig(config: unknown, key: string, fallback: number): number {
  const value = config && typeof config === 'object' ? (config as Record<string, unknown>)[key] : undefined
  return finite(value) && value > 0 ? value : fallback
}

/** 横轴为转向位置，纵轴为有效时间或赛道进度，红点标记碰撞。 */
export function drawSceneOverview(
  surface: CanvasSurface, track: readonly SceneOverviewPoint[],
  hits: readonly SceneOverviewPoint[], caption: string,
): void {
  const ctx = surface.node.getContext('2d') as CanvasRenderingContext2D
  const { width, height } = surface
  const margin = 18, top = 51
  const x = (ratio: number) => margin + ratio * (width - 2 * margin)
  const y = (ratio: number) => top + ratio * Math.max(1, height - top - margin)
  ctx.fillStyle = '#e8f2e9'
  ctx.fillRect(0, 0, width, height)
  drawSceneLabel(ctx, caption, width)
  ctx.strokeStyle = '#a9cbb8'
  ctx.lineWidth = 1
  ctx.strokeRect(margin, top, width - 2 * margin, Math.max(1, height - top - margin))
  ctx.beginPath()
  downsampleForDisplay(track, 700).forEach((point, index) => {
    if (index === 0) ctx.moveTo(x(point.lateralRatio), y(point.progressRatio))
    else ctx.lineTo(x(point.lateralRatio), y(point.progressRatio))
  })
  ctx.strokeStyle = '#22799d'
  ctx.lineWidth = 2.5
  ctx.stroke()
  for (const hit of hits) fillCircle(ctx, x(hit.lateralRatio), y(hit.progressRatio), 3, '#d5504d')
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
