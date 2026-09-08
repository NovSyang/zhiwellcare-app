import { Application, Container } from 'pixi.js'
import type { RiverDriftGameConfig } from '../RiverDriftGameConfig'
import type { RiverDriftBoatState } from '../RiverDriftPhysics'
import { createRiverDriftViewport, riverDriftToScreen } from '../RiverDriftViewport'
import type { RiverDriftObstacleType, RiverDriftSegment } from '../RiverDriftWorld'
import { RiverDriftEnvironmentRenderer } from './RiverDriftEnvironmentRenderer'
import { riverDriftBoatScale, riverDriftPerspectiveScale, riverDriftShadowStyle } from './RiverDriftPerspective'
import { RiverDriftSpritePool } from './RiverDriftSpritePool'
import {
  createRiverDriftBoatVisual,
  createRiverDriftSprite,
  createRiverDriftTextureSet,
  updateRiverDriftMascot,
} from './RiverDriftVisualFactory'

export interface ReplayCoinVisualState { id: string; x: number; y: number; radius: number }
export interface ReplayObstacleVisualState { id: string; x: number; y: number; radius: number; obstacleType: RiverDriftObstacleType; hit: boolean }

/** 动态回放拥有独立场景，但复用正式训练的样式、透视、纹理和角色工厂。 */
export class RiverDriftDynamicReplayArt {
  static readonly usesSharedFactories = true
  readonly usesSharedFactories = true
  private readonly environment: RiverDriftEnvironmentRenderer
  private readonly worldLayer = new Container({ label: 'replay-world' })
  private readonly textures
  private readonly coinPool: RiverDriftSpritePool
  private readonly obstaclePool: RiverDriftSpritePool
  private readonly boat = createRiverDriftBoatVisual()

  constructor(private readonly app: Application, config: RiverDriftGameConfig) {
    this.environment = new RiverDriftEnvironmentRenderer(config)
    this.textures = createRiverDriftTextureSet(app)
    this.worldLayer.sortableChildren = true
    this.coinPool = new RiverDriftSpritePool(this.worldLayer, config.coinPoolSize, () => createRiverDriftSprite(this.textures.coin))
    this.obstaclePool = new RiverDriftSpritePool(this.worldLayer, config.obstaclePoolSize, () => createRiverDriftSprite(this.textures.obstacles.rock))
    this.obstaclePool.textureForKind = (kind) => this.textures.obstacles[kind as RiverDriftObstacleType] ?? this.textures.obstacles.rock
    this.worldLayer.addChild(this.boat.root)
    app.stage.addChild(this.environment.background, this.environment.waterLines, this.environment.decorations, this.worldLayer)
  }

  render(input: {
    segments: readonly RiverDriftSegment[]
    coins: readonly ReplayCoinVisualState[]
    obstacles: readonly ReplayObstacleVisualState[]
    boat: RiverDriftBoatState
    elapsedMs: number
    hit: boolean
  }): void {
    const viewport = createRiverDriftViewport(this.app.screen.width, this.app.screen.height)
    this.environment.render(viewport, input.segments, input.elapsedMs)
    const coinIds = new Set<string>()
    for (const coin of input.coins) {
      coinIds.add(coin.id)
      const sprite = this.coinPool.acquire(coin.id)
      const point = riverDriftToScreen(coin, viewport)
      const phase = stablePhase(coin.id)
      const breath = 1 + Math.sin(input.elapsedMs / 520 + phase) * 0.035
      const size = coin.radius * 2.25 * viewport.scale * riverDriftPerspectiveScale(coin.y)
      sprite.position.set(point.x, point.y + Math.sin(input.elapsedMs / 420 + phase) * 2)
      sprite.width = size * breath
      sprite.height = size * (0.96 + (breath - 1) * 0.55)
      sprite.zIndex = Math.round(coin.y * 1_000)
    }
    this.coinPool.releaseMissing(coinIds)

    const obstacleIds = new Set<string>()
    for (const obstacle of input.obstacles) {
      obstacleIds.add(obstacle.id)
      const sprite = this.obstaclePool.acquire(obstacle.id, obstacle.obstacleType)
      const point = riverDriftToScreen(obstacle, viewport)
      const size = obstacle.radius * 2.45 * viewport.scale * riverDriftPerspectiveScale(obstacle.y)
      sprite.position.set(point.x, point.y)
      sprite.width = sprite.height = size
      sprite.alpha = obstacle.hit ? 0.58 : 1
      sprite.zIndex = Math.round(obstacle.y * 1_000)
    }
    this.obstaclePool.releaseMissing(obstacleIds)

    const point = riverDriftToScreen(input.boat, viewport)
    const scale = viewport.scale / 620 * riverDriftBoatScale(input.boat.y)
    const shadow = riverDriftShadowStyle(input.boat.y)
    const shake = input.hit ? Math.sin(input.elapsedMs * 0.09) * 5 : 0
    this.boat.root.position.set(point.x + shake, point.y)
    this.boat.root.scale.set(scale)
    this.boat.root.rotation = input.boat.velocityX * 0.08
    this.boat.root.zIndex = Math.round(input.boat.y * 1_000)
    this.boat.shadow.alpha = shadow.alpha
    this.boat.shadow.scale.x = shadow.scaleX
    updateRiverDriftMascot(this.boat.mascot, input.elapsedMs, input.hit, -input.boat.velocityX * 0.025)
  }

  /** 轨迹模式开启时隐藏整套动态场景，避免两种视图相互叠加。 */
  setVisible(visible: boolean): void {
    this.environment.background.visible = visible
    this.environment.waterLines.visible = visible
    this.environment.decorations.visible = visible
    this.worldLayer.visible = visible
  }

  destroy(): void {
    this.coinPool.destroy()
    this.obstaclePool.destroy()
    this.environment.background.removeFromParent()
    this.environment.waterLines.removeFromParent()
    this.environment.decorations.removeFromParent()
    this.worldLayer.removeFromParent()
    this.environment.background.destroy()
    this.environment.waterLines.destroy()
    this.environment.decorations.destroy({ children: true })
    this.worldLayer.destroy({ children: true })
    this.environment.destroy()
    this.textures.destroy()
  }
}

/** 与正式训练相同的稳定相位让 Seek 前后动画保持一致。 */
function stablePhase(id: string): number {
  let value = 0
  for (let index = 0; index < id.length; index += 1) value = (value * 31 + id.charCodeAt(index)) >>> 0
  return value % 628 / 100
}
