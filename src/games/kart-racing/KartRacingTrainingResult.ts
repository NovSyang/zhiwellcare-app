import type { BaseTrainingResult } from '../../core/training/BaseTrainingResult'

export interface KartRacingMetricSample {
  x: number
  y: number
  speedRatio: number
  distance: number
}

export interface KartRacingTrainingResult extends BaseTrainingResult {
  completionReason: 'finish-line' | 'max-duration'
  trackProgress: number
  collectedCoins: number
  totalCoins: number
  coinCollectionRate: number
  spawnedObstacles: number
  collisionCount: number
  avoidedObstacles: number
  averageSpeedRatio: number
  maxSpeedRatio: number
  accelerationParticipation: number
  brakingParticipation: number
  activeMovementRatio: number
  leftActivity: number
  rightActivity: number
  forwardActivity: number
  backwardActivity: number
  horizontalMovementBalance: number
  verticalMovementBalance: number
  averageInputMagnitude: number
  maxInputMagnitude: number
}

/** 将固定频率样本转换为中性的训练事实，不进行医学评价。 */
export function buildKartRacingTrainingResult(input: {
  startedAt: number
  endedAt: number
  durationMs: number
  completionReason: KartRacingTrainingResult['completionReason']
  trackProgress: number
  collectedCoins: number
  totalCoins: number
  spawnedObstacles: number
  collisionCount: number
  samples: readonly KartRacingMetricSample[]
  movementThreshold: number
}): KartRacingTrainingResult {
  const samples = input.samples.filter((sample) => [sample.x, sample.y, sample.speedRatio, sample.distance].every(Number.isFinite))
  const count = samples.length
  const threshold = Math.max(0, input.movementThreshold)
  const ratio = (matched: number): number => count === 0 ? 0 : matched / count
  const magnitudes = samples.map((sample) => Math.hypot(sample.x, sample.y))
  const left = samples.filter((sample) => sample.x < -threshold).length
  const right = samples.filter((sample) => sample.x > threshold).length
  const forward = samples.filter((sample) => sample.y > threshold).length
  const backward = samples.filter((sample) => sample.y < -threshold).length
  const speedRatios = samples.map((sample) => clamp(sample.speedRatio, 0, 1.12))
  const totalCoins = Math.max(0, Math.round(input.totalCoins))
  const collectedCoins = Math.min(totalCoins, Math.max(0, Math.round(input.collectedCoins)))
  const spawnedObstacles = Math.max(0, Math.round(input.spawnedObstacles))
  const collisionCount = Math.min(spawnedObstacles, Math.max(0, Math.round(input.collisionCount)))
  return {
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    durationMs: Math.max(0, input.durationMs),
    completionReason: input.completionReason,
    trackProgress: clamp(input.trackProgress, 0, 1),
    collectedCoins,
    totalCoins,
    coinCollectionRate: totalCoins === 0 ? 0 : collectedCoins / totalCoins,
    spawnedObstacles,
    collisionCount,
    avoidedObstacles: Math.max(0, spawnedObstacles - collisionCount),
    averageSpeedRatio: count === 0 ? 0 : speedRatios.reduce((sum, value) => sum + value, 0) / count,
    maxSpeedRatio: count === 0 ? 0 : Math.max(...speedRatios),
    accelerationParticipation: ratio(forward),
    brakingParticipation: ratio(backward),
    activeMovementRatio: ratio(magnitudes.filter((value) => value > threshold).length),
    leftActivity: ratio(left),
    rightActivity: ratio(right),
    forwardActivity: ratio(forward),
    backwardActivity: ratio(backward),
    horizontalMovementBalance: balance(left, right),
    verticalMovementBalance: balance(forward, backward),
    averageInputMagnitude: count === 0 ? 0 : magnitudes.reduce((sum, value) => sum + value, 0) / count,
    maxInputMagnitude: count === 0 ? 0 : Math.max(...magnitudes),
  }
}

function balance(first: number, second: number): number {
  const total = first + second
  return total === 0 ? 0 : 1 - Math.abs(first - second) / total
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
}
