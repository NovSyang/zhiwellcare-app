import type { BaseTrainingResult } from '../../core/training/BaseTrainingResult'

export interface RiverDriftMetricSample { x: number; y: number }

export interface RiverDriftTrainingResult extends BaseTrainingResult {
  collectedCoins: number
  totalCoins: number
  coinCollectionRate: number
  spawnedObstacles: number
  avoidedObstacles: number
  collisionCount: number
  activeMovementRatio: number
  averageInputMagnitude: number
  maxInputMagnitude: number
  leftActivity: number
  rightActivity: number
  forwardActivity: number
  backwardActivity: number
  horizontalMovementBalance: number
  verticalMovementBalance: number
}

/** 将固定频率输入样本转换为中立的工程训练指标，不作临床诊断。 */
export function buildRiverDriftTrainingResult(input: {
  startedAt: number
  endedAt: number
  durationMs: number
  collectedCoins: number
  totalCoins: number
  spawnedObstacles: number
  collisionCount: number
  samples: readonly RiverDriftMetricSample[]
  movementThreshold: number
}): RiverDriftTrainingResult {
  const samples = input.samples.filter((sample) => Number.isFinite(sample.x) && Number.isFinite(sample.y))
  const threshold = Math.max(0, input.movementThreshold)
  const magnitudes = samples.map((sample) => Math.max(Math.abs(sample.x), Math.abs(sample.y)))
  const count = samples.length
  const ratio = (matched: number): number => count === 0 ? 0 : matched / count
  const left = samples.filter((sample) => sample.x < -threshold).length
  const right = samples.filter((sample) => sample.x > threshold).length
  const forward = samples.filter((sample) => sample.y > threshold).length
  const backward = samples.filter((sample) => sample.y < -threshold).length
  const totalCoins = Math.max(0, Math.round(input.totalCoins))
  const collectedCoins = Math.min(totalCoins, Math.max(0, Math.round(input.collectedCoins)))
  const spawnedObstacles = Math.max(0, Math.round(input.spawnedObstacles))
  const collisionCount = Math.min(spawnedObstacles, Math.max(0, Math.round(input.collisionCount)))
  return {
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    durationMs: Math.max(0, input.durationMs),
    collectedCoins,
    totalCoins,
    coinCollectionRate: totalCoins === 0 ? 0 : collectedCoins / totalCoins,
    spawnedObstacles,
    avoidedObstacles: Math.max(0, spawnedObstacles - collisionCount),
    collisionCount,
    activeMovementRatio: ratio(magnitudes.filter((value) => value > threshold).length),
    averageInputMagnitude: count === 0 ? 0 : magnitudes.reduce((sum, value) => sum + value, 0) / count,
    maxInputMagnitude: count === 0 ? 0 : Math.max(...magnitudes),
    leftActivity: ratio(left),
    rightActivity: ratio(right),
    forwardActivity: ratio(forward),
    backwardActivity: ratio(backward),
    horizontalMovementBalance: balance(left, right),
    verticalMovementBalance: balance(forward, backward),
  }
}

function balance(first: number, second: number): number {
  const total = first + second
  return total === 0 ? 0 : 1 - Math.abs(first - second) / total
}
