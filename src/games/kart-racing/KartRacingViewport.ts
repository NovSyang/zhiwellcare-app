export interface KartRacingViewport {
  width: number
  height: number
  scale: number
  horizonY: number
  kartY: number
  safeTop: number
}

/** 视口只描述最终画布，不让业务状态依赖像素尺寸。 */
export function createKartRacingViewport(width: number, height: number): KartRacingViewport {
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)
  return {
    width: safeWidth,
    height: safeHeight,
    scale: Math.min(safeWidth, safeHeight),
    horizonY: safeHeight * 0.24,
    kartY: safeHeight * 0.76,
    safeTop: Math.max(52, safeHeight * 0.10),
  }
}
