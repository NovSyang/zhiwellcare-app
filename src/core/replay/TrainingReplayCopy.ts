import { clamp } from './ReplayMath'
import type { ReplayEvent, TrainingReplay } from './TrainingReplay'

/**
 * 把 Vue Proxy 或 IndexedDB 对象转换成播放器独立快照。
 * payload 只保留可安全持久化的基础值、普通对象和数组。
 */
export function copyTrainingReplay(replay: TrainingReplay): TrainingReplay {
  const source = replay as Partial<TrainingReplay>
  return {
    schemaVersion: 1,
    durationMs: nonNegativeInteger(source.durationMs),
    sampleRateHz: nonNegativeInteger(source.sampleRateHz),
    samples: Array.isArray(source.samples)
      ? source.samples.map(copySample).filter((sample): sample is TrainingReplay['samples'][number] => sample !== null)
      : [],
    events: Array.isArray(source.events)
      ? source.events.map(copyEvent).filter((event): event is ReplayEvent => event !== null)
      : [],
  }
}

function copySample(value: unknown): TrainingReplay['samples'][number] | null {
  if (!value || typeof value !== 'object') return null
  const sample = value as Partial<TrainingReplay['samples'][number]>
  if (!isFiniteNumber(sample.elapsedMs) || !isFiniteNumber(sample.x) || !isFiniteNumber(sample.y)) return null
  return {
    elapsedMs: nonNegativeInteger(sample.elapsedMs),
    x: clamp(sample.x, -1, 1),
    y: clamp(sample.y, -1, 1),
  }
}

function copyEvent(value: unknown): ReplayEvent | null {
  if (!value || typeof value !== 'object') return null
  const event = value as Partial<ReplayEvent>
  if (typeof event.type !== 'string' || !isFiniteNumber(event.elapsedMs)) return null
  const payload = copyPlainValue(event.payload, new WeakSet<object>(), 0)
  return payload === undefined
    ? { elapsedMs: nonNegativeInteger(event.elapsedMs), type: event.type }
    : { elapsedMs: nonNegativeInteger(event.elapsedMs), type: event.type, payload }
}

/** 限制递归深度并拒绝特殊原型，避免函数、Window、DOM 或循环对象进入播放器。 */
function copyPlainValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (!value || typeof value !== 'object' || depth > 16 || seen.has(value)) return undefined
  const prototype = Object.getPrototypeOf(value)
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return undefined
  seen.add(value)
  if (Array.isArray(value)) {
    const copied = value.map((item) => copyPlainValue(item, seen, depth + 1)).filter((item) => item !== undefined)
    seen.delete(value)
    return copied
  }
  const copied: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const safeItem = copyPlainValue(item, seen, depth + 1)
    if (safeItem !== undefined) copied[key] = safeItem
  }
  seen.delete(value)
  return copied
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function nonNegativeInteger(value: unknown): number {
  return isFiniteNumber(value) ? Math.max(0, Math.round(value)) : 0
}
