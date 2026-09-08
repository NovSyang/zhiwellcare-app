import { Application, Container, Graphics, Sprite, Text } from 'pixi.js'
import type { GameInput } from '../../../core/game-input/GameInput'
import type { RiverDriftGameConfig } from '../RiverDriftGameConfig'
import type { RiverDriftBoatState } from '../RiverDriftPhysics'
import type { RiverDriftViewport } from '../RiverDriftViewport'
import { riverDriftToScreen } from '../RiverDriftViewport'
import type { RiverDriftCoin, RiverDriftObstacle, RiverDriftSegment } from '../RiverDriftWorld'
import { RiverDriftEnvironmentRenderer } from './RiverDriftEnvironmentRenderer'
import { riverDriftBoatScale, riverDriftPerspectiveScale, riverDriftShadowStyle } from './RiverDriftPerspective'
import { RiverDriftSpritePool } from './RiverDriftSpritePool'
import {
  createRiverDriftBoatVisual,
  createRiverDriftSprite,
  createRiverDriftTextureSet,
  updateRiverDriftMascot,
  type BoatVisual,
  type RiverDriftTextureSet,
} from './RiverDriftVisualFactory'

interface ParticleState {
  active: boolean
  x: number
  y: number
  velocityX: number
  velocityY: number
  age: number
  duration: number
  sprite: Sprite
}

/** Pixi 场景只负责显示，碰撞、计时和结果统计仍由纯业务对象处理。 */
export class RiverDriftArt {
  private readonly environment: RiverDriftEnvironmentRenderer
  private readonly worldLayer = new Container({ label: 'river-world' })
  private readonly particleLayer = new Container({ label: 'river-particles' })
  private readonly debugLayer = new Container({ label: 'river-debug' })
  private readonly debugGraphic = new Graphics()
  private readonly countdownText = new Text({ text: '', style: { fill: '#ffffff', fontSize: 72, fontWeight: '700', stroke: { color: '#4b7b91', width: 5 } } })
  private readonly boat: BoatVisual = createRiverDriftBoatVisual()
  private readonly textures: RiverDriftTextureSet
  private readonly coinPool: RiverDriftSpritePool
  private readonly obstaclePool: RiverDriftSpritePool
  private readonly particles: ParticleState[]
  private hitShakeUntilMs = 0

  constructor(private readonly app: Application, private readonly config: RiverDriftGameConfig) {
    this.environment = new RiverDriftEnvironmentRenderer(config)
    this.textures = createRiverDriftTextureSet(app)
    this.worldLayer.sortableChildren = true
    this.coinPool = new RiverDriftSpritePool(this.worldLayer, config.coinPoolSize, () => createRiverDriftSprite(this.textures.coin))
    this.obstaclePool = new RiverDriftSpritePool(this.worldLayer, config.obstaclePoolSize, () => createRiverDriftSprite(this.textures.obstacles.rock))
    this.obstaclePool.textureForKind = (kind) => this.textures.obstacles[kind as keyof typeof this.textures.obstacles] ?? this.textures.obstacles.rock
    this.particles = Array.from({ length: config.particlePoolSize }, () => {
      const sprite = createRiverDriftSprite(this.textures.particle)
      sprite.visible = false
      this.particleLayer.addChild(sprite)
      return { active: false, x: 0, y: 0, velocityX: 0, velocityY: 0, age: 0, duration: 0, sprite }
    })
    this.countdownText.anchor.set(0.5)
    this.debugLayer.addChild(this.debugGraphic)
    this.debugLayer.visible = config.debug
    this.worldLayer.addChild(this.boat.root)
    this.app.stage.addChild(
      this.environment.background,
      this.environment.waterLines,
      this.environment.decorations,
      this.worldLayer,
      this.particleLayer,
      this.debugLayer,
      this.countdownText,
    )
  }

