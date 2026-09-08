/** 世界对象通过横向半径和纵向经过区间进行简化碰撞。 */
export function kartEntityOverlaps(
  previousDistance: number,
  currentDistance: number,
  kartLateral: number,
  entity: { distance: number; lateral: number; radius: number },
  kartRadius: number,
  collisionDepth: number,
): boolean {
  const minDistance = Math.min(previousDistance, currentDistance) - Math.max(0, collisionDepth)
  const maxDistance = Math.max(previousDistance, currentDistance) + Math.max(0, collisionDepth)
  if (entity.distance < minDistance || entity.distance > maxDistance) return false
  return Math.abs(entity.lateral - kartLateral) <= Math.max(0, entity.radius) + Math.max(0, kartRadius)
}

/** 同一障碍和全局保护期共同阻止连续重复计数。 */
export function canRegisterKartHit(
  elapsedMs: number,
  lastHitElapsedMs: number,
  alreadyHit: boolean,
  invulnerabilityMs: number,
): boolean {
  return !alreadyHit && elapsedMs - lastHitElapsedMs >= Math.max(0, invulnerabilityMs)
}
