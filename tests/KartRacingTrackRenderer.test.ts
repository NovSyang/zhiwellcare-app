import { describe, expect, it } from 'vitest'
import { kartPlayerLateralHalfWidth } from '../src/games/kart-racing/art/KartPerspective'
import { createKartForegroundRoadGeometry } from '../src/games/kart-racing/art/KartTrackRenderer'
import { defaultKartRacingGameConfig } from '../src/games/kart-racing/KartRacingGameConfig'
import { createDefaultKartTrack } from '../src/games/kart-racing/KartRacingTrack'
import { createKartRacingViewport } from '../src/games/kart-racing/KartRacingViewport'

describe('KartTrackRenderer foreground road', () => {
  it('前景道路与玩家平面无缝衔接并延伸到视觉底部', () => {
    const viewport = createKartRacingViewport(1280, 720)
    const track = createDefaultKartTrack(1_000)
    const geometry = createKartForegroundRoadGeometry(viewport, track, 50)
    expect(geometry.topY).toBeCloseTo(viewport.kartY, 8)
    expect(geometry.bottomY).toBeCloseTo(viewport.roadBottomY, 8)
    expect(geometry.bottomY).toBeGreaterThan(geometry.topY)
    expect(geometry.topLeft).toBeCloseTo(geometry.center - geometry.topHalfWidth, 8)
    expect(geometry.topRight).toBeCloseTo(geometry.center + geometry.topHalfWidth, 8)
    expect(geometry.bottomLeft).toBeCloseTo(geometry.center - geometry.bottomHalfWidth, 8)
    expect(geometry.bottomRight).toBeCloseTo(geometry.center + geometry.bottomHalfWidth, 8)
  })

  it('直道和四类弯道的近端保持稳定中心并仅轻微扩宽', () => {
    const viewport = createKartRacingViewport(1366, 768)
    const track = createDefaultKartTrack(1_000)
    // 采样起点直道、缓左、缓右及 S 弯两段。
    for (const distance of [50, 200, 500, 770, 835]) {
      const geometry = createKartForegroundRoadGeometry(viewport, track, distance)
      expect(geometry.center).toBeCloseTo(viewport.width / 2, 8)
      expect(geometry.bottomHalfWidth).toBeGreaterThanOrEqual(geometry.topHalfWidth)
      expect(geometry.bottomHalfWidth).toBeLessThanOrEqual(viewport.width * 0.49)
      expect(geometry.bottomLeft).toBeLessThanOrEqual(geometry.topLeft)
      expect(geometry.bottomRight).toBeGreaterThanOrEqual(geometry.topRight)
      expect(geometry.bottomCurb).toBeGreaterThanOrEqual(geometry.topCurb)
    }
  })

  it('常见桌面和移动横屏尺寸的前景道路都保留在画布范围内', () => {
    const track = createDefaultKartTrack(1_000)
    for (const [width, height] of [[1280, 720], [1366, 768], [1920, 1080], [844, 390]]) {
      const geometry = createKartForegroundRoadGeometry(createKartRacingViewport(width, height), track, 920)
      // 沥青保持在画布内；外侧路肩可以略微越界，以免底角露出草地。
      expect(geometry.bottomLeft).toBeGreaterThanOrEqual(0)
      expect(geometry.bottomRight).toBeLessThanOrEqual(width)
      expect(geometry.bottomLeft - geometry.bottomCurb).toBeLessThan(geometry.bottomLeft)
      expect(geometry.bottomRight + geometry.bottomCurb).toBeGreaterThan(geometry.bottomRight)
      expect(geometry.bottomY).toBeLessThan(height)
    }
  })

  it('车辆在最大左右位置时车轮、阴影和底部仍位于道路区域', () => {
    const track = createDefaultKartTrack(1_000)
    for (const [width, height] of [[1280, 720], [1366, 768], [1920, 1080], [844, 390]]) {
      const viewport = createKartRacingViewport(width, height)
      const geometry = createKartForegroundRoadGeometry(viewport, track, 500)
      const kartScale = viewport.scale / 720
      // 当前模型最宽处是阴影，最低处是前轮；测试只锁定可视占地，不改变车辆原点。
      const kartHalfWidth = 88 * kartScale
      const kartBottom = viewport.kartY + 68 * kartScale
      const maximumOffset = kartPlayerLateralHalfWidth(viewport) * defaultKartRacingGameConfig.lateralLimit
      expect(viewport.width / 2 - maximumOffset - kartHalfWidth).toBeGreaterThanOrEqual(geometry.topLeft)
      expect(viewport.width / 2 + maximumOffset + kartHalfWidth).toBeLessThanOrEqual(geometry.topRight)
      expect(kartBottom).toBeLessThanOrEqual(geometry.bottomY)
    }
  })
})
