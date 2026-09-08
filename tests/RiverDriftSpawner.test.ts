import { describe, expect, it } from 'vitest'
import { defaultRiverDriftGameConfig } from '../src/games/river-drift/RiverDriftGameConfig'
import { buildRiverDriftCoinPattern, riverDriftObstacleCoverage, RiverDriftWorld, type RiverDriftCoinPatternType } from '../src/games/river-drift/RiverDriftWorld'

describe('RiverDriftSpawner', () => {
  it.each(['straight', 'horizontal', 's-curve', 'guide-left', 'guide-right'] as RiverDriftCoinPatternType[])('%s 金币轨迹保持在河道内', (type) => {
    const points = buildRiverDriftCoinPattern(type, 0.5, defaultRiverDriftGameConfig.riverWidthRatio)
    const expectedCount = type === 's-curve' ? 4 : 3
    expect(points).toHaveLength(expectedCount)
    expect(points.every((point) => point.x > 0.16 && point.x < 0.84)).toBe(true)
    for (let index = 1; index < points.length; index += 1) {
      expect(points[index - 1].y - points[index].y).toBeCloseTo(defaultRiverDriftGameConfig.coinItemSpacing)
    }
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

  it('金币按空间间距生成，减速不会压缩世界中的间隔', () => {
    const patternTimes: number[] = []
    const patternDistances: number[] = []
    const seen = new Set<string>()
    const config = { ...defaultRiverDriftGameConfig, hitSlowdownMs: 10_000, maxVisibleCoins: 32 }
    let world!: RiverDriftWorld
    world = new RiverDriftWorld(config, {
      onReplayEvent: (event) => {
        if (event.type !== 'coin-spawn') return
        const patternId = (event.payload as { patternId: string }).patternId
        if (seen.has(patternId)) return
        seen.add(patternId)
        patternTimes.push(event.elapsedMs)
        patternDistances.push(world.worldDistance)
      },
    })
    world.reset(7)
    // 主动放入一个命中障碍，让前 10 秒世界速度进入减速状态。
    Object.assign(world.obstacles[0], { id: 'slowdown', x: 0.5, y: 0.74, radius: 0.05, active: true, hit: false })
    for (let elapsed = 0; elapsed <= 30_000; elapsed += 20) {
      world.update(0.02, elapsed, elapsed === 0 ? { x: 0.5, y: 0.74 } : { x: 0, y: 0.74 })
      expect(world.coins.filter((coin) => coin.active).length).toBeLessThanOrEqual(config.maxVisibleCoins)
    }
    expect(patternTimes[0]).toBeGreaterThan(2_000)
    for (let index = 1; index < patternDistances.length; index += 1) {
      const distance = patternDistances[index] - patternDistances[index - 1]
      // 固定步长可能让事件比阈值晚一个更新步，因此保留很小容差。
      expect(distance).toBeGreaterThanOrEqual(defaultRiverDriftGameConfig.coinPatternSpacingMin - 0.003)
      expect(distance).toBeLessThanOrEqual(defaultRiverDriftGameConfig.coinPatternSpacingMax + 0.003)
    }
  })

  it('固定种子下 90 秒金币总量合理，且最后 10 秒停止生成', () => {
    for (const seed of [1, 7, 42, 99]) {
      const world = new RiverDriftWorld(defaultRiverDriftGameConfig)
      world.reset(seed)
      let countAtStop = 0
      for (let elapsed = 0; elapsed <= 90_000; elapsed += 20) {
        // 船放在河道外，验证完全不收集金币时对象池和密度仍然安全。
        world.update(0.02, elapsed, { x: 0, y: 0.74 })
        if (elapsed === 80_000) countAtStop = world.totalCoins
        expect(world.coins.filter((coin) => coin.active).length).toBeLessThanOrEqual(defaultRiverDriftGameConfig.maxVisibleCoins)
      }
      expect(world.totalCoins).toBeGreaterThanOrEqual(80)
      expect(world.totalCoins).toBeLessThanOrEqual(110)
      expect(world.totalCoins).toBe(countAtStop)
    }
  })
})
