export interface KartRacingViewport {
  width: number
  height: number
  scale: number
  /** 赛道远端的地平线位置。 */
  horizonY: number
  /** 玩家和世界实体到达时使用的逻辑平面。 */
  kartY: number
  /** 赛道视觉近端底部，不参与实体碰撞和投影。 */
  roadBottomY: number
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
    roadBottomY: safeHeight * 0.93,
    safeTop: Math.max(52, safeHeight * 0.10),
  }
}
