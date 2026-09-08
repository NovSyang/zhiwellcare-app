import { Container, Graphics } from 'pixi.js'
import type { KartRacingViewport } from '../KartRacingViewport'
import { kartColors } from './KartVisualStyle'

/** 绘制天空、草坪与轻量路边装饰，不创建逐帧显示对象。 */
export class KartEnvironmentRenderer {
  private graphic = new Graphics({ label: 'kart-environment' })

  constructor(parent: Container) {
    parent.addChild(this.graphic)
  }

  render(viewport: KartRacingViewport, distance: number): void {
    const graphic = this.graphic.clear()
    graphic.rect(0, 0, viewport.width, viewport.horizonY).fill(kartColors.skyTop)
    graphic.rect(0, viewport.horizonY * 0.62, viewport.width, viewport.horizonY * 0.38).fill({ color: kartColors.skyBottom, alpha: 0.72 })
    graphic.rect(0, viewport.horizonY, viewport.width, viewport.height - viewport.horizonY).fill(kartColors.grassLight)

    // 云朵与远景只随距离轻微移动，保持画面有生命力但不过度刺激。
    const cloudShift = -(distance * 0.6) % Math.max(1, viewport.width + 240)
    for (let index = -1; index < 5; index += 1) {
      const x = cloudShift + index * (viewport.width / 3 + 80)
      const y = viewport.horizonY * (0.22 + (index & 1) * 0.16)
      graphic.circle(x, y, 22).circle(x + 25, y - 8, 29).circle(x + 56, y, 21).fill({ color: 0xffffff, alpha: 0.78 })
    }
    const hillY = viewport.horizonY
    graphic.moveTo(0, hillY).lineTo(0, hillY - 32)
    for (let x = 0; x <= viewport.width + 80; x += 80) {
      const height = 24 + ((x / 80) % 3) * 9
      graphic.lineTo(x + 40, hillY - height).lineTo(x + 80, hillY - 20)
    }
    graphic.lineTo(viewport.width, hillY).closePath().fill(0x398b48)
  }

  destroy(): void {
    this.graphic.destroy()
  }
}
