import { describe, expect, it } from 'vitest'
import { downsampleForDisplay, sampleAtElapsed } from '../src/core/replay/ReplayMath'

describe('ReplayMath', () => {
  const samples = [{ elapsedMs: 100, x: 0, y: 0 }, { elapsedMs: 140, x: 0.4, y: -0.4 }]

  it('处理空数据、首尾边界和两个样本之间的插值', () => {
    expect(sampleAtElapsed([], 0)).toBeNull()
    expect(sampleAtElapsed(samples, 0)).toEqual(samples[0])
    expect(sampleAtElapsed(samples, 200)).toEqual(samples[1])
    expect(sampleAtElapsed(samples, 120)).toEqual({ elapsedMs: 120, x: 0.2, y: -0.2 })
  })

  it('相同时间戳安全返回后一个样本，显示降采样保留首尾', () => {
    expect(sampleAtElapsed([{ elapsedMs: 1, x: 0, y: 0 }, { elapsedMs: 1, x: 1, y: 1 }], 1)).toEqual({ elapsedMs: 1, x: 0, y: 0 })
    const items = Array.from({ length: 10 }, (_, index) => index)
    expect(downsampleForDisplay(items, 4)).toEqual([0, 3, 6, 9])
  })
})
