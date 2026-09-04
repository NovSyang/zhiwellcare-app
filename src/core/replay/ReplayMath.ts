import type { ReplaySample } from './TrainingReplay'

/** 限制坐标值，避免异常输入污染后续历史数据。 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 保留四位小数，在存储体积和轨迹精度之间取得平衡。 */
export function round4(value: number): number { return Math.round(value * 10_000) / 10_000 }

/**
 * 使用二分查找获取指定时间的插值样本。
 * 空输入返回 null，边界时间固定在首尾样本，避免 Seek 越界。
 */
export function sampleAtElapsed(samples: readonly ReplaySample[], elapsedMs: number): ReplaySample | null {
  if (samples.length === 0) return null
  if (samples.length === 1 || elapsedMs <= samples[0].elapsedMs) return { ...samples[0] }
  const last = samples[samples.length - 1]
  if (elapsedMs >= last.elapsedMs) return { ...last }

  let low = 0
  let high = samples.length - 1
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2)
    if (samples[middle].elapsedMs <= elapsedMs) low = middle
    else high = middle
  }
  const before = samples[low]
  const after = samples[high]
  const span = after.elapsedMs - before.elapsedMs
  if (span <= 0) return { ...after }
  const ratio = (elapsedMs - before.elapsedMs) / span
  return {
    elapsedMs: Math.round(elapsedMs),
    x: before.x + (after.x - before.x) * ratio,
    y: before.y + (after.y - before.y) * ratio,
  }
}

/** 仅用于绘制层的均匀降采样；原始 Replay 记录不做任何丢弃。 */
export function downsampleForDisplay<T>(items: readonly T[], maximum = 1800): T[] {
  if (items.length <= maximum) return [...items]
  const step = (items.length - 1) / (maximum - 1)
  return Array.from({ length: maximum }, (_, index) => items[Math.round(index * step)])
}
