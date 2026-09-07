export interface TargetReachViewportInsets {
  top: number
  right: number
  bottom: number
  left: number
}

export interface TargetReachViewport {
  centerX: number
  centerY: number
  interactionScale: number
  width: number
  height: number
  insets: TargetReachViewportInsets
}

/** 按横屏高度选择安全边距，顶部额外空间用于方向提示和悬浮 HUD。 */
export function getTargetReachViewportInsets(_width: number, height: number): TargetReachViewportInsets {
  if (height <= 480) return { top: 52, right: 16, bottom: 16, left: 16 }
  if (height <= 650) return { top: 58, right: 20, bottom: 20, left: 20 }
  return { top: 64, right: 24, bottom: 24, left: 24 }
}

/** 使用宽高中的较短边建立统一比例，避免纵向目标被矮屏单独压缩。 */
export function createTargetReachViewport(
  width: number,
  height: number,
  insets: TargetReachViewportInsets,
): TargetReachViewport {
  const safeWidth = Math.max(0, width)
  const safeHeight = Math.max(0, height)
  const availableWidth = Math.max(0, safeWidth - insets.left - insets.right)
  const availableHeight = Math.max(0, safeHeight - insets.top - insets.bottom)

  return {
    width: safeWidth,
    height: safeHeight,
    insets,
    centerX: insets.left + availableWidth / 2,
    centerY: insets.top + availableHeight / 2,
    interactionScale: Math.max(0, Math.min(availableWidth / 2, availableHeight / 2)),
  }
}

/** 将标准化训练坐标转换为 Pixi 屏幕坐标，Y 轴方向与数学坐标保持一致。 */
export function normalizedToScreen(
  point: { x: number; y: number },
  viewport: TargetReachViewport,
): { x: number; y: number } {
  return {
    x: viewport.centerX + point.x * viewport.interactionScale,
    y: viewport.centerY - point.y * viewport.interactionScale,
  }
}

/** 小屏缩小操作球，大屏仍遵守游戏配置中的视觉上限。 */
export function getPlayerRadiusPx(interactionScale: number, configuredMax: number): number {
  return Math.max(14, Math.min(configuredMax, interactionScale * 0.08))
}
