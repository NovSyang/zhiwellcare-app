import type { ReplayEvent } from '../../core/replay/TrainingReplay'

export type KartRacingReplayEventType =
  | 'kart-start'
  | 'track-segment'
  | 'coin-spawn'
  | 'coin-collected'
  | 'obstacle-spawn'
  | 'obstacle-hit'
  | 'item-spawn'
  | 'item-collected'
  | 'shield-activated'
  | 'shield-consumed'
  | 'boost-start'
  | 'boost-end'
  | 'checkpoint'
  | 'pause'
  | 'resume'
  | 'kart-complete'

export interface KartStartPayload { version: 1; lateral: number; speed: number; seed: number }
export interface KartEntitySpawnPayload { id: string; distance: number; lateral: number; radius: number; kind: string }
export interface KartEntityPayload { id: string }
export interface KartObstacleHitPayload extends KartEntityPayload { slowdownApplied: boolean }
export interface KartCompletePayload { reason: 'finish-line' | 'max-duration'; distance: number }

/** 回放只接受结构完整的卡丁车事件，损坏记录会被安全忽略。 */
export function isKartRacingReplayEvent(event: ReplayEvent): boolean {
  const allowed: KartRacingReplayEventType[] = [
    'kart-start', 'track-segment', 'coin-spawn', 'coin-collected', 'obstacle-spawn', 'obstacle-hit',
    'item-spawn', 'item-collected', 'shield-activated', 'shield-consumed', 'boost-start', 'boost-end',
    'checkpoint', 'pause', 'resume', 'kart-complete',
  ]
  if (!allowed.includes(event.type as KartRacingReplayEventType)) return false
  if (event.type === 'pause' || event.type === 'resume' || event.type === 'boost-end') return true
  const payload = event.payload as Record<string, unknown> | undefined
  if (!payload) return false
  if (event.type === 'kart-start') return payload.version === 1 && finite(payload.lateral) && finite(payload.speed) && finite(payload.seed)
  if (event.type.endsWith('-spawn')) {
    return text(payload.id) && finite(payload.distance) && finite(payload.lateral) && finite(payload.radius) && text(payload.kind)
  }
  if (event.type === 'obstacle-hit') return text(payload.id) && typeof payload.slowdownApplied === 'boolean'
  if (event.type === 'kart-complete') {
    return (payload.reason === 'finish-line' || payload.reason === 'max-duration') && finite(payload.distance)
  }
  return text(payload.id) || text(payload.segmentId) || finite(payload.distance)
}

function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0 }
