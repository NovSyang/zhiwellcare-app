export interface MiniTabLayoutMetrics {
  windowHeight: number
  headerHeight: number
  scrollHeight: number
}

/** 窗口和页头尺寸均为逻辑 px，向下取整避免正文把页面撑出第二层滚动。 */
export function calculateMiniTabLayout(windowHeight: number, headerHeight: number): MiniTabLayoutMetrics | null {
  if (!Number.isFinite(windowHeight) || windowHeight <= 0 || !Number.isFinite(headerHeight) || headerHeight <= 0) return null
  const scrollHeight = Math.floor(windowHeight - headerHeight)
  return scrollHeight > 0 ? { windowHeight, headerHeight, scrollHeight } : null
}
