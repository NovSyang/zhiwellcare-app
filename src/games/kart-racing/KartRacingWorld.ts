import type { TrainingGameEvents } from '../../core/game/TrainingGameEvents'
import { canRegisterKartHit, kartEntityOverlaps } from './KartRacingCollision'
import type { KartRacingGameConfig } from './KartRacingGameConfig'
import type { KartState } from './KartRacingPhysics'
import type { KartRacingTrainingResult } from './KartRacingTrainingResult'

export interface KartWorldEntity {
  id: string
  distance: number
  lateral: number
  radius: number
  active: boolean
}

export type KartCoinPatternType = 'center-line' | 'left-line' | 'right-line' | 'gentle-curve' | 'avoid-left' | 'avoid-right'
export type KartObstacleType = 'cone' | 'tire-stack' | 'toolbox' | 'puddle'
export type KartItemType = 'shield' | 'boost'

export interface KartCoin extends KartWorldEntity {
  patternId: string
  patternType: KartCoinPatternType
}

export interface KartObstacle extends KartWorldEntity {
  obstacleType: KartObstacleType
  groupId: string
  hit: boolean
}

export interface KartItem extends KartWorldEntity {
  itemType: KartItemType
}

export interface KartWorldFeedback {
  collectedCoinIds: string[]
  hitObstacleIds: string[]
  collectedItems: Array<{ id: string; type: KartItemType }>
  shieldConsumed: boolean
  boostStarted: boolean
}

export interface KartCoinPatternPoint { distance: number; lateral: number }

/** 固定容量世界按赛道距离生成对象，速度变化不会改变单位距离密度。 */
export class KartRacingWorld {
  readonly coins: KartCoin[]
  readonly obstacles: KartObstacle[]
  readonly items: KartItem[]
  collectedCoins = 0
  totalCoins = 0
  spawnedObstacles = 0
  collisionCount = 0
  shieldHitsRemaining = 0
  private random = new KartRandom(1)
  private nextCoinDistance = 60
  private nextObstacleDistance = 140
  private nextItemDistance = 220
  private coinSequence = 0
  private obstacleSequence = 0
  private itemSequence = 0
  private groupSequence = 0
  private previousKartDistance = 0
  private lastHitElapsedMs = Number.NEGATIVE_INFINITY
  private slowdownUntilMs = 0
  private boostUntilMs = 0
  private boostEndPublished = true

  constructor(
    private readonly config: KartRacingGameConfig,
    private readonly events: TrainingGameEvents<KartRacingTrainingResult> = {},
  ) {
    this.coins = Array.from({ length: config.coinPoolSize }, () => emptyCoin())
    this.obstacles = Array.from({ length: config.obstaclePoolSize }, () => emptyObstacle())
    this.items = Array.from({ length: config.itemPoolSize }, () => emptyItem())
  }

  reset(seed: number): void {
    this.random = new KartRandom(seed)
    this.coins.forEach((coin) => { coin.active = false })
    this.obstacles.forEach((obstacle) => { obstacle.active = false; obstacle.hit = false })
    this.items.forEach((item) => { item.active = false })
    this.collectedCoins = 0
    this.totalCoins = 0
    this.spawnedObstacles = 0
    this.collisionCount = 0
    this.shieldHitsRemaining = 0
    this.nextCoinDistance = 60
    this.nextObstacleDistance = 140
    this.nextItemDistance = 220
    this.coinSequence = 0
    this.obstacleSequence = 0
    this.itemSequence = 0
    this.groupSequence = 0
    this.previousKartDistance = 0
    this.lastHitElapsedMs = Number.NEGATIVE_INFINITY
    this.slowdownUntilMs = 0
    this.boostUntilMs = 0
    this.boostEndPublished = true
  }

