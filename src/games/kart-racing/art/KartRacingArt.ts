import { Application, Container, Graphics, Sprite, Text } from 'pixi.js'
import type { GameInput } from '../../../core/game-input/GameInput'
import { updateMascotVisual } from '../../../shared/game-art/mascot/MascotVisualFactory'
import type { KartRacingGameConfig } from '../KartRacingGameConfig'
import type { KartState } from '../KartRacingPhysics'
import type { KartTrackSegment } from '../KartRacingTrack'
import type { KartRacingViewport } from '../KartRacingViewport'
import type { KartCoin, KartItem, KartObstacle, KartWorldEntity } from '../KartRacingWorld'
import { KartEnvironmentRenderer } from './KartEnvironmentRenderer'
import { kartPlayerLateralHalfWidth, projectKartEntity } from './KartPerspective'
import { KartSpritePool } from './KartSpritePool'
import { KartTrackRenderer } from './KartTrackRenderer'
import { createKartSprite, createKartTextureSet, createKartVisual, type KartTextureSet, type KartVisual } from './KartVisualFactory'
import { kartColors } from './KartVisualStyle'

interface KartParticle {
  sprite: Sprite
  active: boolean
  x: number
  y: number
  velocityX: number
  velocityY: number
  age: number
  duration: number
}

export interface KartRacingArtState {
  viewport: KartRacingViewport
  track: readonly KartTrackSegment[]
  coins: readonly KartCoin[]
  obstacles: readonly KartObstacle[]
  items: readonly KartItem[]
  kart: KartState
  gameInput: Pick<GameInput, 'x' | 'y' | 'connected'>
  elapsedMs: number
  countdownRemainingMs: number
  state: string
  progress: number
  shieldActive: boolean
  boostActive: boolean
  finishing: boolean
}

/** 训练与回放共用的完整 Pixi 场景，只负责表现、不修改游戏规则。 */
export class KartRacingArt {
  private root = new Container({ label: 'kart-racing-scene' })
  private environment: KartEnvironmentRenderer
  private trackRenderer: KartTrackRenderer
  private entityLayer = new Container({ label: 'kart-entities', sortableChildren: true })
  private effectLayer = new Container({ label: 'kart-effects' })
  private overlay = new Graphics({ label: 'kart-overlay' })
  private speedLines = new Graphics({ label: 'kart-speed-lines' })
  private shieldHalo = new Graphics({ label: 'kart-shield-halo' })
  private countdownText = new Text({ text: '', style: { fontFamily: 'sans-serif', fontSize: 72, fontWeight: '800', fill: 0xffffff, stroke: { color: 0x194e70, width: 8 } } })
  private finishText = new Text({ text: '完成！', style: { fontFamily: 'sans-serif', fontSize: 54, fontWeight: '800', fill: 0xfff2a8, stroke: { color: 0x245f8e, width: 8 } } })
  private kart: KartVisual
  private textures: KartTextureSet
  private coinPool: KartSpritePool
  private obstaclePool: KartSpritePool
  private itemPool: KartSpritePool
  private particles: KartParticle[]
  private hitShakeUntilMs = 0
  private lastState: KartRacingArtState | null = null

  constructor(app: Application, private readonly config: KartRacingGameConfig) {
    this.root.sortableChildren = true
    app.stage.addChild(this.root)
    this.environment = new KartEnvironmentRenderer(this.root)
    this.trackRenderer = new KartTrackRenderer(this.root)
    this.root.addChild(this.speedLines, this.entityLayer, this.effectLayer)
    this.textures = createKartTextureSet(app)
    this.coinPool = new KartSpritePool(this.entityLayer, config.coinPoolSize, () => createKartSprite(this.textures.coin))
    this.obstaclePool = new KartSpritePool(this.entityLayer, config.obstaclePoolSize, () => createKartSprite(this.textures.obstacles.cone))
    this.obstaclePool.textureForKind = (kind) => this.textures.obstacles[kind as keyof typeof this.textures.obstacles] ?? this.textures.obstacles.cone
    this.itemPool = new KartSpritePool(this.entityLayer, config.itemPoolSize, () => createKartSprite(this.textures.items.shield))
    this.itemPool.textureForKind = (kind) => this.textures.items[kind as keyof typeof this.textures.items] ?? this.textures.items.shield
    this.kart = createKartVisual()
    this.root.addChild(this.shieldHalo, this.kart.root, this.overlay, this.countdownText, this.finishText)
    this.countdownText.anchor.set(0.5)
    this.finishText.anchor.set(0.5)
    this.finishText.visible = false
    this.particles = Array.from({ length: config.particlePoolSize }, () => {
      const sprite = createKartSprite(this.textures.particle)
      sprite.visible = false
      this.effectLayer.addChild(sprite)
      return { sprite, active: false, x: 0, y: 0, velocityX: 0, velocityY: 0, age: 0, duration: 0 }
    })
  }

