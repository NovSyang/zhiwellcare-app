import { Application, Container, FillGradient, Graphics, Sprite, Texture } from 'pixi.js'
import { createMascotVisual, type MascotVisual } from '../../../shared/game-art/mascot/MascotVisualFactory'
import type { KartItemType, KartObstacleType } from '../KartRacingWorld'
import { kartColors } from './KartVisualStyle'

export interface KartVisual {
  root: Container
  shadow: Graphics
  body: Graphics
  wheels: Graphics[]
  steeringWheel: Graphics
  driverSlot: Container
  mascot: MascotVisual
  brakeLights: Graphics
}

export interface KartTextureSet {
  coin: Texture
  particle: Texture
  obstacles: Record<KartObstacleType, Texture>
  items: Record<KartItemType, Texture>
  destroy(): void
}

function verticalGradient(top: number, bottom: number): FillGradient | number {
  if (typeof document === 'undefined') return top
  return new FillGradient({
    type: 'linear',
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    colorStops: [{ offset: 0, color: top }, { offset: 1, color: bottom }],
    textureSpace: 'local',
  })
}

/** 角色通过 driverSlot 与车辆组合，二者仍可独立动画和复用。 */
export function createKartVisual(): KartVisual {
  const root = new Container({ label: 'kart' })
  const shadow = new Graphics({ label: 'kart-shadow' }).ellipse(0, 38, 88, 20).fill({ color: kartColors.shadow, alpha: 0.24 })
  const rearLeft = new Graphics({ label: 'rear-left-wheel' }).roundRect(-82, -2, 28, 55, 10).fill(0x23303a)
  const rearRight = new Graphics({ label: 'rear-right-wheel' }).roundRect(54, -2, 28, 55, 10).fill(0x23303a)
  const frontLeft = new Graphics({ label: 'front-left-wheel' }).roundRect(-69, 28, 23, 40, 9).fill(0x182229)
  const frontRight = new Graphics({ label: 'front-right-wheel' }).roundRect(46, 28, 23, 40, 9).fill(0x182229)
  const body = new Graphics({ label: 'kart-body' })
    .roundRect(-66, -18, 132, 78, 25).fill(verticalGradient(kartColors.kartMain, kartColors.kartShade))
    .stroke({ width: 4, color: 0xd9f4ff })
    .roundRect(-45, 19, 90, 45, 19).fill(kartColors.kartAccent)
    .roundRect(-74, 49, 148, 17, 8).fill(0x194e70)
  const driverSlot = new Container({ label: 'driver-slot' })
  driverSlot.position.set(0, -1)
  const mascot = createMascotVisual()
  mascot.homeScale = 0.72
  mascot.root.scale.set(mascot.homeScale)
  mascot.root.position.y = mascot.homeY
  driverSlot.addChild(mascot.root)
  const steeringWheel = new Graphics({ label: 'steering-wheel' })
    .circle(0, 0, 20).stroke({ width: 6, color: 0x263943 })
    .moveTo(-16, 0).lineTo(16, 0).moveTo(0, 0).lineTo(0, 17).stroke({ width: 4, color: 0x263943 })
  steeringWheel.position.set(0, 4)
  const brakeLights = new Graphics({ label: 'brake-lights' })
    .roundRect(-48, 48, 22, 10, 4).roundRect(26, 48, 22, 10, 4).fill(0xff4d4d)
  brakeLights.alpha = 0.25
  root.addChild(shadow, rearLeft, rearRight, frontLeft, frontRight, body, driverSlot, steeringWheel, brakeLights)
  return { root, shadow, body, wheels: [rearLeft, rearRight, frontLeft, frontRight], steeringWheel, driverSlot, mascot, brakeLights }
}

