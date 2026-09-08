import { clamp } from '../RiverDriftPhysics'

/** 将世界纵坐标限制在透视计算使用的 0~1 区间。 */
export function riverDriftDepth(y: number): number {
  return clamp(Number.isFinite(y) ? y : 0, 0, 1)
}

/** 普通物体越靠近屏幕下方越大，形成稳定的纵深感。 */
export function riverDriftPerspectiveScale(y: number): number {
  return 0.82 + riverDriftDepth(y) * 0.30
}

/** 岸边装饰使用更窄的缩放范围，避免宽屏下显得忽大忽小。 */
export function riverDriftEnvironmentScale(y: number): number {
  return 0.88 + riverDriftDepth(y) * 0.20
}

/** 船体只做轻微透视缩放，保证训练时角色尺寸稳定。 */
export function riverDriftBoatScale(y: number): number {
  return 0.97 + riverDriftDepth(y) * 0.06
}

/** 投影在近处稍深、稍宽，但始终保持轻量。 */
export function riverDriftShadowStyle(y: number): { alpha: number; scaleX: number } {
  const depth = riverDriftDepth(y)
  return { alpha: 0.12 + depth * 0.10, scaleX: 0.92 + depth * 0.16 }
}

/** 描边随纵深轻微变粗，远处物体仍能保持清晰轮廓。 */
export function riverDriftOutlineWidth(y: number): number {
  return 1.5 + riverDriftDepth(y) * 1.5
}
