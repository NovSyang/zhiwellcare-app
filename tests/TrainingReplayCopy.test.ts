import { reactive } from 'vue'
import { describe, expect, it } from 'vitest'
import type { TrainingReplay } from '../src/core/replay/TrainingReplay'
import { copyTrainingReplay } from '../src/core/replay/TrainingReplayCopy'

describe('copyTrainingReplay', () => {
  it('复制 Vue Proxy 中的嵌套参考路径数组', () => {
    const replay = reactive<TrainingReplay>({
      schemaVersion: 1,
      durationMs: 100,
      sampleRateHz: 25,
      samples: [{ elapsedMs: 0, x: 2, y: -2 }],
      events: [{ elapsedMs: 0, type: 'reference-path', payload: { samples: [{ elapsedMs: 0, x: 0.1, y: 0.2 }] } }],
    })
    const copied = copyTrainingReplay(replay)
    expect(copied.samples[0]).toMatchObject({ x: 1, y: -1 })
    expect(copied.events[0].payload).toEqual({ samples: [{ elapsedMs: 0, x: 0.1, y: 0.2 }] })
    expect(copied).not.toBe(replay)
  })

  it('丢弃函数、特殊对象、循环引用和非有限数值', () => {
    const cyclic: Record<string, unknown> = { valid: 1, invalid: Number.NaN, callback: () => undefined, date: new Date() }
    cyclic.self = cyclic
    const copied = copyTrainingReplay({ schemaVersion: 1, durationMs: 0, sampleRateHz: 25, samples: [], events: [{ elapsedMs: 0, type: 'safe', payload: cyclic }] })
    expect(copied.events[0].payload).toEqual({ valid: 1 })
  })
})
