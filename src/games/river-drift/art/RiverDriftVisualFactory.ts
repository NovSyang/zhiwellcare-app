import { Application, Container, FillGradient, Graphics, Sprite, Texture } from 'pixi.js'
import type { RiverDriftObstacleType } from '../RiverDriftWorld'
import { riverDriftColors } from './RiverDriftVisualStyle'

export interface MascotVisual {
  root: Container
  base: Graphics
  supportRing: Graphics
  stem: Graphics
  topShell: Graphics
  leftContact: Graphics
  rightContact: Graphics
  face: Container
  openFace: Graphics
  closedFace: Graphics
  homeY: number
}

export interface BoatVisual {
  root: Container
  shadow: Graphics
  sideHull: Graphics
  mainHull: Graphics
  cabin: Graphics
  seat: Graphics
  mascot: MascotVisual
  frontRail: Graphics
}

export interface RiverDriftTextureSet {
  coin: Texture
  particle: Texture
  obstacles: Record<RiverDriftObstacleType, Texture>
  names: readonly string[]
  destroy(): void
}

/** 纹理清单保持稳定，便于训练与回放核对是否使用同一套资源。 */
export const riverDriftTextureNames = ['coin', 'particle', 'rock', 'stump', 'crate', 'weed'] as const

function verticalGradient(top: number, bottom: number): FillGradient | number {
  // 纯逻辑测试没有浏览器 Canvas，此时退回高光色，不影响结构校验。
  if (typeof document === 'undefined') return top
  return new FillGradient({
    type: 'linear',
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    colorStops: [{ offset: 0, color: top }, { offset: 1, color: bottom }],
    textureSpace: 'local',
  })
}

/** 创建可独立控制表情和倾斜的设备角色。 */
export function createRiverDriftMascot(): MascotVisual {
  const root = new Container({ label: 'mascot' })
  const base = new Graphics({ label: 'blue-hemisphere' })
    .moveTo(-39, -8).arc(0, -8, 39, Math.PI, Math.PI * 2).lineTo(39, -8)
    .quadraticCurveTo(0, 25, -39, -8).closePath()
    .fill(verticalGradient(riverDriftColors.deviceBlue, riverDriftColors.deviceBlueShade))
    .stroke({ width: 3, color: 0xeaf6fb })
  const supportRing = new Graphics({ label: 'support-ring' })
    .ellipse(0, -18, 28, 9).fill(0xf8fbfd).stroke({ width: 3, color: 0xb9cfdb })
  const stem = new Graphics({ label: 'wide-stem' })
    .roundRect(-17, -55, 34, 38, 13)
    .fill(verticalGradient(riverDriftColors.whiteShell, riverDriftColors.whiteShellShade))
    .stroke({ width: 3, color: 0x86a5b7 })
  const topShell = new Graphics({ label: 'wide-top-shell' })
    .roundRect(-43, -88, 86, 39, 19)
    .fill(verticalGradient(0xffffff, 0xdce9ef))
    .stroke({ width: 3, color: 0x7898aa })
  const leftContact = new Graphics({ label: 'left-contact' })
    .ellipse(-20, -80, 15, 7).fill(riverDriftColors.contact)
  const rightContact = new Graphics({ label: 'right-contact' })
    .ellipse(20, -80, 15, 7).fill(riverDriftColors.contact)
  const face = new Container({ label: 'independent-face' })
  const openFace = new Graphics({ label: 'open-face' })
    .circle(-8, -63, 2.7).circle(8, -63, 2.7).fill(riverDriftColors.contact)
    .arc(0, -58, 7, 0.25, Math.PI - 0.25).stroke({ width: 2, color: riverDriftColors.contact })
  const closedFace = new Graphics({ label: 'closed-face' })
    .moveTo(-12, -63).quadraticCurveTo(-8, -60, -4, -63)
    .moveTo(4, -63).quadraticCurveTo(8, -60, 12, -63)
    .arc(0, -57, 6, 0.35, Math.PI - 0.35)
    .stroke({ width: 2.2, color: riverDriftColors.contact })
  closedFace.visible = false
  face.addChild(openFace, closedFace)
  root.addChild(base, supportRing, stem, topShell, leftContact, rightContact, face)
  return { root, base, supportRing, stem, topShell, leftContact, rightContact, face, openFace, closedFace, homeY: -4 }
}

