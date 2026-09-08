import type { GameInput } from '../../core/game-input/GameInput'
import type { TrainingGameEvents } from '../../core/game/TrainingGameEvents'
import { canRegisterRiverDriftHit, riverDriftCirclesOverlap } from './RiverDriftCollision'
import type { RiverDriftGameConfig } from './RiverDriftGameConfig'
import type { RiverDriftTrainingResult } from './RiverDriftTrainingResult'

export interface RiverDriftPoint { x: number; y: number }
export type RiverDriftCoinPatternType = 'straight' | 'horizontal' | 's-curve' | 'guide-left' | 'guide-right'
export type RiverDriftObstacleType = 'rock' | 'stump' | 'crate' | 'weed'

export interface RiverDriftCoin extends RiverDriftPoint {
  id: string
  radius: number
  patternId: string
  patternType: RiverDriftCoinPatternType
  active: boolean
}

export interface RiverDriftObstacle extends RiverDriftPoint {
  id: string
  radius: number
  obstacleType: RiverDriftObstacleType
  active: boolean
  hit: boolean
}

export interface RiverDriftSegment {
  id: string
  y: number
  height: number
  startCenterX: number
  endCenterX: number
  decorationVariant: number
}

export interface RiverDriftWorldFeedback {
  collectedCoinIds: string[]
  hitObstacleIds: string[]
}

/** 固定容量的世界模型在每局间重置并复用，避免训练中持续分配对象。 */
export class RiverDriftWorld {
  readonly coins: RiverDriftCoin[]
  readonly obstacles: RiverDriftObstacle[]
  readonly segments: RiverDriftSegment[]
  collectedCoins = 0
  totalCoins = 0
  spawnedObstacles = 0
  collisionCount = 0
  worldDistance = 0
  private random = new RiverDriftRandom(1)
  private nextCoinDistance = 0.16
  private nextObstacleAt = 8_000
  private coinSequence = 0
  private obstacleSequence = 0
  private segmentSequence = 0
  private lastHitElapsedMs = Number.NEGATIVE_INFINITY
  private slowdownUntilMs = 0

  constructor(
    private readonly config: RiverDriftGameConfig,
    private readonly events: TrainingGameEvents<RiverDriftTrainingResult> = {},
  ) {
    this.coins = Array.from({ length: config.coinPoolSize }, () => emptyCoin())
    this.obstacles = Array.from({ length: config.obstaclePoolSize }, () => emptyObstacle())
    this.segments = Array.from({ length: config.riverSegmentCount }, (_, index) => emptySegment(index))
  }

  reset(seed: number): void {
    this.random = new RiverDriftRandom(seed)
    this.coins.forEach((coin) => { coin.active = false })
    this.obstacles.forEach((obstacle) => { obstacle.active = false; obstacle.hit = false })
    this.collectedCoins = 0
    this.totalCoins = 0
    this.spawnedObstacles = 0
    this.collisionCount = 0
    this.worldDistance = 0
    this.nextCoinDistance = 0.16
    this.nextObstacleAt = 8_000
    this.coinSequence = 0
    this.obstacleSequence = 0
    this.segmentSequence = 0
    this.lastHitElapsedMs = Number.NEGATIVE_INFINITY
    this.slowdownUntilMs = 0
    this.resetSegments()
  }

  /** 世界更新只在有效训练时间内调用，因此暂停会自然冻结所有对象。 */
  update(dtSeconds: number, elapsedMs: number, boat: RiverDriftPoint): RiverDriftWorldFeedback {
    const feedback: RiverDriftWorldFeedback = { collectedCoinIds: [], hitObstacleIds: [] }
    const speed = this.config.worldSpeed * (elapsedMs < this.slowdownUntilMs ? this.config.hitSlowdownFactor : 1)
    const movement = Math.max(0, dtSeconds) * speed
    this.worldDistance += movement
    for (const segment of this.segments) segment.y += movement
    for (const coin of this.coins) if (coin.active) coin.y += movement
    for (const obstacle of this.obstacles) if (obstacle.active) obstacle.y += movement
    this.recycleSegments(elapsedMs)
    this.spawnDueEntities(elapsedMs)
    this.resolveCoins(boat, elapsedMs, feedback)
    this.resolveObstacles(boat, elapsedMs, feedback)
    return feedback
  }

  getRiverCenterAt(y: number): number {
    const sorted = [...this.segments].sort((first, second) => first.y - second.y)
    const segment = sorted.find((item) => y >= item.y && y <= item.y + item.height)
      ?? (y < sorted[0].y ? sorted[0] : sorted.at(-1)!)
    const ratio = Math.max(0, Math.min(1, (y - segment.y) / Math.max(0.001, segment.height)))
    return segment.startCenterX + (segment.endCenterX - segment.startCenterX) * ratio
  }

  getBoatHorizontalBounds(y: number): { minX: number; maxX: number } {
    const center = this.getRiverCenterAt(y)
    const half = this.config.riverWidthRatio / 2 - this.config.boatRadius
    return { minX: center - half, maxX: center + half }
  }

