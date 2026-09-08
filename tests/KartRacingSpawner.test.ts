import { describe, expect, it } from 'vitest'
import { defaultKartRacingGameConfig } from '../src/games/kart-racing/KartRacingGameConfig'
import { buildKartCoinPattern, kartObstacleGroupHasSafeLane, KartRacingWorld } from '../src/games/kart-racing/KartRacingWorld'

describe('KartRacingSpawner', () => {
  it('金币轨迹使用固定世界距离间隔并位于可操作范围', () => {
    const points = buildKartCoinPattern('gentle-curve', 100, 8)
    expect(points).toHaveLength(4)
    expect(points.every((point) => Math.abs(point.lateral) <= 0.62)).toBe(true)
    expect(points.map((point) => point.distance)).toEqual([100, 108, 116, 124])
  })

  it('任意障碍组至少保留一条候选安全路线', () => {
    expect(kartObstacleGroupHasSafeLane([{ lateral: -0.62 }, { lateral: 0 }])).toBe(true)
    expect(kartObstacleGroupHasSafeLane([{ lateral: -0.62 }, { lateral: 0 }, { lateral: 0.62 }])).toBe(false)
  })

  it('固定种子下生成结果只取决于距离且不超过对象池容量', () => {
    const generate = (stepDistance: number): number[] => {
      const distances: number[] = []
      const seen = new Set<string>()
      const world = new KartRacingWorld(defaultKartRacingGameConfig, { onReplayEvent: (event) => {
        if (event.type !== 'coin-spawn') return
        const payload = event.payload as { id: string; distance: number }
        if (!seen.has(payload.id)) { seen.add(payload.id); distances.push(payload.distance) }
      } })
      world.reset(42)
      for (let distance = 0; distance <= 500; distance += stepDistance) {
        world.update(distance * 10, { lateral: 0.82, lateralVelocity: 0, speed: stepDistance, distance })
        expect(world.coins.filter((coin) => coin.active).length).toBeLessThanOrEqual(defaultKartRacingGameConfig.maxVisibleCoins)
      }
      return distances
    }
    expect(generate(2)).toEqual(generate(5))
  })

  it('护盾抵消下一次碰撞减速但仍记录接触', () => {
    const config = { ...defaultKartRacingGameConfig, spawnLookAheadDistance: 300 }
    const world = new KartRacingWorld(config)
    world.reset(1)
    // 测试直接放入道具和障碍，避免依赖随机车道。
    Object.assign(world.items[0], { id: 'shield', distance: 5, lateral: 0, radius: 0.2, itemType: 'shield', active: true })
    world.update(100, { lateral: 0, lateralVelocity: 0, speed: 10, distance: 5 })
    Object.assign(world.obstacles[0], { id: 'cone', distance: 10, lateral: 0, radius: 0.2, obstacleType: 'cone', groupId: 'g', active: true, hit: false })
    const feedback = world.update(200, { lateral: 0, lateralVelocity: 0, speed: 10, distance: 10 })
    expect(feedback.shieldConsumed).toBe(true)
    expect(world.collisionCount).toBe(1)
    expect(world.getPhysicsEffects(250).slowdownFactor).toBe(1)
  })
})