/** 创建包含前后遮挡层级的 2.5D 小船。 */
export function createRiverDriftBoatVisual(): BoatVisual {
  const root = new Container({ label: 'river-boat' })
  const shadow = new Graphics({ label: 'boat-shadow' })
    .ellipse(8, 47, 78, 18).fill({ color: riverDriftColors.shadow, alpha: 0.2 })
  const sideHull = new Graphics({ label: 'boat-side' })
    .moveTo(-77, 4).lineTo(77, 4).lineTo(53, 57).quadraticCurveTo(0, 78, -53, 57).closePath()
    .fill(riverDriftColors.boatSide)
  const mainHull = new Graphics({ label: 'boat-main' })
    .moveTo(-79, -4).quadraticCurveTo(0, -17, 79, -4).lineTo(61, 34)
    .quadraticCurveTo(0, 55, -61, 34).closePath()
    .fill(verticalGradient(riverDriftColors.boatLight, riverDriftColors.boatMain))
    .stroke({ width: 5, color: 0xfff4d2 })
  const cabin = new Graphics({ label: 'boat-cabin' })
    .ellipse(0, 5, 51, 21).fill(riverDriftColors.boatInside).stroke({ width: 4, color: 0xf7bb5e })
  const seat = new Graphics({ label: 'boat-seat' })
    .roundRect(-42, 8, 84, 15, 7).fill(0x763f2a).stroke({ width: 2, color: 0xc77b3a })
  const mascot = createRiverDriftMascot()
  mascot.root.position.y = mascot.homeY
  const frontRail = new Graphics({ label: 'front-rail' })
    .moveTo(-61, 28).quadraticCurveTo(0, 49, 61, 28)
    .stroke({ width: 10, color: riverDriftColors.boatMain })
    .moveTo(-56, 25).quadraticCurveTo(0, 42, 56, 25)
    .stroke({ width: 3, color: riverDriftColors.boatLight, alpha: 0.9 })
  root.addChild(shadow, sideHull, mainHull, cabin, seat, mascot.root, frontRail)
  return { root, shadow, sideHull, mainHull, cabin, seat, mascot, frontRail }
}

/** 眨眼节奏完全由有效时间决定，回放 Seek 后也能得到相同表情。 */
export function updateRiverDriftMascot(visual: MascotVisual, elapsedMs: number, hit: boolean, tilt: number): void {
  const blink = elapsedMs % 4_200 >= 4_070
  visual.openFace.visible = !hit && !blink
  visual.closedFace.visible = hit || blink
  visual.root.rotation = tilt
  visual.root.position.y = visual.homeY + Math.sin(elapsedMs / 620) * 2
}

/** 金币包含投影、厚度、正面、内圈和左上高光。 */
export function createRiverDriftCoinGraphic(): Graphics {
  return new Graphics({ label: 'coin-texture' })
    .ellipse(27, 32, 20, 7).fill({ color: riverDriftColors.shadow, alpha: 0.2 })
    .circle(25, 27, 20).fill(riverDriftColors.coinSide)
    .circle(23, 23, 19).fill(verticalGradient(riverDriftColors.coinLight, riverDriftColors.coinFront))
    .stroke({ width: 3, color: 0xfff7bf })
    .circle(23, 23, 9).stroke({ width: 3, color: 0xe59c24 })
    .arc(19, 19, 10, Math.PI * 1.05, Math.PI * 1.52).stroke({ width: 3, color: 0xffffff, alpha: 0.9 })
}

