import type { IClock } from '../../core/time/IClock'

/** APP 的计时与现有动画帧时间戳使用同一个时间原点。 */
export const browserClock: IClock = {
  nowEpochMs: () => Date.now(),
  nowMonotonicMs: () => performance.now(),
}
