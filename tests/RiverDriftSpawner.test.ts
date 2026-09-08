import { describe, expect, it } from 'vitest'
import { defaultRiverDriftGameConfig } from '../src/games/river-drift/RiverDriftGameConfig'
import { buildRiverDriftCoinPattern, riverDriftObstacleCoverage, RiverDriftWorld, type RiverDriftCoinPatternType } from '../src/games/river-drift/RiverDriftWorld'

describe('RiverDriftSpawner', () => {
  it.each(['straight', 'horizontal', 's-curve', 'guide-left', 'guide-right'] as RiverDriftCoinPatternType[])('%s 金币轨迹保持在河道内', (type) => {
    const points = buildRiverDriftCoinPattern(type, 0.5, defaultRiverDriftGameConfig.riverWidthRatio)
    expect(points.length).toBeGreaterThanOrEqual(4)
    expect(points.every((point) => point.x > 0.16 && point.x < 0.84)).toBe(true)
  })

  it('单障碍覆盖宽度低于康复安全上限', () => {
    expect(riverDriftObstacleCoverage(defaultRiverDriftGameConfig.obstacleRadius, defaultRiverDriftGameConfig.riverWidthRatio)).toBeLessThan(0.55)
  })

  it('固定种子生成的对象位于河道内且保留充分预判距离', () => {
    const events: Array<{ type: string; payload?: unknown }> = []
    const world = new RiverDriftWorld(defaultRiverDriftGameConfig, { onReplayEvent: (event) => events.push(event) })
    world.reset(42)
    for (let elapsed = 0; elapsed <= 12_000; elapsed += 100) world.update(0.1, elapsed, { x: 0.5, y: 0.74 })
    const obstacleEvents = events.filter((event) => event.type === 'obstacle-spawn')
    expect(obstacleEvents.length).toBeGreaterThan(0)
    for (const event of obstacleEvents) {
      const payload = event.payload as { x: number; y: number }
      expect(payload.x).toBeGreaterThan(0.16)
      expect(payload.x).toBeLessThan(0.84)
      // 从 -0.1 漂到船体区域远大于 2.5 秒，患者有充分反应时间。
      expect((0.63 - payload.y) / defaultRiverDriftGameConfig.worldSpeed).toBeGreaterThan(2.5)
    }
  })
})