export function createRiverDriftRockGraphic(): Graphics {
  return new Graphics({ label: 'rock-texture' })
    .ellipse(27, 42, 23, 7).fill({ color: riverDriftColors.shadow, alpha: 0.2 })
    .moveTo(6, 35).lineTo(10, 17).lineTo(23, 7).lineTo(43, 12).lineTo(49, 32).lineTo(39, 42).lineTo(16, 43).closePath()
    .fill(verticalGradient(0xaab7c0, 0x66747e)).stroke({ width: 3, color: 0xdce7ec })
    .moveTo(13, 19).lineTo(23, 12).lineTo(31, 14).stroke({ width: 4, color: 0xdbe4e8, alpha: 0.75 })
}

export function createRiverDriftStumpGraphic(): Graphics {
  return new Graphics({ label: 'stump-texture' })
    .ellipse(27, 44, 20, 6).fill({ color: riverDriftColors.shadow, alpha: 0.18 })
    .roundRect(10, 11, 34, 34, 8).fill(verticalGradient(0xb9773f, 0x724529))
    .ellipse(27, 12, 18, 9).fill(0xd5a063).stroke({ width: 3, color: 0x6f4529 })
    .ellipse(27, 12, 10, 5).stroke({ width: 2, color: 0x9a673c })
}

export function createRiverDriftCrateGraphic(): Graphics {
  return new Graphics({ label: 'crate-texture' })
    .ellipse(29, 48, 23, 7).fill({ color: riverDriftColors.shadow, alpha: 0.18 })
    .poly([8, 13, 38, 7, 50, 17, 20, 23]).fill(0xe1ad66)
    .poly([38, 7, 50, 17, 50, 45, 38, 39]).fill(0x8f572f)
    .poly([8, 13, 20, 23, 20, 51, 8, 42]).fill(0xaf7138)
    .rect(20, 23, 30, 28).fill(verticalGradient(0xd99a50, 0xa76733)).stroke({ width: 3, color: 0x754226 })
    .moveTo(22, 25).lineTo(48, 49).moveTo(48, 25).lineTo(22, 49).stroke({ width: 4, color: 0x7d4829 })
}

export function createRiverDriftWeedGraphic(): Graphics {
  return new Graphics({ label: 'weed-texture' })
    .ellipse(28, 48, 24, 7).fill({ color: riverDriftColors.shadow, alpha: 0.16 })
    .moveTo(12, 44).bezierCurveTo(4, 20, 10, 9, 22, 39)
    .moveTo(22, 45).bezierCurveTo(18, 14, 31, 6, 29, 42)
    .moveTo(31, 45).bezierCurveTo(39, 16, 51, 16, 39, 45)
    .stroke({ width: 8, color: 0x347b4c })
    .moveTo(15, 39).bezierCurveTo(9, 22, 13, 17, 20, 36)
    .moveTo(25, 39).bezierCurveTo(24, 20, 30, 13, 30, 38)
    .moveTo(34, 40).bezierCurveTo(40, 23, 45, 23, 39, 41)
    .stroke({ width: 3, color: 0x86c96d })
}

/** 训练与动态回放都通过这里生成同一套静态纹理。 */
export function createRiverDriftTextureSet(app: Application): RiverDriftTextureSet {
  const owned: Texture[] = []
  const make = (graphic: Graphics): Texture => {
    const texture = app.renderer.generateTexture(graphic)
    graphic.destroy()
    owned.push(texture)
    return texture
  }
  const coin = make(createRiverDriftCoinGraphic())
  const particle = make(new Graphics({ label: 'particle-texture' }).circle(8, 8, 7).fill(0xffffff))
  const obstacles = {
    rock: make(createRiverDriftRockGraphic()),
    stump: make(createRiverDriftStumpGraphic()),
    crate: make(createRiverDriftCrateGraphic()),
    weed: make(createRiverDriftWeedGraphic()),
  }
  return {
    coin,
    particle,
    obstacles,
    names: riverDriftTextureNames,
    destroy: () => owned.splice(0).forEach((texture) => texture.destroy(true)),
  }
}

/** 回放适配器和正式训练共用此方法创建带中心锚点的精灵。 */
export function createRiverDriftSprite(texture: Texture): Sprite {
  const sprite = new Sprite(texture)
  sprite.anchor.set(0.5)
  return sprite
}
