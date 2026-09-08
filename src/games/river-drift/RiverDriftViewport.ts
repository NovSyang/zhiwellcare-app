import { clamp } from './RiverDriftPhysics'

export interface RiverDriftViewport {
  width: number
  height: number
  scale: number
  safeTop: number
}

/** 视口只负责坐标换算，游戏状态始终保留在 0~1 的归一化空间。 */
export function createRiverDriftViewport(width: number, height: number): RiverDriftViewport {
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)
  return {
    width: safeWidth,
    height: safeHeight,
    scale: Math.min(safeWidth, safeHeight),
    safeTop: Math.max(52, safeHeight * 0.10),
  }
}

export function riverDriftToScreen(point: { x: number; y: number }, viewport: RiverDriftViewport): { x: number; y: number } {
  return {
    x: clamp(point.x, -0.2, 1.2) * viewport.width,
    y: clamp(point.y, -0.4, 1.4) * viewport.height,
  }
}
