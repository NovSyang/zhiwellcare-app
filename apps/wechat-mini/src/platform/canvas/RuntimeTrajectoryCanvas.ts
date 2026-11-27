import type { RuntimeTrajectorySnapshot } from '../../features/training/session/RuntimeTrajectory'
import { fillCircle, type CanvasPoint } from './SceneCanvas'

/** 每次挂载独立隔离轨迹层。绘制失败只关闭轨迹，不影响主体画面。 */
export function protectTrajectoryLayer<Args extends unknown[]>(
  paint: (ctx: CanvasRenderingContext2D, ...args: Args) => void,
) {
  let disabled = false
  return (ctx: CanvasRenderingContext2D, ...args: Args) => {
    if (disabled) return
    try {
      ctx.save()
      try { paint(ctx, ...args) }
      finally { ctx.restore() }
    } catch { disabled = true }
  }
}

/** 单次笔画包含多个独立段；降采样后也不会把不同段重新连起来。 */
export function strokeRuntimeTrajectory(
  ctx: CanvasRenderingContext2D, snapshot: RuntimeTrajectorySnapshot,
  project: (x: number, y: number) => CanvasPoint, color: string, width: number,
) {
  if (snapshot.totalPointCount < 2) return
  let previousSegment: number | undefined
  ctx.beginPath()
  snapshot.visit((x, y, segment) => {
    const point = project(x, y)
    if (previousSegment !== segment) ctx.moveTo(point.x, point.y)
    else ctx.lineTo(point.x, point.y)
    previousSegment = segment
  })
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.stroke()
}

/** 小窗放在底部边角，场景角色、障碍和道具随后绘制。 */
export function drawRuntimeSceneOverview(
  ctx: CanvasRenderingContext2D, snapshot: RuntimeTrajectorySnapshot,
  bounds: { left: number; top: number; width: number; height: number }, title: string,
) {
  // 与路径使用同一份最后有效位姿，暂停时标记不会跳回或继续移动。
  const current = snapshot.currentPoint
  if (!current) return
  const { left, top, width, height } = bounds
  const plotLeft = left + 7, plotTop = top + 19, plotWidth = width - 14, plotHeight = height - 26
  let from = 0, to = 1
  if (snapshot.mode === 'tail') {
    // 最近几秒在全程比例下可能只有几像素，放大当前区间仍使用同一投影。
    let min = current.y, max = current.y
    snapshot.visit((_, progress) => { min = Math.min(min, progress); max = Math.max(max, progress) })
    from = Math.max(0, Math.min(min, max - 0.08))
    to = Math.min(1, Math.max(max, from + 0.08))
  }
  const span = Math.max(0.001, to - from)
  // 实时小窗以向上为前进方向，轨迹和当前位置共用同一个屏幕投影。
  const project = (x: number, y: number) => ({
    x: plotLeft + x * plotWidth,
    y: plotTop + (to - y) / span * plotHeight,
  })

  ctx.fillStyle = 'rgba(10, 25, 44, 0.86)'
  ctx.fillRect(left, top, width, height)
  ctx.fillStyle = '#e6f5ff'
  ctx.font = 'bold 10px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  // 标出前进方向，也便于在手机预览时识别已更新的路线小窗。
  ctx.fillText(`${title} ↑`, left + width / 2, top + 10)
  ctx.strokeStyle = '#67869d'
  ctx.lineWidth = 1
  ctx.strokeRect(plotLeft, plotTop, plotWidth, plotHeight)
  ctx.beginPath()
  ctx.moveTo(plotLeft + plotWidth / 2, plotTop)
  ctx.lineTo(plotLeft + plotWidth / 2, plotTop + plotHeight)
  ctx.stroke()
  strokeRuntimeTrajectory(ctx, snapshot, project, '#83dfec', 1.6)
  const marker = project(current.x, current.y)
  fillCircle(ctx, marker.x, marker.y, 3.5, '#ffe195')
}
