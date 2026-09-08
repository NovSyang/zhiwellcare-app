import type { ReplayEvent } from '../../core/replay/TrainingReplay'
import type { RiverDriftCoinPatternType, RiverDriftObstacleType } from './RiverDriftWorld'

export type RiverDriftReplayEventType =
  | 'river-start'
  | 'segment-spawn'
  | 'coin-spawn'
  | 'coin-collected'
  | 'obstacle-spawn'
  | 'obstacle-hit'
  | 'pause'
  | 'resume'
  | 'river-complete'

export interface RiverStartPayload { version: 1; boatX: number; boatY: number }
export interface SegmentSpawnPayload { id: string; y: number; height: number; startCenterX: number; endCenterX: number; decorationVariant: number }
export interface CoinSpawnPayload { id: string; x: number; y: number; radius: number; patternId: string; patternType: RiverDriftCoinPatternType }
export interface ObstacleSpawnPayload { id: string; x: number; y: number; radius: number; obstacleType: RiverDriftObstacleType }
export interface EntityEventPayload { id: string }

/** 回放只接受结构完整的漂流事件，损坏记录会被安全忽略。 */
export function isRiverDriftReplayEvent(event: ReplayEvent): boolean {
  if (event.type === 'pause' || event.type === 'resume' || event.type === 'river-complete') return true
  const payload = event.payload as Record<string, unknown> | undefined
  if (!payload) return false
  if (event.type === 'river-start') return payload.version === 1 && finite(payload.boatX) && finite(payload.boatY)
  if (event.type === 'segment-spawn') {
    return text(payload.id) && finite(payload.y) && finite(payload.height) && finite(payload.startCenterX)
      && finite(payload.endCenterX) && finite(payload.decorationVariant)
  }
  if (event.type === 'coin-spawn') {
    return text(payload.id) && finite(payload.x) && finite(payload.y) && finite(payload.radius)
      && text(payload.patternId) && text(payload.patternType)
  }
  if (event.type === 'obstacle-spawn') {
    return text(payload.id) && finite(payload.x) && finite(payload.y) && finite(payload.radius) && text(payload.obstacleType)
  }
  if (event.type === 'coin-collected' || event.type === 'obstacle-hit') return text(payload.id)
  return false
}

function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0 }
