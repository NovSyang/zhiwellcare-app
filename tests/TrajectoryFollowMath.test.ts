import { describe, expect, it } from 'vitest'
import { createReferenceSamples, getReferenceAt, getTrajectoryPoint, trackingError } from '../src/games/trajectory-follow/TrajectoryFollowMath'
import { defaultTrajectoryFollowGameConfig } from '../src/games/trajectory-follow/TrajectoryFollowGameConfig'

describe('TrajectoryFollowMath', () => {
  it('生成从中心开始并精确覆盖终点的 25Hz 参考轨迹', () => {
    const samples = createReferenceSamples(defaultTrajectoryFollowGameConfig)
    expect(samples).toHaveLength(1501)
    expect(samples[0]).toEqual({ elapsedMs: 0, x: 0, y: 0 })
    expect(samples.at(-1)?.elapsedMs).toBe(60_000)
    expect(Math.abs(samples.at(-1)?.x ?? 1)).toBeLessThan(1e-10)
    expect(Math.max(...samples.map((sample) => Math.abs(sample.x)))).toBeLessThanOrEqual(0.65)
    expect(Math.max(...samples.map((sample) => Math.abs(sample.y)))).toBeLessThanOrEqual(0.45)
  })

  it('一个周期后回到中心，并可插值读取参考点', () => {
    const point = getTrajectoryPoint(12_000, defaultTrajectoryFollowGameConfig)
    expect(Math.abs(point.x)).toBeLessThan(1e-10)
    expect(Math.abs(point.y)).toBeLessThan(1e-10)
    const samples = createReferenceSamples({ ...defaultTrajectoryFollowGameConfig, sessionDurationMs: 100, referenceSampleIntervalMs: 100 })
    expect(getReferenceAt(samples, 50)?.elapsedMs).toBe(50)
  })

  it('使用二维欧氏距离计算归一化跟随偏差', () => {
    expect(trackingError({ x: 0.3, y: 0.4 }, { x: 0, y: 0 })).toBeCloseTo(0.5)
  })
})