  /** 当前效果由有效训练时间驱动，因此暂停期间会自然冻结。 */
  getPhysicsEffects(elapsedMs: number): { slowdownFactor: number; boostFactor: number } {
    return {
      slowdownFactor: elapsedMs < this.slowdownUntilMs ? this.config.hitSlowdownFactor : 1,
      boostFactor: elapsedMs < this.boostUntilMs ? this.config.boostFactor : 1,
    }
  }

  update(elapsedMs: number, kart: KartState): KartWorldFeedback {
    const feedback: KartWorldFeedback = {
      collectedCoinIds: [],
      hitObstacleIds: [],
      collectedItems: [],
      shieldConsumed: false,
      boostStarted: false,
    }
    if (!this.boostEndPublished && elapsedMs >= this.boostUntilMs) {
      this.boostEndPublished = true
      this.events.onReplayEvent?.({ elapsedMs, type: 'boost-end' })
    }
    this.spawnDueEntities(elapsedMs, kart.distance)
    this.resolveCoins(elapsedMs, kart, feedback)
    this.resolveObstacles(elapsedMs, kart, feedback)
    this.resolveItems(elapsedMs, kart, feedback)
    this.releasePassedEntities(kart.distance)
    this.previousKartDistance = kart.distance
    return feedback
  }

  private spawnDueEntities(elapsedMs: number, kartDistance: number): void {
    const stopAt = this.config.trackLength - this.config.stopSpawningBeforeEndDistance
    const visibleUntil = Math.min(stopAt, kartDistance + this.config.spawnLookAheadDistance)
    while (this.nextCoinDistance <= visibleUntil) {
      this.spawnCoinPattern(elapsedMs, this.nextCoinDistance)
      this.nextCoinDistance += this.random.range(this.config.coinPatternSpacingMin, this.config.coinPatternSpacingMax)
    }
    while (this.nextObstacleDistance <= visibleUntil) {
      this.spawnObstacleGroup(elapsedMs, this.nextObstacleDistance)
      this.nextObstacleDistance += this.random.range(this.config.obstacleSpacingMin, this.config.obstacleSpacingMax)
    }
    while (this.nextItemDistance <= visibleUntil) {
      this.spawnItem(elapsedMs, this.nextItemDistance)
      this.nextItemDistance += this.random.range(this.config.itemSpacingMin, this.config.itemSpacingMax)
    }
  }

  private spawnCoinPattern(elapsedMs: number, distance: number): void {
    const types: KartCoinPatternType[] = ['center-line', 'left-line', 'right-line', 'gentle-curve', 'avoid-left', 'avoid-right']
    const patternType = types[this.random.integer(0, types.length - 1)]
    const patternId = `coin-pattern-${this.coinSequence}`
    const points = buildKartCoinPattern(patternType, distance, this.config.coinItemSpacing)
    const activeCount = this.coins.reduce((count, coin) => count + Number(coin.active), 0)
    if (activeCount + points.length > this.config.maxVisibleCoins) return
    for (const point of points) {
      const coin = this.coins.find((item) => !item.active)
      if (!coin) break
      Object.assign(coin, {
        id: `coin-${this.coinSequence++}`,
        distance: point.distance,
        lateral: point.lateral,
        radius: 0.085,
        patternId,
        patternType,
        active: true,
      })
      this.totalCoins += 1
      this.events.onReplayEvent?.({
        elapsedMs,
        type: 'coin-spawn',
        payload: { id: coin.id, distance: coin.distance, lateral: coin.lateral, radius: coin.radius, kind: patternType },
      })
    }
  }