  render(state: KartRacingArtState): void {
    this.lastState = state
    const visibleDistance = this.config.spawnLookAheadDistance
    this.environment.render(state.viewport, state.kart.distance)
    this.trackRenderer.render({
      viewport: state.viewport,
      track: state.track,
      kartDistance: state.kart.distance,
      trackLength: this.config.trackLength,
      visibleDistance,
    })
    this.drawSpeedLines(state)
    this.drawCoins(state, visibleDistance)
    this.drawObstacles(state, visibleDistance)
    this.drawItems(state, visibleDistance)
    this.drawKart(state)
    this.drawParticles()
    this.drawOverlay(state)
  }

  /** 回放在动态画面与轨迹画面之间切换时复用同一场景。 */
  setVisible(visible: boolean): void {
    this.root.visible = visible
  }
  /** 命中只产生轻微反馈，训练不会中断。 */
  spawnHitFeedback(elapsedMs: number): void {
    this.hitShakeUntilMs = elapsedMs + 380
    this.spawnBurstAtKart(10, 0xffd9a3)
  }

  spawnCoinFeedback(entity: KartWorldEntity): void {
    this.spawnBurstAtEntity(entity, 5, kartColors.coin)
  }

  spawnItemFeedback(entity: KartWorldEntity, color: number): void {
    this.spawnBurstAtEntity(entity, 9, color)
  }

  updateParticles(dtSeconds: number): void {
    for (const particle of this.particles) {
      if (!particle.active) continue
      particle.age += Math.max(0, dtSeconds)
      particle.x += particle.velocityX * dtSeconds
      particle.y += particle.velocityY * dtSeconds
      particle.velocityY += 38 * dtSeconds
      if (particle.age >= particle.duration) {
        particle.active = false
        particle.sprite.visible = false
      }
    }
  }

  destroy(): void {
    this.coinPool.destroy()
    this.obstaclePool.destroy()
    this.itemPool.destroy()
    this.environment.destroy()
    this.trackRenderer.destroy()
    this.textures.destroy()
    this.root.destroy({ children: true })
  }

  private drawCoins(state: KartRacingArtState, visibleDistance: number): void {
    const ids = new Set<string>()
    for (const coin of state.coins) {
      if (!coin.active) continue
      const projection = projectKartEntity({ entityDistance: coin.distance, entityLateral: coin.lateral, kartDistance: state.kart.distance, visibleDistance, track: state.track, viewport: state.viewport })
      if (!projection.visible) continue
      const sprite = this.coinPool.acquire(coin.id)
      if (!sprite) continue
      ids.add(coin.id)
      const size = state.viewport.scale * 0.075 * projection.scale
      sprite.position.set(projection.screenX, projection.screenY + Math.sin(state.elapsedMs / 320 + stablePhase(coin.id)) * 3)
      sprite.width = sprite.height = size
      sprite.zIndex = Math.round(projection.depth * 1_000)
    }
    this.coinPool.releaseMissing(ids)
  }

