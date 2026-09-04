import { reactive } from 'vue'
import { describe, expect, it } from 'vitest'
import type { TrainingReplay } from '../src/core/replay/TrainingReplay'
import { copyTrainingReplay, TargetReachReplayPlayer } from '../src/games/target-reach/replay/TargetReachReplayPlayer'

describe('TargetReachReplayPlayer', () => {
  it('可加载 Vue 响应式 Replay，不会对 Proxy 执行 structuredClone', () => {
    const replay = reactive<TrainingReplay>({
      schemaVersion: 1,
      durationMs: 1200,
      sampleRateHz: 25,
      samples: [{ elapsedMs: 0, x: 0, y: 0 }, { elapsedMs: 40, x: 0.5, y: -0.5 }],
      events: [{ elapsedMs: 0, type: 'target-start', payload: { index: 1, targetX: 0.7, targetY: 0, ignored: () => undefined } }],
    })
    const player = new TargetReachReplayPlayer()

    expect(() => player.load(replay)).not.toThrow()
    expect(player.getSnapshot()).toMatchObject({ state: 'paused', durationMs: 1200, currentTimeMs: 0 })
  })

  it('复制时规范化无效数值并仅保留基础事件 payload', () => {
    const copy = copyTrainingReplay({
      schemaVersion: 1,
      durationMs: Number.NaN,
      sampleRateHz: -1,
      samples: [{ elapsedMs: -2, x: 2, y: -2 }, { elapsedMs: Number.NaN, x: 0, y: 0 }],
      events: [{ elapsedMs: -1, type: 'target-start', payload: { index: 1, callback: () => undefined } }],
    })

    expect(copy.durationMs).toBe(0)
    expect(copy.sampleRateHz).toBe(0)
    expect(copy.samples).toEqual([{ elapsedMs: 0, x: 1, y: -1 }])
    expect(copy.events).toEqual([{ elapsedMs: 0, type: 'target-start', payload: { index: 1 } }])
  })
})
