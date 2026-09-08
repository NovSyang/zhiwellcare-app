import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js'
import type { GameInput } from '../../../core/game-input/GameInput'
import type { RiverDriftGameConfig } from '../RiverDriftGameConfig'
import type { RiverDriftBoatState } from '../RiverDriftPhysics'
import type { RiverDriftViewport } from '../RiverDriftViewport'
import { riverDriftToScreen } from '../RiverDriftViewport'
import type { RiverDriftCoin, RiverDriftObstacle, RiverDriftSegment } from '../RiverDriftWorld'

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
  private background = new Graphics()
  private waterLines = new Graphics()
  private decorations = new Container()
  private worldLayer = new Container()
  private playerLayer = new Container()
  private particleLayer = new Container()
  private debugLayer = new Container()
  private debugGraphic = new Graphics()
  private countdownText = new Text({ text: '', style: { fill: '#ffffff', fontSize: 72, fontWeight: '700', stroke: { color: '#4b7b91', width: 5 } } })
  private boat = createBoatAndMascot()
  private coinPool: SpritePool
  private obstaclePool: SpritePool
  private segmentViews: Container[]
  private particles: ParticleState[]
  private ownedTextures: Texture[] = []
  private hitShakeUntilMs = 0

  constructor(private readonly app: Application, private readonly config: RiverDriftGameConfig) {
    const coinTexture = this.makeTexture(createCoinGraphic())
    const particleTexture = this.makeTexture(new Graphics().circle(8, 8, 7).fill(0xffffff))
    const obstacleTextures = {
      rock: this.makeTexture(createRockGraphic()),
      stump: this.makeTexture(createStumpGraphic()),
      crate: this.makeTexture(createCrateGraphic()),
      weed: this.makeTexture(createWeedGraphic()),
    }
    this.coinPool = new SpritePool(this.worldLayer, config.coinPoolSize, () => new Sprite(coinTexture))
    this.obstaclePool = new SpritePool(this.worldLayer, config.obstaclePoolSize, () => new Sprite(obstacleTextures.rock))
    this.obstaclePool.textureForKind = (kind) => obstacleTextures[kind as keyof typeof obstacleTextures] ?? obstacleTextures.rock
    this.segmentViews = Array.from({ length: config.riverSegmentCount }, () => createDecorationView())
    this.segmentViews.forEach((view) => this.decorations.addChild(view))
    this.particles = Array.from({ length: config.particlePoolSize }, () => {
      const sprite = new Sprite(particleTexture)
      sprite.anchor.set(0.5)
      sprite.visible = false
      this.particleLayer.addChild(sprite)
      return { active: false, x: 0, y: 0, velocityX: 0, velocityY: 0, age: 0, duration: 0, sprite }
    })
    this.countdownText.anchor.set(0.5)
    this.debugLayer.addChild(this.debugGraphic)
    this.debugLayer.visible = config.debug
    this.app.stage.addChild(
      this.background,
      this.waterLines,
      this.decorations,
      this.worldLayer,
      this.playerLayer,
      this.particleLayer,
      this.debugLayer,
      this.countdownText,
    )
    this.playerLayer.addChild(this.boat)
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
    this.drawRiver(input.viewport, input.segments, input.elapsedMs)
    this.drawDecorations(input.viewport, input.segments)
    this.drawCoins(input.viewport, input.coins)
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

  /** 船尾水花数量很少，只用于表达持续向前漂流。 */
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
    this.ownedTextures.forEach((texture) => texture.destroy(true))
    this.ownedTextures = []
  }

  private drawRiver(viewport: RiverDriftViewport, segments: readonly RiverDriftSegment[], elapsedMs: number): void {
    this.background.clear().rect(0, 0, viewport.width, viewport.height).fill(0x93c96e)
    const left: Array<{ x: number; y: number }> = []
    const right: Array<{ x: number; y: number }> = []
    for (let index = 0; index <= 24; index += 1) {
      const y = index / 24
      const center = centerAt(segments, y)
      left.push(riverDriftToScreen({ x: center - this.config.riverWidthRatio / 2, y }, viewport))
      right.unshift(riverDriftToScreen({ x: center + this.config.riverWidthRatio / 2, y }, viewport))
    }
    this.background.poly([...left, ...right].flatMap((point) => [point.x, point.y])).fill(0x87cfe0)
    this.background.poly(left.flatMap((point) => [point.x, point.y])).stroke({ width: 7, color: 0xd1e8a1, alpha: 0.9 })
    this.background.poly([...right].reverse().flatMap((point) => [point.x, point.y])).stroke({ width: 7, color: 0xd1e8a1, alpha: 0.9 })
    this.waterLines.clear()
    for (let index = 0; index < 12; index += 1) {
      const y = ((index / 12 + elapsedMs / 8_000) % 1.1) - 0.05
      const center = centerAt(segments, y)
      const point = riverDriftToScreen({ x: center + (index % 3 - 1) * 0.09, y }, viewport)
      this.waterLines.moveTo(point.x - viewport.scale * 0.035, point.y)
        .bezierCurveTo(point.x - viewport.scale * 0.01, point.y - 4, point.x + viewport.scale * 0.01, point.y + 4, point.x + viewport.scale * 0.035, point.y)
    }
    this.waterLines.stroke({ width: 2, color: 0xffffff, alpha: 0.42 })
  }

  private drawDecorations(viewport: RiverDriftViewport, segments: readonly RiverDriftSegment[]): void {
    for (let index = 0; index < this.segmentViews.length; index += 1) {
      const view = this.segmentViews[index]
      const segment = segments[index]
      if (!segment) { view.visible = false; continue }
      view.visible = segment.y + segment.height >= -0.1 && segment.y <= 1.1
      const point = riverDriftToScreen({ x: segment.endCenterX, y: segment.y + segment.height / 2 }, viewport)
      view.position.set(point.x, point.y)
      view.scale.set(Math.max(0.55, viewport.scale / 700))
      view.rotation = (segment.decorationVariant - 2) * 0.025
    }
  }

  private drawCoins(viewport: RiverDriftViewport, coins: readonly RiverDriftCoin[]): void {
    const activeIds = new Set<string>()
    for (const coin of coins) {
      if (!coin.active) continue
      activeIds.add(coin.id)
      const sprite = this.coinPool.acquire(coin.id)
      const point = riverDriftToScreen(coin, viewport)
      sprite.position.set(point.x, point.y)
      sprite.width = sprite.height = coin.radius * 2 * viewport.scale
      sprite.rotation += 0.025
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
      sprite.position.set(point.x, point.y)
      sprite.width = sprite.height = obstacle.radius * 2.35 * viewport.scale
      sprite.alpha = obstacle.hit ? 0.58 : 1
    }
    this.obstaclePool.releaseMissing(activeIds)
  }

  private drawBoat(viewport: RiverDriftViewport, boat: RiverDriftBoatState, input: Pick<GameInput, 'x' | 'y' | 'connected'>, elapsedMs: number): void {
    const point = riverDriftToScreen(boat, viewport)
    const shake = elapsedMs < this.hitShakeUntilMs ? Math.sin(elapsedMs * 0.09) * 5 : 0
    this.boat.position.set(point.x + shake, point.y)
    this.boat.scale.set(viewport.scale / 620)
    this.boat.rotation = input.x * 0.055
    this.boat.alpha = input.connected ? 1 : 0.45
  }

  private drawParticles(viewport: RiverDriftViewport): void {
    for (const particle of this.particles) {
      if (!particle.active) continue
      const point = riverDriftToScreen(particle, viewport)
      particle.sprite.position.set(point.x, point.y)
      particle.sprite.alpha = Math.max(0, 1 - particle.age / particle.duration)
      const size = viewport.scale * 0.018 * (1 + particle.age)
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

  private makeTexture(graphic: Graphics): Texture {
    const texture = this.app.renderer.generateTexture(graphic)
    graphic.destroy()
    this.ownedTextures.push(texture)
    return texture
  }
}

/** SpritePool 维护 ID 到显示对象的绑定，并在对象离场后归还。 */
class SpritePool {
  textureForKind: ((kind: string) => Texture) | null = null
  private available: Sprite[] = []
  private active = new Map<string, Sprite>()
  constructor(parent: Container, size: number, factory: () => Sprite) {
    for (let index = 0; index < size; index += 1) {
      const sprite = factory()
      sprite.anchor.set(0.5)
      sprite.visible = false
      parent.addChild(sprite)
      this.available.push(sprite)
    }
  }
  acquire(id: string, kind = ''): Sprite {
    const existing = this.active.get(id)
    if (existing) return existing
    const sprite = this.available.pop()
    if (!sprite) return [...this.active.values()][0]
    if (this.textureForKind) sprite.texture = this.textureForKind(kind)
    sprite.visible = true
    sprite.alpha = 1
    this.active.set(id, sprite)
    return sprite
  }
  releaseMissing(ids: ReadonlySet<string>): void {
    for (const [id, sprite] of this.active) {
      if (ids.has(id)) continue
      this.active.delete(id)
      sprite.visible = false
      this.available.push(sprite)
    }
  }
  destroy(): void { this.active.clear(); this.available = [] }
}

function centerAt(segments: readonly RiverDriftSegment[], y: number): number {
  const sorted = [...segments].sort((first, second) => first.y - second.y)
  if (sorted.length === 0) return 0.5
  const segment = sorted.find((item) => y >= item.y && y <= item.y + item.height)
    ?? (y < sorted[0].y ? sorted[0] : sorted.at(-1)!)
  const ratio = Math.max(0, Math.min(1, (y - segment.y) / Math.max(0.001, segment.height)))
  return segment.startCenterX + (segment.endCenterX - segment.startCenterX) * ratio
}

function createBoatAndMascot(): Container {
  const root = new Container()
  const shadow = new Graphics().ellipse(0, 38, 75, 18).fill({ color: 0x31566c, alpha: 0.25 })
  const hull = new Graphics().moveTo(-78, 0).lineTo(78, 0).lineTo(52, 52).quadraticCurveTo(0, 72, -52, 52).closePath()
    .fill(0xf2a33a).stroke({ width: 6, color: 0xffffff })
  const seat = new Graphics().roundRect(-47, 4, 94, 24, 12).fill(0xc9782e)
  // 角色保留实体设备的蓝色半球、白色连接、白色圆弧顶部和黑色顶部区域。
  const body = new Graphics().arc(0, -12, 38, Math.PI, Math.PI * 2).lineTo(38, -12).quadraticCurveTo(0, 28, -38, -12).fill(0x9fc7df)
  const neck = new Graphics().roundRect(-14, -48, 28, 34, 12).fill(0xf4f8fa).stroke({ width: 3, color: 0x7996a9 })
  const head = new Graphics().roundRect(-39, -83, 78, 40, 20).fill(0xf4f8fa).stroke({ width: 3, color: 0x7996a9 })
  const top = new Graphics().ellipse(0, -75, 25, 10).fill(0x17232d)
  const face = new Graphics().circle(-10, -61, 3.5).circle(10, -61, 3.5).fill(0x17232d)
    .arc(0, -55, 8, 0.25, Math.PI - 0.25).stroke({ width: 2.5, color: 0x17232d })
  root.addChild(shadow, hull, seat, body, neck, head, top, face)
  return root
}

function createCoinGraphic(): Graphics {
  return new Graphics().circle(18, 18, 16).fill(0xf8d34f).stroke({ width: 4, color: 0xffffff }).circle(18, 18, 7).stroke({ width: 3, color: 0xe59c24 })
}
function createRockGraphic(): Graphics { return new Graphics().roundRect(2, 8, 42, 34, 14).fill(0x7c8791).stroke({ width: 4, color: 0xe7edf0 }) }
function createStumpGraphic(): Graphics { return new Graphics().roundRect(8, 4, 32, 42, 9).fill(0x9a673c).ellipse(24, 7, 16, 7).fill(0xc59058).stroke({ width: 3, color: 0x68452e }) }
function createCrateGraphic(): Graphics { return new Graphics().roundRect(4, 4, 40, 40, 5).fill(0xc88b45).stroke({ width: 4, color: 0xf3d4a5 }).moveTo(8, 8).lineTo(40, 40).moveTo(40, 8).lineTo(8, 40).stroke({ width: 4, color: 0x8d5a32 }) }
function createWeedGraphic(): Graphics { return new Graphics().circle(24, 30, 18).fill(0x4f9d67).moveTo(12, 36).bezierCurveTo(6, 10, 18, 8, 22, 31).moveTo(24, 34).bezierCurveTo(25, 5, 38, 8, 34, 36).stroke({ width: 6, color: 0x2f744a }) }

function createDecorationView(): Container {
  const view = new Container()
  const left = new Graphics().circle(-270, -28, 22).circle(-235, 22, 15).fill(0x4f9d58)
    .circle(-286, 34, 5).fill(0xf6cf63).circle(-220, -30, 5).fill(0xf5a3b7)
  const right = new Graphics().circle(265, 15, 24).circle(225, -28, 16).fill(0x3f8d51)
    .circle(292, -28, 6).fill(0xffffff).circle(214, 30, 5).fill(0xf6cf63)
  view.addChild(left, right)
  return view
}
