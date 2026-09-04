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