  private resetSegments(): void {
    const height = 1.68 / Math.max(1, this.segments.length)
    let previousCenter = 0.5
    for (let index = this.segments.length - 1; index >= 0; index -= 1) {
      const segment = this.segments[index]
      segment.id = `segment-${this.segmentSequence++}`
      segment.y = -0.34 + index * height
      segment.height = height
      segment.startCenterX = clampRiverCenter(previousCenter + this.random.range(-0.025, 0.025), this.config.riverWidthRatio)
      segment.endCenterX = previousCenter
      segment.decorationVariant = this.random.integer(0, 4)
      previousCenter = segment.startCenterX
      this.publishSegment(segment, 0)
    }
  }

  private recycleSegments(elapsedMs: number): void {
    for (const segment of this.segments) {
      if (segment.y <= 1.30) continue
      const top = this.segments.reduce((candidate, item) => item.y < candidate.y ? item : candidate)
      segment.id = `segment-${this.segmentSequence++}`
      segment.y = top.y - segment.height
      segment.endCenterX = top.startCenterX
      const curve = elapsedMs < 20_000 ? 0.02 : elapsedMs < 65_000 ? 0.035 : 0.05
      segment.startCenterX = clampRiverCenter(segment.endCenterX + this.random.range(-curve, curve), this.config.riverWidthRatio)
      segment.decorationVariant = this.random.integer(0, 4)
      this.publishSegment(segment, elapsedMs)
    }
  }

  private spawnDueEntities(elapsedMs: number): void {
    const stopAt = this.config.sessionDurationMs - this.config.stopSpawningBeforeEndMs
    if (elapsedMs >= stopAt) return
    while (this.worldDistance >= this.nextCoinDistance) {
      // 即使同屏金币已满也继续推进阈值，避免空位出现时集中补生成。
      this.spawnCoinPattern(elapsedMs)
      this.nextCoinDistance += this.random.range(
        this.config.coinPatternSpacingMin,
        this.config.coinPatternSpacingMax,
      )
    }
    while (elapsedMs >= this.nextObstacleAt) {
      this.spawnObstacle(elapsedMs)
      this.nextObstacleAt += this.random.range(this.config.obstacleMinIntervalMs, this.config.obstacleMaxIntervalMs)
    }
  }

  private spawnCoinPattern(elapsedMs: number): void {
    let patternType = choosePattern(elapsedMs, this.random)
    const patternId = `pattern-${this.coinSequence}`
    const center = this.getRiverCenterAt(-0.08)
    if (patternType === 'guide-left' || patternType === 'guide-right') {
      const upstreamObstacle = this.obstacles.find((item) => item.active && item.y >= -0.15 && item.y <= 0.28)
      // 引导轨迹必须绕开真实障碍；没有合适障碍时改用中立的 S 型轨迹。
      patternType = upstreamObstacle ? (upstreamObstacle.x < center ? 'guide-right' : 'guide-left') : 's-curve'
    }
    const points = buildRiverDriftCoinPattern(
      patternType,
      center,
      this.config.riverWidthRatio,
      this.config.coinItemSpacing,
    )
    const activeCoinCount = this.coins.reduce((count, coin) => count + Number(coin.active), 0)
    if (activeCoinCount + points.length > this.config.maxVisibleCoins) return
    for (const point of points) {
      const coin = this.coins.find((item) => !item.active)
      if (!coin) break
      coin.id = `coin-${this.coinSequence++}`
      coin.x = point.x
      coin.y = point.y
      coin.radius = this.config.coinRadius
      coin.patternId = patternId
      coin.patternType = patternType
      coin.active = true
      this.totalCoins += 1
      this.events.onReplayEvent?.({
        elapsedMs,
        type: 'coin-spawn',
        payload: { id: coin.id, x: coin.x, y: coin.y, radius: coin.radius, patternId, patternType },
      })
    }
  }

  private spawnObstacle(elapsedMs: number): void {
    const obstacle = this.obstacles.find((item) => !item.active)
    if (!obstacle) return
    const center = this.getRiverCenterAt(-0.10)
    const usableHalf = this.config.riverWidthRatio * 0.40
    obstacle.id = `obstacle-${this.obstacleSequence++}`
    obstacle.x = center + this.random.range(-usableHalf, usableHalf)
    obstacle.y = -0.10
    obstacle.radius = this.config.obstacleRadius
    obstacle.obstacleType = (['rock', 'stump', 'crate', 'weed'] as RiverDriftObstacleType[])[this.random.integer(0, 3)]
    obstacle.active = true
    obstacle.hit = false
    this.spawnedObstacles += 1
    this.events.onReplayEvent?.({
      elapsedMs,
      type: 'obstacle-spawn',
      payload: { id: obstacle.id, x: obstacle.x, y: obstacle.y, radius: obstacle.radius, obstacleType: obstacle.obstacleType },
    })
  }

