import { describe, expect, it } from 'vitest'
import type { Direction } from '../src/core/training/Direction'
import { defaultTargetReachGameConfig } from '../src/games/target-reach/TargetReachGameConfig'
import { getTargetPosition } from '../src/games/target-reach/TargetReachMath'
import {
  createTargetReachViewport,
  getPlayerRadiusPx,
  getTargetReachViewportInsets,
  normalizedToScreen,
} from '../src/games/target-reach/TargetReachViewportMapper'

const viewportSizes = [
  [800, 360],
  [896, 414],
  [960, 432],
  [1280, 720],
  [1024, 768],
  [1280, 800],
] as const
const directions: Direction[] = ['left', 'right', 'forward', 'backward']

describe('TargetReachViewportMapper', () => {
  it.each(viewportSizes)('%d×%d 下四方向使用相同像素距离', (width, height) => {
    const viewport = createViewport(width, height)
    const center = normalizedToScreen({ x: 0, y: 0 }, viewport)
    const distances = directions.map((direction) => {
      const target = normalizedToScreen(getTargetPosition(direction, defaultTargetReachGameConfig.targetDistance), viewport)
      return Math.hypot(target.x - center.x, target.y - center.y)
    })

    for (const distance of distances.slice(1)) expect(distance).toBeCloseTo(distances[0])
  })

  it.each(viewportSizes)('%d×%d 下自然中心保持在有效训练空间中心', (width, height) => {
    const viewport = createViewport(width, height)
    expect(normalizedToScreen({ x: 0, y: 0 }, viewport)).toEqual({ x: viewport.centerX, y: viewport.centerY })
  })

  it.each(viewportSizes)('%d×%d 下自然中心与目标边缘至少相距 20px', (width, height) => {
    const viewport = createViewport(width, height)
    const targetRadiusPx = defaultTargetReachGameConfig.targetRadius * viewport.interactionScale
    const playerRadiusPx = getPlayerRadiusPx(viewport.interactionScale, defaultTargetReachGameConfig.playerRadius)
    const visibleGapPx = defaultTargetReachGameConfig.targetDistance * viewport.interactionScale - targetRadiusPx - playerRadiusPx

    expect(visibleGapPx).toBeGreaterThanOrEqual(20)
  })

  it.each(viewportSizes)('%d×%d 下四方向目标圈不越过安全边界', (width, height) => {
    const viewport = createViewport(width, height)
    const radius = defaultTargetReachGameConfig.targetRadius * viewport.interactionScale
    for (const direction of directions) {
      const target = normalizedToScreen(getTargetPosition(direction, defaultTargetReachGameConfig.targetDistance), viewport)
      expect(target.x - radius).toBeGreaterThanOrEqual(viewport.insets.left)
      expect(target.x + radius).toBeLessThanOrEqual(viewport.width - viewport.insets.right)
      expect(target.y - radius).toBeGreaterThanOrEqual(viewport.insets.top)
      expect(target.y + radius).toBeLessThanOrEqual(viewport.height - viewport.insets.bottom)
    }
  })

  it('玩家球在矮屏使用最小半径，在大屏遵守配置上限', () => {
    expect(getPlayerRadiusPx(createViewport(800, 360).interactionScale, 22)).toBe(14)
    expect(getPlayerRadiusPx(createViewport(2000, 1200).interactionScale, 22)).toBe(22)
  })
})

/** 测试统一通过产品高度分档创建视口，避免测试与真实入口使用不同参数。 */
function createViewport(width: number, height: number) {
  return createTargetReachViewport(width, height, getTargetReachViewportInsets(width, height))
}
