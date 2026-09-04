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

/** V0.7 工程初始参数用于交互训练，不代表临床评分标准。 */
export const defaultTrajectoryFollowGameConfig: TrajectoryFollowGameConfig = {
  sessionDurationMs: 60_000,
  cycleDurationMs: 12_000,
  horizontalAmplitude: 0.65,
  verticalAmplitude: 0.45,
  toleranceRadius: 0.18,
  playerRadius: 18,
  guideRadius: 18,
  referenceSampleIntervalMs: 40,
  metricSampleIntervalMs: 40,
  trailWindowMs: 2_500,
}