  private drawObstacles(state: KartRacingArtState, visibleDistance: number): void {
    const ids = new Set<string>()
    for (const obstacle of state.obstacles) {
      if (!obstacle.active) continue
      const projection = projectKartEntity({ entityDistance: obstacle.distance, entityLateral: obstacle.lateral, kartDistance: state.kart.distance, visibleDistance, track: state.track, viewport: state.viewport })
      if (!projection.visible) continue
      const sprite = this.obstaclePool.acquire(obstacle.id, obstacle.obstacleType)
      if (!sprite) continue
      ids.add(obstacle.id)
      const size = state.viewport.scale * (obstacle.obstacleType === 'puddle' ? 0.105 : 0.09) * projection.scale
      sprite.position.set(projection.screenX, projection.screenY)
      sprite.width = size
      sprite.height = obstacle.obstacleType === 'puddle' ? size * 0.48 : size
      sprite.alpha = obstacle.hit ? 0.48 : 1
      sprite.zIndex = Math.round(projection.depth * 1_000)
    }
    this.obstaclePool.releaseMissing(ids)
  }

  private drawItems(state: KartRacingArtState, visibleDistance: number): void {
    const ids = new Set<string>()
    for (const item of state.items) {
      if (!item.active) continue
      const projection = projectKartEntity({ entityDistance: item.distance, entityLateral: item.lateral, kartDistance: state.kart.distance, visibleDistance, track: state.track, viewport: state.viewport })
      if (!projection.visible) continue
      const sprite = this.itemPool.acquire(item.id, item.itemType)
      if (!sprite) continue
      ids.add(item.id)
      const pulse = 1 + Math.sin(state.elapsedMs / 220 + stablePhase(item.id)) * 0.06
      const size = state.viewport.scale * 0.09 * projection.scale * pulse
      sprite.position.set(projection.screenX, projection.screenY - 3)
      sprite.width = sprite.height = size
      sprite.zIndex = Math.round(projection.depth * 1_000)
    }
    this.itemPool.releaseMissing(ids)
  }

  private drawKart(state: KartRacingArtState): void {
    const speedRatio = clamp((state.kart.speed - this.config.minSpeed) / (this.config.maxSpeed - this.config.minSpeed), 0, 1)
    const throttle = Math.max(0, state.gameInput.y)
    const braking = Math.max(0, -state.gameInput.y)
    const hit = state.elapsedMs < this.hitShakeUntilMs
    const shake = hit ? Math.sin(state.elapsedMs * 0.12) * 5 : 0
    const roadHalfWidth = kartPlayerLateralHalfWidth(state.viewport)
    const scale = state.viewport.scale / 720
    this.kart.root.position.set(state.viewport.width / 2 + state.kart.lateral * roadHalfWidth + shake, state.viewport.kartY + throttle * 4 - braking * 3)
    this.kart.root.scale.set(scale)
    this.kart.root.rotation = state.gameInput.x * 0.035
    this.kart.root.alpha = state.gameInput.connected ? 1 : 0.50
    this.kart.steeringWheel.rotation = state.gameInput.x * 0.42
    this.kart.brakeLights.alpha = braking > this.config.throttleNeutralThreshold ? 1 : 0.25
    this.kart.shadow.scale.x = 1 + speedRatio * 0.04
    updateMascotVisual(this.kart.mascot, state.elapsedMs, { steering: state.gameInput.x, throttle, braking, hit, celebrating: state.finishing })
    this.shieldHalo.clear()
    if (state.shieldActive) {
      this.shieldHalo.circle(this.kart.root.x, this.kart.root.y - 20 * scale, 92 * scale).fill({ color: kartColors.shield, alpha: 0.10 }).stroke({ width: 4, color: 0xb9f3ff, alpha: 0.78 })
    }
  }

  private drawSpeedLines(state: KartRacingArtState): void {
    const graphic = this.speedLines.clear()
    const speedRatio = clamp((state.kart.speed - this.config.cruiseSpeed) / Math.max(1, this.config.maxSpeed - this.config.cruiseSpeed), 0, 1)
    const count = Math.round(speedRatio * 10) + (state.boostActive ? 5 : 0)
    for (let index = 0; index < count; index += 1) {
      const side = index % 2 === 0 ? -1 : 1
      const lane = 0.30 + (index % 5) * 0.09
      const x = state.viewport.width / 2 + side * state.viewport.width * lane
      const y = state.viewport.horizonY + ((state.elapsedMs * (0.22 + speedRatio * 0.18) + index * 83) % (state.viewport.height - state.viewport.horizonY))
      graphic.moveTo(x, y).lineTo(x + side * 16, y + 38 + speedRatio * 45).stroke({ width: 2, color: 0xffffff, alpha: 0.25 + speedRatio * 0.35 })
    }
  }

