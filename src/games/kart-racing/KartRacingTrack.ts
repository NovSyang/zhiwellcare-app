/** 一段固定赛道；曲率小于零表示左弯，大于零表示右弯。 */
export interface KartTrackSegment {
  id: string
  startDistance: number
  length: number
  curvature: number
  roadWidth: number
  environmentVariant: number
}

/** V1 固定赛道先易后稳，最后直道主动降低操作压力。 */
export function createDefaultKartTrack(trackLength = 1_000): KartTrackSegment[] {
  const parts = [
    ['start-straight', 0, 0.15, 0, 0],
    ['gentle-left', 0.15, 0.15, -0.16, 1],
    ['middle-straight', 0.30, 0.15, 0, 2],
    ['gentle-right', 0.45, 0.15, 0.16, 3],
    ['long-straight', 0.60, 0.15, 0, 0],
    ['s-left', 0.75, 0.065, -0.12, 1],
    ['s-right', 0.815, 0.065, 0.12, 2],
    ['finish-straight', 0.88, 0.12, 0, 3],
  ] as const
  return parts.map(([id, start, length, curvature, environmentVariant]) => ({
    id,
    startDistance: start * trackLength,
    length: length * trackLength,
    curvature,
    roadWidth: 1,
    environmentVariant,
  }))
}

/** 根据赛道距离返回当前赛段，越界时稳定落在首尾段。 */
export function getKartTrackSegment(segments: readonly KartTrackSegment[], distance: number): KartTrackSegment {
  if (segments.length === 0) throw new Error('卡丁车赛道至少需要一个赛段。')
  const safeDistance = Number.isFinite(distance) ? distance : 0
  return segments.find((segment) => safeDistance >= segment.startDistance && safeDistance < segment.startDistance + segment.length)
    ?? (safeDistance < segments[0].startDistance ? segments[0] : segments.at(-1)!)
}

/** 累加前方赛段曲率，供伪 3D 道路中心投影使用。 */
export function kartTrackCenterOffset(
  segments: readonly KartTrackSegment[],
  distance: number,
  lookAheadDistance: number,
): number {
  const steps = 12
  const stepDistance = Math.max(0, lookAheadDistance) / steps
  let offset = 0
  for (let index = 0; index < steps; index += 1) {
    const sampleDistance = distance + (index + 0.5) * stepDistance
    offset += getKartTrackSegment(segments, sampleDistance).curvature * stepDistance / 55
  }
  return clamp(offset, -0.85, 0.85)
}

export function kartTrackProgress(distance: number, trackLength: number): number {
  return clamp((Number.isFinite(distance) ? distance : 0) / Math.max(1, trackLength), 0, 1)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