export function createKartCoinGraphic(): Graphics {
  return new Graphics({ label: 'kart-coin-texture' })
    .ellipse(25, 32, 18, 6).fill({ color: kartColors.shadow, alpha: 0.18 })
    .circle(23, 23, 19).fill(verticalGradient(0xffef8a, kartColors.coin)).stroke({ width: 3, color: 0xfff6bf })
    .circle(23, 23, 9).stroke({ width: 3, color: 0xe69a22 })
}

export function createKartObstacleGraphic(type: KartObstacleType): Graphics {
  if (type === 'cone') return new Graphics({ label: 'cone-texture' }).ellipse(25, 45, 21, 7).fill({ color: kartColors.shadow, alpha: 0.18 }).poly([25, 4, 8, 40, 42, 40]).fill(0xff824d).stroke({ width: 3, color: 0xffffff }).rect(5, 38, 40, 8).fill(0xffffff)
  if (type === 'tire-stack') return new Graphics({ label: 'tire-stack-texture' }).ellipse(25, 42, 23, 8).fill(0x202a31).stroke({ width: 4, color: 0x4d5961 }).ellipse(25, 29, 21, 8).fill(0x263139).stroke({ width: 4, color: 0x56636b }).ellipse(25, 17, 19, 7).fill(0x202a31).stroke({ width: 4, color: 0x4d5961 })
  if (type === 'toolbox') return new Graphics({ label: 'toolbox-texture' }).ellipse(26, 45, 23, 7).fill({ color: kartColors.shadow, alpha: 0.18 }).roundRect(5, 15, 42, 30, 6).fill(0xe44f4f).stroke({ width: 3, color: 0xffd0c9 }).roundRect(15, 7, 22, 13, 5).stroke({ width: 4, color: 0x7a3030 }).rect(22, 26, 8, 7).fill(0xffd34d)
  return new Graphics({ label: 'puddle-texture' }).ellipse(30, 30, 28, 12).fill({ color: 0x4b96bd, alpha: 0.78 }).stroke({ width: 3, color: 0x9fe5ff }).ellipse(22, 26, 9, 3).fill({ color: 0xffffff, alpha: 0.55 })
}

export function createKartItemGraphic(type: KartItemType): Graphics {
  if (type === 'shield') return new Graphics({ label: 'shield-texture' }).circle(25, 25, 22).fill({ color: kartColors.shield, alpha: 0.88 }).stroke({ width: 4, color: 0xffffff }).poly([25, 9, 39, 15, 36, 31, 25, 42, 14, 31, 11, 15]).stroke({ width: 4, color: 0x1779ad })
  return new Graphics({ label: 'boost-texture' }).circle(25, 25, 22).fill({ color: kartColors.boost, alpha: 0.92 }).stroke({ width: 4, color: 0xffffff }).poly([28, 6, 14, 27, 24, 27, 20, 44, 38, 20, 28, 20]).fill(0xffffff)
}

/** 正式训练与动态回放共享同一组程序化纹理。 */
export function createKartTextureSet(app: Application): KartTextureSet {
  const owned: Texture[] = []
  const make = (graphic: Graphics): Texture => {
    const texture = app.renderer.generateTexture(graphic)
    graphic.destroy()
    owned.push(texture)
    return texture
  }
  return {
    coin: make(createKartCoinGraphic()),
    particle: make(new Graphics({ label: 'kart-particle-texture' }).circle(7, 7, 6).fill(0xffffff)),
    obstacles: {
      cone: make(createKartObstacleGraphic('cone')),
      'tire-stack': make(createKartObstacleGraphic('tire-stack')),
      toolbox: make(createKartObstacleGraphic('toolbox')),
      puddle: make(createKartObstacleGraphic('puddle')),
    },
    items: { shield: make(createKartItemGraphic('shield')), boost: make(createKartItemGraphic('boost')) },
    destroy: () => owned.splice(0).forEach((texture) => texture.destroy(true)),
  }
}

export function createKartSprite(texture: Texture): Sprite {
  const sprite = new Sprite(texture)
  sprite.anchor.set(0.5)
  return sprite
}