  private drawOverlay(state: KartRacingArtState): void {
    const graphic = this.overlay.clear()
    const width = Math.min(240, state.viewport.width * 0.28)
    const x = state.viewport.width - width - 22
    const y = state.viewport.safeTop + 8
    const speedRatio = clamp((state.kart.speed - this.config.minSpeed) / Math.max(1, this.config.maxSpeed - this.config.minSpeed), 0, 1)
    graphic.roundRect(x, y, width, 52, 14).fill({ color: 0x153d55, alpha: 0.72 })
    graphic.roundRect(x + 14, y + 12, width - 28, 10, 5).fill({ color: 0xffffff, alpha: 0.20 })
    graphic.roundRect(x + 14, y + 12, (width - 28) * speedRatio, 10, 5).fill(state.boostActive ? kartColors.boost : kartColors.shield)
    graphic.roundRect(x + 14, y + 34, width - 28, 6, 3).fill({ color: 0xffffff, alpha: 0.20 })
    graphic.roundRect(x + 14, y + 34, (width - 28) * clamp(state.progress, 0, 1), 6, 3).fill(kartColors.kartAccent)

    this.countdownText.visible = state.state === 'countdown'
    if (this.countdownText.visible) {
      this.countdownText.text = String(Math.max(1, Math.ceil(state.countdownRemainingMs / 1_000)))
      this.countdownText.position.set(state.viewport.width / 2, state.viewport.height / 2)
    }
    this.finishText.visible = state.finishing
    if (state.finishing) {
      this.finishText.position.set(state.viewport.width / 2, state.viewport.height * 0.40)
      this.finishText.scale.set(1 + Math.sin(state.elapsedMs / 90) * 0.04)
    }
  }

  private drawParticles(): void {
    for (const particle of this.particles) {
      if (!particle.active) continue
      particle.sprite.position.set(particle.x, particle.y)
      particle.sprite.alpha = Math.max(0, 1 - particle.age / particle.duration)
      const size = 7 + particle.age * 10
      particle.sprite.width = particle.sprite.height = size
    }
  }

  private spawnBurstAtKart(count: number, color: number): void {
    const state = this.lastState
    if (!state) return
    const roadHalfWidth = kartPlayerLateralHalfWidth(state.viewport)
    this.activateBurst(state.viewport.width / 2 + state.kart.lateral * roadHalfWidth, state.viewport.kartY, count, color)
  }

  private spawnBurstAtEntity(entity: KartWorldEntity, count: number, color: number): void {
    const state = this.lastState
    if (!state) return
    const projection = projectKartEntity({ entityDistance: entity.distance, entityLateral: entity.lateral, kartDistance: state.kart.distance, visibleDistance: this.config.spawnLookAheadDistance, track: state.track, viewport: state.viewport })
    if (projection.visible) this.activateBurst(projection.screenX, projection.screenY, count, color)
  }

  private activateBurst(x: number, y: number, count: number, color: number): void {
    for (let index = 0; index < count; index += 1) {
      const particle = this.particles.find((item) => !item.active)
      if (!particle) return
      const angle = index / Math.max(1, count) * Math.PI * 2
      Object.assign(particle, { active: true, x, y, velocityX: Math.cos(angle) * 45, velocityY: Math.sin(angle) * 38 - 18, age: 0, duration: 0.48 })
      particle.sprite.tint = color
      particle.sprite.visible = true
    }
  }
}

function stablePhase(id: string): number {
  let value = 0
  for (let index = 0; index < id.length; index += 1) value = (value * 31 + id.charCodeAt(index)) >>> 0
  return value % 628 / 100
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
}
