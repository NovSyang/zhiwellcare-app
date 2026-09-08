/** 森林溪谷漂流的全部可调参数，数值均为工程初始值。 */
export interface RiverDriftGameConfig {
  sessionDurationMs: number
  fixedStepMs: number
  maxFrameDeltaMs: number
  maxCatchUpSteps: number
  worldSpeed: number
  maxHorizontalSpeed: number
  maxVerticalSpeed: number
  steeringResponsiveness: number
  velocityDamping: number
  neutralThreshold: number
  riverWidthRatio: number
  boatVerticalMin: number
  boatVerticalMax: number
  boatRadius: number
  coinRadius: number
  obstacleRadius: number
  hitSlowdownMs: number
  hitSlowdownFactor: number
  hitInvulnerabilityMs: number
  obstacleMinIntervalMs: number
  obstacleMaxIntervalMs: number
  coinPatternIntervalMs: number
  movementThreshold: number
  metricSampleIntervalMs: number
  stopSpawningBeforeEndMs: number
  riverSegmentCount: number
  coinPoolSize: number
  obstaclePoolSize: number
  particlePoolSize: number
  debug: boolean
}

/** 默认配置优先保证动作平稳和充分预判时间，不追求跑酷速度。 */
export const defaultRiverDriftGameConfig: RiverDriftGameConfig = {
  sessionDurationMs: 90_000,
  fixedStepMs: 1_000 / 60,
  maxFrameDeltaMs: 100,
  maxCatchUpSteps: 6,
  worldSpeed: 0.115,
  maxHorizontalSpeed: 0.42,
  maxVerticalSpeed: 0.22,
  steeringResponsiveness: 0.10,
  velocityDamping: 0.90,
  neutralThreshold: 0.05,
  riverWidthRatio: 0.68,
  boatVerticalMin: 0.63,
  boatVerticalMax: 0.85,
  boatRadius: 0.045,
  coinRadius: 0.026,
  obstacleRadius: 0.048,
  hitSlowdownMs: 700,
  hitSlowdownFactor: 0.55,
  hitInvulnerabilityMs: 1_000,
  obstacleMinIntervalMs: 2_400,
  obstacleMaxIntervalMs: 3_400,
  coinPatternIntervalMs: 1_100,
  movementThreshold: 0.10,
  metricSampleIntervalMs: 40,
  stopSpawningBeforeEndMs: 10_000,
  riverSegmentCount: 7,
  coinPoolSize: 48,
  obstaclePoolSize: 12,
  particlePoolSize: 80,
  debug: false,
}