  private resolveCoins(boat: RiverDriftPoint, elapsedMs: number, feedback: RiverDriftWorldFeedback): void {
    for (const coin of this.coins) {
      if (!coin.active) continue
      if (riverDriftCirclesOverlap({ ...boat, radius: this.config.boatRadius }, coin)) {
        coin.active = false
        this.collectedCoins += 1
        feedback.collectedCoinIds.push(coin.id)
        this.events.onReplayEvent?.({ elapsedMs, type: 'coin-collected', payload: { id: coin.id } })
      } else if (coin.y > 1.16) coin.active = false
    }
  }

  private resolveObstacles(boat: RiverDriftPoint, elapsedMs: number, feedback: RiverDriftWorldFeedback): void {
    for (const obstacle of this.obstacles) {
      if (!obstacle.active) continue
      const overlaps = riverDriftCirclesOverlap({ ...boat, radius: this.config.boatRadius }, obstacle)
      if (overlaps && canRegisterRiverDriftHit(elapsedMs, this.lastHitElapsedMs, obstacle.hit, this.config.hitInvulnerabilityMs)) {
        obstacle.hit = true
        this.lastHitElapsedMs = elapsedMs
        this.slowdownUntilMs = elapsedMs + this.config.hitSlowdownMs
        this.collisionCount += 1
        feedback.hitObstacleIds.push(obstacle.id)
        this.events.onReplayEvent?.({ elapsedMs, type: 'obstacle-hit', payload: { id: obstacle.id } })
      }
      if (obstacle.y > 1.16) obstacle.active = false
    }
  }

  private publishSegment(segment: RiverDriftSegment, elapsedMs: number): void {
    this.events.onReplayEvent?.({
      elapsedMs,
      type: 'segment-spawn',
      payload: {
        id: segment.id,
        y: segment.y,
        height: segment.height,
        startCenterX: segment.startCenterX,
        endCenterX: segment.endCenterX,
        decorationVariant: segment.decorationVariant,
      },
    })
  }
}

/** 金币轨迹先表达训练意图，再由世界对象池承载具体金币。 */
export function buildRiverDriftCoinPattern(
  type: RiverDriftCoinPatternType,
  centerX: number,
  riverWidth: number,
  itemSpacing = defaultCoinItemSpacing,
): RiverDriftPoint[] {
  const half = riverWidth * 0.34
  const values = type === 'straight' ? [0, 0, 0]
    : type === 'horizontal' ? [-0.75, 0, 0.75]
      : type === 's-curve' ? [-0.72, 0.38, 0.72, -0.38]
        : type === 'guide-left' ? [0.62, 0, -0.62]
          : [-0.62, 0, 0.62]
  return values.map((value, index) => ({ x: centerX + value * half, y: -0.06 - index * itemSpacing }))
}

// 独立默认值让旧调用方在不传新配置时仍得到一致的轨迹。
const defaultCoinItemSpacing = 0.11

/** 单障碍覆盖远低于 55%，同时给船体和安全边距留下空间。 */
export function riverDriftObstacleCoverage(obstacleRadius: number, riverWidth: number): number {
  return riverWidth <= 0 ? 1 : Math.max(0, obstacleRadius * 2) / riverWidth
}

class RiverDriftRandom {
  private state: number
  constructor(seed: number) { this.state = (Math.abs(Math.floor(seed)) || 1) >>> 0 }
  next(): number {
    this.state = (1664525 * this.state + 1013904223) >>> 0
    return this.state / 0x100000000
  }
  range(min: number, max: number): number { return min + (max - min) * this.next() }
  integer(min: number, max: number): number { return Math.floor(this.range(min, max + 1)) }
}

function choosePattern(elapsedMs: number, random: RiverDriftRandom): RiverDriftCoinPatternType {
  const candidates: RiverDriftCoinPatternType[] = elapsedMs < 20_000
    ? ['straight', 'horizontal']
    : elapsedMs < 65_000
      ? ['straight', 'horizontal', 's-curve']
      : ['horizontal', 's-curve', 'guide-left', 'guide-right']
  return candidates[random.integer(0, candidates.length - 1)]
}

function clampRiverCenter(value: number, riverWidth: number): number {
  const half = riverWidth / 2
  return Math.max(half + 0.02, Math.min(1 - half - 0.02, value))
}

function emptyCoin(): RiverDriftCoin {
  return { id: '', x: 0, y: 0, radius: 0, patternId: '', patternType: 'straight', active: false }
}

function emptyObstacle(): RiverDriftObstacle {
  return { id: '', x: 0, y: 0, radius: 0, obstacleType: 'rock', active: false, hit: false }
}

function emptySegment(index: number): RiverDriftSegment {
  return { id: `segment-pool-${index}`, y: 0, height: 0, startCenterX: 0.5, endCenterX: 0.5, decorationVariant: 0 }
}

/** 回放和测试可使用同一套初始输入，不需要了解传感器实现。 */
export function emptyRiverDriftInput(): GameInput {
  return { x: 0, y: 0, connected: false, calibrated: false, timestamp: 0 }
}
