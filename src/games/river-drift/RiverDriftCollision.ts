import type { RiverDriftPoint } from './RiverDriftWorld'

/** 使用圆形近似碰撞，足以覆盖圆润的小船、金币和障碍轮廓。 */
export function riverDriftCirclesOverlap(
  first: RiverDriftPoint & { radius: number },
  second: RiverDriftPoint & { radius: number },
): boolean {
  const dx = first.x - second.x
  const dy = first.y - second.y
  const radius = Math.max(0, first.radius) + Math.max(0, second.radius)
  return dx * dx + dy * dy <= radius * radius
}

/** 同一障碍只命中一次，全局无敌期也可避免密集对象重复计数。 */
export function canRegisterRiverDriftHit(
  elapsedMs: number,
  lastHitElapsedMs: number,
  obstacleAlreadyHit: boolean,
  invulnerabilityMs: number,
): boolean {
  if (obstacleAlreadyHit) return false
  return elapsedMs - lastHitElapsedMs >= Math.max(0, invulnerabilityMs)
}