  render(input: {
    viewport: RiverDriftViewport
    segments: readonly RiverDriftSegment[]
    coins: readonly RiverDriftCoin[]
    obstacles: readonly RiverDriftObstacle[]
    boat: RiverDriftBoatState
    gameInput: Pick<GameInput, 'x' | 'y' | 'connected'>
    elapsedMs: number
    countdownRemainingMs: number
    state: string
  }): void {
    this.environment.render(input.viewport, input.segments, input.elapsedMs)
    this.drawCoins(input.viewport, input.coins, input.elapsedMs)
    this.drawObstacles(input.viewport, input.obstacles)
    this.drawBoat(input.viewport, input.boat, input.gameInput, input.elapsedMs)
    this.drawParticles(input.viewport)
    this.drawCountdown(input.viewport, input.countdownRemainingMs, input.state)
    if (this.config.debug) this.drawDebug(input.viewport, input.boat, input.segments, input.gameInput)
  }

  /** 粒子也使用对象池；没有空位时直接省略反馈，不能影响训练逻辑。 */
  spawnCoinBurst(point: { x: number; y: number }): void {
    for (let index = 0; index < 6; index += 1) {
      const angle = index / 6 * Math.PI * 2
      this.activateParticle(point, Math.cos(angle) * 0.12, Math.sin(angle) * 0.12, 0.45, 0xf8d34f)
    }
  }

  spawnHitSplash(point: { x: number; y: number }, elapsedMs: number): void {
    this.hitShakeUntilMs = elapsedMs + 380
    for (let index = 0; index < 10; index += 1) {
      const angle = -Math.PI + index / 9 * Math.PI
      this.activateParticle(point, Math.cos(angle) * 0.15, Math.sin(angle) * 0.10 - 0.08, 0.55, 0xffffff)
    }
  }

  /** 船尾只保留左右两滴轻量水花，避免扩大粒子开销。 */
  spawnWake(point: { x: number; y: number }): void {
    this.activateParticle({ x: point.x - 0.018, y: point.y + 0.045 }, -0.015, 0.055, 0.55, 0xffffff)
    this.activateParticle({ x: point.x + 0.018, y: point.y + 0.045 }, 0.015, 0.055, 0.55, 0xffffff)
  }

  updateParticles(dtSeconds: number): void {
    for (const particle of this.particles) {
      if (!particle.active) continue
      particle.age += dtSeconds
      particle.x += particle.velocityX * dtSeconds
      particle.y += particle.velocityY * dtSeconds
      particle.velocityY += 0.18 * dtSeconds
      if (particle.age >= particle.duration) {
        particle.active = false
        particle.sprite.visible = false
      }
    }
  }

  destroy(): void {
    this.coinPool.destroy()
    this.obstaclePool.destroy()
    this.environment.destroy()
    this.textures.destroy()
  }

  private drawCoins(viewport: RiverDriftViewport, coins: readonly RiverDriftCoin[], elapsedMs: number): void {
    const activeIds = new Set<string>()
    for (const coin of coins) {
      if (!coin.active) continue
      activeIds.add(coin.id)
      const sprite = this.coinPool.acquire(coin.id)
      const point = riverDriftToScreen(coin, viewport)
      const phase = stablePhase(coin.id)
      const float = Math.sin(elapsedMs / 420 + phase) * 2
      const breath = 1 + Math.sin(elapsedMs / 520 + phase) * 0.035
      const size = coin.radius * 2.25 * viewport.scale * riverDriftPerspectiveScale(coin.y)
      sprite.position.set(point.x, point.y + float)
      sprite.width = size * breath
      sprite.height = size * (0.96 + (breath - 1) * 0.55)
      sprite.zIndex = Math.round(coin.y * 1_000)
    }
    this.coinPool.releaseMissing(activeIds)
  }

  private drawObstacles(viewport: RiverDriftViewport, obstacles: readonly RiverDriftObstacle[]): void {
    const activeIds = new Set<string>()
    for (const obstacle of obstacles) {
      if (!obstacle.active) continue
      activeIds.add(obstacle.id)
      const sprite = this.obstaclePool.acquire(obstacle.id, obstacle.obstacleType)
      const point = riverDriftToScreen(obstacle, viewport)
      const size = obstacle.radius * 2.45 * viewport.scale * riverDriftPerspectiveScale(obstacle.y)
      sprite.position.set(point.x, point.y)
      sprite.width = sprite.height = size
      sprite.alpha = obstacle.hit ? 0.58 : 1
      sprite.zIndex = Math.round(obstacle.y * 1_000)
    }
    this.obstaclePool.releaseMissing(activeIds)
  }

