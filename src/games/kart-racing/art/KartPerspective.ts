import type { KartRacingViewport } from '../KartRacingViewport'
import type { KartTrackSegment } from '../KartRacingTrack'
import { kartTrackCenterOffset } from '../KartRacingTrack'

export interface KartProjection {
  visible: boolean
  depth: number
  screenX: number
  screenY: number
  scale: number
  roadHalfWidth: number
}

/** 世界距离越靠近车辆，深度越接近 1。 */
export function distanceToKartDepth(relativeDistance: number, visibleDistance: number): number {
  if (!Number.isFinite(relativeDistance) || relativeDistance < -4 || relativeDistance > visibleDistance) return -1
  return clamp(1 - Math.max(0, relativeDistance) / Math.max(1, visibleDistance), 0, 1)
}

/** 非线性纵向投影让远端集中在地平线附近。 */
export function kartDepthToScreenY(depth: number, viewport: KartRacingViewport): number {
  const eased = Math.pow(clamp(depth, 0, 1), 1.65)
  return viewport.horizonY + eased * (viewport.kartY - viewport.horizonY)
}

export function kartRoadHalfWidthAtDepth(depth: number, viewport: KartRacingViewport): number {
  return viewport.width * (0.055 + Math.pow(clamp(depth, 0, 1), 1.08) * 0.40)
}

export function kartEntityScaleAtDepth(depth: number): number {
  return 0.18 + Math.pow(clamp(depth, 0, 1), 1.35) * 0.92
}

/** 统一把世界对象投影到弯曲赛道，避免各渲染器重复透视公式。 */
export function projectKartEntity(input: {
  entityDistance: number
  entityLateral: number
  kartDistance: number
  visibleDistance: number
  track: readonly KartTrackSegment[]
  viewport: KartRacingViewport
}): KartProjection {
  const relative = input.entityDistance - input.kartDistance
  const depth = distanceToKartDepth(relative, input.visibleDistance)
  if (depth < 0) return { visible: false, depth: 0, screenX: 0, screenY: 0, scale: 0, roadHalfWidth: 0 }
  const roadHalfWidth = kartRoadHalfWidthAtDepth(depth, input.viewport)
  const curveOffset = kartTrackCenterOffset(input.track, input.kartDistance, Math.max(0, relative))
  const centerX = input.viewport.width / 2 + curveOffset * roadHalfWidth * (1 - depth * 0.35)
  return {
    visible: true,
    depth,
    screenX: centerX + clamp(input.entityLateral, -1, 1) * roadHalfWidth,
    screenY: kartDepthToScreenY(depth, input.viewport),
    scale: kartEntityScaleAtDepth(depth),
    roadHalfWidth,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
