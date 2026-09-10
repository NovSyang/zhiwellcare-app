import { describe, expect, it } from 'vitest'
import {
  distanceToKartDepth,
  kartDepthToScreenY,
  kartEntityScaleAtDepth,
  kartPlayerLateralHalfWidth,
  kartPlayerRoadHalfWidth,
  projectKartEntity,
} from '../src/games/kart-racing/art/KartPerspective'
import { createDefaultKartTrack } from '../src/games/kart-racing/KartRacingTrack'
import { createKartRacingViewport } from '../src/games/kart-racing/KartRacingViewport'

describe('KartPerspective', () => {
  it('近处对象更低、更大，远处对象靠近地平线', () => {
    const viewport = createKartRacingViewport(1280, 720)
    const far = distanceToKartDepth(80, 90)
    const near = distanceToKartDepth(10, 90)
    expect(near).toBeGreaterThan(far)
    expect(kartDepthToScreenY(near, viewport)).toBeGreaterThan(kartDepthToScreenY(far, viewport))
    expect(kartEntityScaleAtDepth(near)).toBeGreaterThan(kartEntityScaleAtDepth(far))
  })

  it('桌面与横屏移动视口投影均返回画布内的有限坐标', () => {
    const track = createDefaultKartTrack(1_000)
    // 覆盖验收要求的三种桌面尺寸，并补充常见手机横屏尺寸。
    for (const [width, height] of [[1280, 720], [1366, 768], [1920, 1080], [844, 390]]) {
      const projection = projectKartEntity({ entityDistance: 180, entityLateral: 0.5, kartDistance: 100, visibleDistance: 90, track, viewport: createKartRacingViewport(width, height) })
      expect(projection.visible).toBe(true)
      expect(Number.isFinite(projection.screenX)).toBe(true)
      expect(Number.isFinite(projection.screenY)).toBe(true)
      expect(projection.screenX).toBeGreaterThanOrEqual(0)
      expect(projection.screenX).toBeLessThanOrEqual(width)
      expect(projection.screenY).toBeGreaterThanOrEqual(0)
      expect(projection.screenY).toBeLessThanOrEqual(height)
    }
  })

  it('世界实体和玩家横向定位共享玩家平面的道路宽度', () => {
    const viewport = createKartRacingViewport(1280, 720)
    const track = createDefaultKartTrack(1_000)
    const projection = projectKartEntity({ entityDistance: 100, entityLateral: 0, kartDistance: 100, visibleDistance: 90, track, viewport })
    // 实体到达玩家时仍停在 kartY，不会跟随视觉道路延伸到底部。
    expect(kartDepthToScreenY(1, viewport)).toBeCloseTo(viewport.kartY, 8)
    expect(projection.screenY).toBeCloseTo(viewport.kartY, 8)
    expect(projection.roadHalfWidth).toBeCloseTo(kartPlayerRoadHalfWidth(viewport), 8)
    expect(kartPlayerLateralHalfWidth(viewport)).toBeCloseTo(projection.roadHalfWidth * 0.88, 8)
  })
})