  private drawBoat(viewport: RiverDriftViewport, boat: RiverDriftBoatState, input: Pick<GameInput, 'x' | 'y' | 'connected'>, elapsedMs: number): void {
    const point = riverDriftToScreen(boat, viewport)
    const hit = elapsedMs < this.hitShakeUntilMs
    const shake = hit ? Math.sin(elapsedMs * 0.09) * 5 : 0
    const scale = viewport.scale / 620 * riverDriftBoatScale(boat.y)
    const shadow = riverDriftShadowStyle(boat.y)
    this.boat.root.position.set(point.x + shake, point.y)
    this.boat.root.scale.set(scale)
    this.boat.root.rotation = input.x * 0.045
    this.boat.root.alpha = input.connected ? 1 : 0.45
    this.boat.root.zIndex = Math.round(boat.y * 1_000)
    this.boat.shadow.alpha = shadow.alpha
    this.boat.shadow.scale.x = shadow.scaleX
    updateRiverDriftMascot(this.boat.mascot, elapsedMs, hit, -input.x * 0.018)
  }

  private drawParticles(viewport: RiverDriftViewport): void {
    for (const particle of this.particles) {
      if (!particle.active) continue
      const point = riverDriftToScreen(particle, viewport)
      particle.sprite.position.set(point.x, point.y)
      particle.sprite.alpha = Math.max(0, 1 - particle.age / particle.duration)
      const size = viewport.scale * 0.018 * (1 + particle.age) * riverDriftPerspectiveScale(particle.y)
      particle.sprite.width = particle.sprite.height = size
    }
  }

  private drawCountdown(viewport: RiverDriftViewport, remainingMs: number, state: string): void {
    if (state !== 'countdown') { this.countdownText.visible = false; return }
    this.countdownText.visible = true
    this.countdownText.text = String(Math.max(1, Math.ceil(remainingMs / 1_000)))
    this.countdownText.position.set(viewport.width / 2, viewport.height / 2)
  }

  private drawDebug(viewport: RiverDriftViewport, boat: RiverDriftBoatState, segments: readonly RiverDriftSegment[], input: Pick<GameInput, 'x' | 'y'>): void {
    const center = centerAt(segments, boat.y)
    const left = riverDriftToScreen({ x: center - this.config.riverWidthRatio / 2, y: boat.y }, viewport)
    const right = riverDriftToScreen({ x: center + this.config.riverWidthRatio / 2, y: boat.y }, viewport)
    const point = riverDriftToScreen(boat, viewport)
    this.debugGraphic.clear()
      .moveTo(left.x, left.y).lineTo(right.x, right.y).stroke({ width: 2, color: 0xff4d6d })
      .circle(point.x, point.y, this.config.boatRadius * viewport.scale).stroke({ width: 2, color: 0xff4d6d })
    this.debugGraphic.rect(8, viewport.safeTop, 160, 34).fill({ color: 0x001c2b, alpha: 0.7 })
    this.debugGraphic.moveTo(88, viewport.safeTop + 17).lineTo(88 + input.x * 50, viewport.safeTop + 17 - input.y * 14).stroke({ width: 3, color: 0xffffff })
  }

  private activateParticle(point: { x: number; y: number }, velocityX: number, velocityY: number, duration: number, tint: number): void {
    const particle = this.particles.find((item) => !item.active)
    if (!particle) return
    Object.assign(particle, { active: true, x: point.x, y: point.y, velocityX, velocityY, age: 0, duration })
    particle.sprite.tint = tint
    particle.sprite.visible = true
  }
}

function centerAt(segments: readonly RiverDriftSegment[], y: number): number {
  const sorted = [...segments].sort((first, second) => first.y - second.y)
  if (sorted.length === 0) return 0.5
  const segment = sorted.find((item) => y >= item.y && y <= item.y + item.height)
    ?? (y < sorted[0].y ? sorted[0] : sorted.at(-1)!)
  const ratio = Math.max(0, Math.min(1, (y - segment.y) / Math.max(0.001, segment.height)))
  return segment.startCenterX + (segment.endCenterX - segment.startCenterX) * ratio
}

/** 字符串哈希只用于视觉相位，不会影响生成或碰撞结果。 */
function stablePhase(id: string): number {
  let value = 0
  for (let index = 0; index < id.length; index += 1) value = (value * 31 + id.charCodeAt(index)) >>> 0
  return value % 628 / 100
}
