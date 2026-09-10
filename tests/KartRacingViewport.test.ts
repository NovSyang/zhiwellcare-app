import { describe, expect, it } from 'vitest'
import { createKartRacingViewport } from '../src/games/kart-racing/KartRacingViewport'

describe('KartRacingViewport', () => {
  it('将地平线、玩家平面和道路视觉底部分开计算', () => {
    for (const [width, height] of [[1280, 720], [1366, 768], [1920, 1080], [844, 390]]) {
      const viewport = createKartRacingViewport(width, height)
      expect(viewport.horizonY / viewport.height).toBeCloseTo(0.24, 5)
      expect(viewport.kartY / viewport.height).toBeCloseTo(0.76, 5)
      expect(viewport.roadBottomY / viewport.height).toBeCloseTo(0.93, 5)
      expect(viewport.roadBottomY).toBeGreaterThan(viewport.kartY)
    }
  })
})
