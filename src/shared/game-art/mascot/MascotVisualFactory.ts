import { Container, FillGradient, Graphics } from 'pixi.js'
import type { MascotPose } from './MascotPose'
import { mascotColors } from './MascotVisualStyle'

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
  /** 记录组合载具设置的基础缩放，动画只在此基础上轻微变化。 */
  homeScale: number
}

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

/** 创建可独立组合到小船或卡丁车上的统一蓝白设备角色。 */
export function createMascotVisual(): MascotVisual {
  const root = new Container({ label: 'mascot' })
  const base = new Graphics({ label: 'blue-hemisphere' })
    .moveTo(-39, -8).arc(0, -8, 39, Math.PI, Math.PI * 2).lineTo(39, -8)
    .quadraticCurveTo(0, 25, -39, -8).closePath()
    .fill(verticalGradient(mascotColors.deviceBlue, mascotColors.deviceBlueShade))
    .stroke({ width: 3, color: 0xeaf6fb })
  const supportRing = new Graphics({ label: 'support-ring' })
    .ellipse(0, -18, 28, 9).fill(mascotColors.support).stroke({ width: 3, color: mascotColors.supportOutline })
  const stem = new Graphics({ label: 'wide-stem' })
    .roundRect(-17, -55, 34, 38, 13)
    .fill(verticalGradient(mascotColors.whiteShell, mascotColors.whiteShellShade))
    .stroke({ width: 3, color: 0x86a5b7 })
  const topShell = new Graphics({ label: 'wide-top-shell' })
    .roundRect(-43, -88, 86, 39, 19)
    .fill(verticalGradient(0xffffff, mascotColors.topShellShade))
    .stroke({ width: 3, color: mascotColors.outline })
  const leftContact = new Graphics({ label: 'left-contact' }).ellipse(-20, -80, 15, 7).fill(mascotColors.contact)
  const rightContact = new Graphics({ label: 'right-contact' }).ellipse(20, -80, 15, 7).fill(mascotColors.contact)
  const face = new Container({ label: 'independent-face' })
  const openFace = new Graphics({ label: 'open-face' })
    .circle(-8, -63, 2.7).circle(8, -63, 2.7).fill(mascotColors.contact)
    .arc(0, -58, 7, 0.25, Math.PI - 0.25).stroke({ width: 2, color: mascotColors.contact })
  const closedFace = new Graphics({ label: 'closed-face' })
    .moveTo(-12, -63).quadraticCurveTo(-8, -60, -4, -63)
    .moveTo(4, -63).quadraticCurveTo(8, -60, 12, -63)
    .arc(0, -57, 6, 0.35, Math.PI - 0.35)
    .stroke({ width: 2.2, color: mascotColors.contact })
  closedFace.visible = false
  face.addChild(openFace, closedFace)
  root.addChild(base, supportRing, stem, topShell, leftContact, rightContact, face)
  return { root, base, supportRing, stem, topShell, leftContact, rightContact, face, openFace, closedFace, homeY: -4, homeScale: 1 }
}

/** 根据有效训练时间和游戏意图更新呼吸、转向、加减速与庆祝姿态。 */
export function updateMascotVisual(visual: MascotVisual, elapsedMs: number, pose: MascotPose = {}): void {
  const blink = elapsedMs % 4_200 >= 4_070
  const hit = pose.hit === true
  visual.openFace.visible = !hit && !blink
  visual.closedFace.visible = hit || blink
  const steering = clamp(pose.steering ?? 0, -1, 1)
  const pitch = clamp((pose.braking ?? 0) - (pose.throttle ?? 0), -1, 1)
  const celebration = pose.celebrating ? Math.sin(elapsedMs / 85) * 4 : 0
  visual.root.rotation = steering * 0.045 + pitch * 0.018
  visual.root.position.y = visual.homeY + Math.sin(elapsedMs / 620) * 2 + celebration
  visual.root.scale.set(visual.homeScale * (pose.celebrating ? 1.04 : 1))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0))
}