  private spawnObstacleGroup(elapsedMs: number, distance: number): void {
    const lanes = [-0.62, 0, 0.62]
    const safeIndex = this.random.integer(0, lanes.length - 1)
    const blocked = lanes.filter((_, index) => index !== safeIndex)
    const count = this.random.next() < 0.62 ? 1 : 2
    const groupId = `obstacle-group-${this.groupSequence++}`
    for (let index = 0; index < count; index += 1) {
      const obstacle = this.obstacles.find((item) => !item.active)
      if (!obstacle) break
      const obstacleType = (['cone', 'tire-stack', 'toolbox', 'puddle'] as KartObstacleType[])[this.random.integer(0, 3)]
      Object.assign(obstacle, {
        id: `obstacle-${this.obstacleSequence++}`,
        distance: distance + index * 1.8,
        lateral: blocked[index],
        radius: obstacleType === 'puddle' ? 0.18 : 0.145,
        obstacleType,
        groupId,
        active: true,
        hit: false,
      })
      this.spawnedObstacles += 1
      this.events.onReplayEvent?.({
        elapsedMs,
        type: 'obstacle-spawn',
        payload: { id: obstacle.id, distance: obstacle.distance, lateral: obstacle.lateral, radius: obstacle.radius, kind: obstacleType },
      })
    }
    // 在障碍前放置三枚金币，直接提示本组保留的安全路线。
    this.spawnGuideCoins(elapsedMs, distance - 24, lanes[safeIndex], groupId)
  }

  private spawnGuideCoins(elapsedMs: number, distance: number, lateral: number, groupId: string): void {
    for (let index = 0; index < 3; index += 1) {
      const coin = this.coins.find((item) => !item.active)
      if (!coin || this.coins.filter((item) => item.active).length >= this.config.maxVisibleCoins) return
      Object.assign(coin, {
        id: `coin-${this.coinSequence++}`,
        distance: distance + index * this.config.coinItemSpacing,
        lateral: lateral * ((index + 1) / 3),
        radius: 0.085,
        patternId: `guide-${groupId}`,
        patternType: lateral < 0 ? 'avoid-left' : 'avoid-right',
        active: true,
      })
      this.totalCoins += 1
      this.events.onReplayEvent?.({
        elapsedMs,
        type: 'coin-spawn',
        payload: { id: coin.id, distance: coin.distance, lateral: coin.lateral, radius: coin.radius, kind: coin.patternType },
      })
    }
  }

  private spawnItem(elapsedMs: number, distance: number): void {
    const item = this.items.find((candidate) => !candidate.active)
    if (!item) return
    const itemType: KartItemType = this.itemSequence % 2 === 0 ? 'shield' : 'boost'
    Object.assign(item, {
      id: `item-${this.itemSequence++}`,
      distance,
      lateral: [-0.55, 0, 0.55][this.random.integer(0, 2)],
      radius: 0.12,
      itemType,
      active: true,
    })
    this.events.onReplayEvent?.({
      elapsedMs,
      type: 'item-spawn',
      payload: { id: item.id, distance: item.distance, lateral: item.lateral, radius: item.radius, kind: itemType },
    })
  }

  private resolveCoins(elapsedMs: number, kart: KartState, feedback: KartWorldFeedback): void {
    for (const coin of this.coins) {
      if (!coin.active || !this.overlapsKart(kart, coin)) continue
      coin.active = false
      this.collectedCoins += 1
      feedback.collectedCoinIds.push(coin.id)
      this.events.onReplayEvent?.({ elapsedMs, type: 'coin-collected', payload: { id: coin.id } })
    }
  }

  private resolveObstacles(elapsedMs: number, kart: KartState, feedback: KartWorldFeedback): void {
    for (const obstacle of this.obstacles) {
      if (!obstacle.active || !this.overlapsKart(kart, obstacle)) continue
      if (!canRegisterKartHit(elapsedMs, this.lastHitElapsedMs, obstacle.hit, this.config.hitInvulnerabilityMs)) continue
      obstacle.hit = true
      this.lastHitElapsedMs = elapsedMs
      this.collisionCount += 1
      feedback.hitObstacleIds.push(obstacle.id)
      let slowdownApplied = true
      if (this.shieldHitsRemaining > 0) {
        this.shieldHitsRemaining -= 1
        feedback.shieldConsumed = true
        slowdownApplied = false
        this.events.onReplayEvent?.({ elapsedMs, type: 'shield-consumed', payload: { id: obstacle.id } })
      } else {
        this.slowdownUntilMs = elapsedMs + this.config.hitSlowdownMs
      }
      this.events.onReplayEvent?.({ elapsedMs, type: 'obstacle-hit', payload: { id: obstacle.id, slowdownApplied } })
    }
  }

