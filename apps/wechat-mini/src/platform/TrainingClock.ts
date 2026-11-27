import type { IClock } from '../../../../src/core/shared'

/** 提供独立训练时间轴。缺少原生计时时，限制墙钟跳变对单次更新的影响。 */
export function createTrainingClock(
  readMonotonic: (() => number) | null = globalThis.performance?.now?.bind(globalThis.performance) ?? null,
  readEpoch: () => number = Date.now,
): IClock {
  let previous = readEpoch()
  let elapsed = 0
  return {
    nowEpochMs: readEpoch,
    nowMonotonicMs() {
      if (readMonotonic) return readMonotonic()
      const current = readEpoch()
      // 主循环每 20 毫秒读取。回拨不倒退，跳时或重入不一次耗尽本局训练。
      elapsed += Math.max(0, Math.min(100, current - previous))
      previous = current
      return elapsed
    },
  }
}
