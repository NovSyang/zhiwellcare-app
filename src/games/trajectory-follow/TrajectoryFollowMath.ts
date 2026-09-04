import { sampleAtElapsed } from '../../core/replay/ReplayMath'
import type { TrajectoryFollowGameConfig } from './TrajectoryFollowGameConfig'

export interface TrajectoryReferenceSample {
  elapsedMs: number
  x: number
  y: number
}

/** 计算 8 字轨迹上的一个标准化坐标。 */
export function getTrajectoryPoint(
  elapsedMs: number,
  config: Pick<TrajectoryFollowGameConfig, 'cycleDurationMs' | 'horizontalAmplitude' | 'verticalAmplitude'>,
): TrajectoryReferenceSample {
  const safeCycle = Math.max(1, config.cycleDurationMs)
  const theta = Math.PI * 2 * (Math.max(0, elapsedMs) / safeCycle)
  return {
    elapsedMs: Math.max(0, Math.round(elapsedMs)),
    x: config.horizontalAmplitude * Math.sin(theta),
    y: config.verticalAmplitude * Math.sin(theta * 2),
  }
}

/** 预生成整局参考事实，并保证最后一个点精确覆盖训练结束时间。 */
export function createReferenceSamples(config: TrajectoryFollowGameConfig): TrajectoryReferenceSample[] {
  const duration = Math.max(0, Math.round(config.sessionDurationMs))
  const interval = Math.max(1, Math.round(config.referenceSampleIntervalMs))
  const samples: TrajectoryReferenceSample[] = []
  for (let elapsedMs = 0; elapsedMs <= duration; elapsedMs += interval) {
    samples.push(getTrajectoryPoint(elapsedMs, config))
  }
  if (samples.at(-1)?.elapsedMs !== duration) samples.push(getTrajectoryPoint(duration, config))
  return samples
}

/** 使用 Core 的二分插值读取预生成参考点。 */
export function getReferenceAt(
  samples: readonly TrajectoryReferenceSample[],
  elapsedMs: number,
): TrajectoryReferenceSample | null {
  return sampleAtElapsed(samples, elapsedMs)
}

/** 误差是患者点与引导点在归一化 ROM 坐标中的二维距离。 */
export function trackingError(
  player: Pick<TrajectoryReferenceSample, 'x' | 'y'>,
  guide: Pick<TrajectoryReferenceSample, 'x' | 'y'>,
): number {
  return Math.hypot(player.x - guide.x, player.y - guide.y)
}