  private resolveItems(elapsedMs: number, kart: KartState, feedback: KartWorldFeedback): void {
    for (const item of this.items) {
      if (!item.active || !this.overlapsKart(kart, item)) continue
      item.active = false
      feedback.collectedItems.push({ id: item.id, type: item.itemType })
      this.events.onReplayEvent?.({ elapsedMs, type: 'item-collected', payload: { id: item.id } })
      if (item.itemType === 'shield') {
        this.shieldHitsRemaining = Math.max(1, this.config.shieldHitCount)
        this.events.onReplayEvent?.({ elapsedMs, type: 'shield-activated', payload: { id: item.id } })
      } else {
        this.boostUntilMs = Math.max(this.boostUntilMs, elapsedMs) + this.config.boostDurationMs
        this.boostEndPublished = false
        feedback.boostStarted = true
        this.events.onReplayEvent?.({ elapsedMs, type: 'boost-start', payload: { id: item.id } })
      }
    }
  }

  private overlapsKart(kart: KartState, entity: KartWorldEntity): boolean {
    return kartEntityOverlaps(
      this.previousKartDistance,
      kart.distance,
      kart.lateral,
      entity,
      this.config.kartCollisionRadius,
      this.config.collisionDepth,
    )
  }

  private releasePassedEntities(kartDistance: number): void {
    const behind = kartDistance - this.config.collisionDepth - 2
    for (const entity of [...this.coins, ...this.obstacles, ...this.items]) {
      if (entity.active && entity.distance < behind) entity.active = false
    }
  }
}

/** 金币轨迹使用固定空间间距，既可收集也可承担路线引导。 */
export function buildKartCoinPattern(type: KartCoinPatternType, distance: number, spacing: number): KartCoinPatternPoint[] {
  const lanes = type === 'center-line' ? [0, 0, 0, 0]
    : type === 'left-line' ? [-0.56, -0.56, -0.56, -0.56]
      : type === 'right-line' ? [0.56, 0.56, 0.56, 0.56]
        : type === 'gentle-curve' ? [-0.48, -0.18, 0.18, 0.48]
          : type === 'avoid-left' ? [0.25, -0.05, -0.35, -0.58]
            : [-0.25, 0.05, 0.35, 0.58]
  return lanes.map((lateral, index) => ({ distance: distance + index * Math.max(1, spacing), lateral }))
}

/** 障碍组最多占用三条候选路线中的两条。 */
export function kartObstacleGroupHasSafeLane(obstacles: readonly Pick<KartObstacle, 'lateral'>[]): boolean {
  const lanes = [-0.62, 0, 0.62]
  return lanes.some((lane) => obstacles.every((obstacle) => Math.abs(obstacle.lateral - lane) > 0.30))
}

class KartRandom {
  private state: number
  constructor(seed: number) { this.state = (Math.abs(Math.floor(seed)) || 1) >>> 0 }
  next(): number {
    this.state = (1664525 * this.state + 1013904223) >>> 0
    return this.state / 0x100000000
  }
  range(min: number, max: number): number { return min + (max - min) * this.next() }
  integer(min: number, max: number): number { return Math.floor(this.range(min, max + 1)) }
}

function emptyCoin(): KartCoin {
  return { id: '', distance: 0, lateral: 0, radius: 0, active: false, patternId: '', patternType: 'center-line' }
}

function emptyObstacle(): KartObstacle {
  return { id: '', distance: 0, lateral: 0, radius: 0, active: false, obstacleType: 'cone', groupId: '', hit: false }
}

function emptyItem(): KartItem {
  return { id: '', distance: 0, lateral: 0, radius: 0, active: false, itemType: 'shield' }
}
