export interface TrajectoryFollowGameConfig {
  sessionDurationMs: number
  cycleDurationMs: number
  horizontalAmplitude: number
  verticalAmplitude: number
  toleranceRadius: number
  playerRadius: number
  guideRadius: number
  referenceSampleIntervalMs: number
  metricSampleIntervalMs: number
  trailWindowMs: number
}

/** 默认 20 秒完成一圈，保证 60 秒训练以较舒缓速度完整运行三圈。 */
export const defaultTrajectoryFollowGameConfig: TrajectoryFollowGameConfig = {
  sessionDurationMs: 60_000,
  cycleDurationMs: 20_000,
  horizontalAmplitude: 0.65,
  verticalAmplitude: 0.45,
  toleranceRadius: 0.18,
  playerRadius: 18,
  guideRadius: 18,
  referenceSampleIntervalMs: 40,
  metricSampleIntervalMs: 40,
  trailWindowMs: 2_500,
}
