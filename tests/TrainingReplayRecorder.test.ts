import { describe, expect, it } from 'vitest'
import { TrainingReplayRecorder } from '../src/core/replay/TrainingReplayRecorder'
import type { GameInput } from '../src/core/game-input/GameInput'

const input = (x: number, y: number): GameInput => ({ x, y, connected: true, calibrated: true, timestamp: 0 })

describe('TrainingReplayRecorder', () => {
  it('按 25Hz 节流并限制、舍入坐标', () => {
    const recorder = new TrainingReplayRecorder(40)
    recorder.recordInput(input(1.23456, -1.23456), 1)
    recorder.recordInput(input(0.2, 0.2), 39)
    recorder.recordInput(input(0.333333, -0.333333), 41)
    const replay = recorder.finish(100)

    expect(replay.samples).toEqual([
      { elapsedMs: 1, x: 1, y: -1 },
      { elapsedMs: 41, x: 0.3333, y: -0.3333 },
    ])
    expect(replay.sampleRateHz).toBe(25)
  })

  it('reset 和事件记录不会污染下一局', () => {
    const recorder = new TrainingReplayRecorder()
    recorder.recordInput(input(0, 0), 0)
    recorder.recordEvent({ elapsedMs: -1, type: 'pause' })
    recorder.reset()
    recorder.recordInput(input(0.5, 0), 0)
    recorder.recordEvent({ elapsedMs: 20, type: 'resume' })
    const replay = recorder.finish(50)

    expect(replay.samples).toEqual([{ elapsedMs: 0, x: 0.5, y: 0 }])
    expect(replay.events).toEqual([{ elapsedMs: 20, type: 'resume' }])
    expect(replay.durationMs).toBe(50)
  })
})
