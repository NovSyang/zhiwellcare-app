import type { Direction } from '../../core/training/Direction'

export interface NormalizedPoint {
  x: number
  y: number
}

/** 将训练方向转换为以中心为原点的归一化目标坐标。 */
export function getTargetPosition(direction: Direction, distance: number): NormalizedPoint {
  switch (direction) {
    case 'left': return { x: -distance, y: 0 }
    case 'right': return { x: distance, y: 0 }
    case 'forward': return { x: 0, y: distance }
    case 'backward': return { x: 0, y: -distance }
  }
}

export function distanceBetween(a: NormalizedPoint, b: NormalizedPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** 将连续停留时间转换为 0 到 1 的目标进度，异常输入按未开始处理。 */
export function getTargetHoldProgress(
  playingElapsedMs: number,
  holdStartedElapsedMs: number | null,
  holdTimeMs: number,
): number {
  if (holdStartedElapsedMs === null || !Number.isFinite(playingElapsedMs) || !Number.isFinite(holdStartedElapsedMs)) return 0
  if (!Number.isFinite(holdTimeMs) || holdTimeMs <= 0) return 1
  const elapsedMs = Math.max(0, playingElapsedMs - holdStartedElapsedMs)
  return Math.min(1, elapsedMs / holdTimeMs)
}
