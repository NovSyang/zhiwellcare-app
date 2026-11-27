import { clamp } from '../../../core/replay/ReplayMath'
import type { ReplayEvent } from '../../../core/replay/TrainingReplay'
import type { TrajectoryReferenceSample } from '../TrajectoryFollowMath'

/** 从保存事件中严格读取参考样本，缺失时让页面保持静态而不是重算路径。 */
export function extractReferenceSamples(events: readonly ReplayEvent[]): TrajectoryReferenceSample[] {
  const event = events.find((item) => item.type === 'reference-path')
  if (!event?.payload || typeof event.payload !== 'object') return []
  const values = (event.payload as { samples?: unknown }).samples
  if (!Array.isArray(values)) return []
  return values.flatMap((value) => {
    if (!value || typeof value !== 'object') return []
    const sample = value as Partial<TrajectoryReferenceSample>
    if (![sample.elapsedMs, sample.x, sample.y].every((item) => typeof item === 'number' && Number.isFinite(item))) return []
    return [{ elapsedMs: Math.max(0, Math.round(sample.elapsedMs as number)), x: clamp(sample.x as number, -1, 1), y: clamp(sample.y as number, -1, 1) }]
  }).sort((a, b) => a.elapsedMs - b.elapsedMs)
}
