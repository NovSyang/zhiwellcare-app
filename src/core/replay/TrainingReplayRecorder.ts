import type { GameInput } from '../game-input/GameInput'
import { clamp, round4 } from './ReplayMath'
import type { ReplayEvent, TrainingReplay } from './TrainingReplay'

/** 将实时 GameInput 节流为适合 IndexedDB 保存与平滑回放的 25Hz 历史。 */
export class TrainingReplayRecorder {
  private samples: TrainingReplay['samples'] = []
  private events: ReplayEvent[] = []
  private lastSampleElapsedMs = Number.NEGATIVE_INFINITY

  constructor(private readonly sampleIntervalMs = 40) {}

  reset(): void {
    this.samples = []
    this.events = []
    this.lastSampleElapsedMs = Number.NEGATIVE_INFINITY
  }

  recordInput(input: GameInput, elapsedMs: number): void {
    if (elapsedMs - this.lastSampleElapsedMs < this.sampleIntervalMs) return
    const normalizedElapsed = Math.max(0, Math.round(elapsedMs))
    this.samples.push({
      elapsedMs: normalizedElapsed,
      x: round4(clamp(input.x, -1, 1)),
      y: round4(clamp(input.y, -1, 1)),
    })
    this.lastSampleElapsedMs = elapsedMs
  }

  recordEvent(event: ReplayEvent): void {
    this.events.push({ ...structuredClone(event), elapsedMs: Math.max(0, Math.round(event.elapsedMs)) })
  }

  finish(durationMs: number): TrainingReplay {
    return {
      schemaVersion: 1,
      durationMs: Math.max(0, Math.round(durationMs)),
      sampleRateHz: Math.round(1000 / this.sampleIntervalMs),
      samples: structuredClone(this.samples),
      events: structuredClone(this.events),
    }
  }
}
