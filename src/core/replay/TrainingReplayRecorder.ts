import type { GameInput } from '../game-input/GameInput'
import { clamp, round4 } from './ReplayMath'
import { copyReplayEvent, copyTrainingReplay } from './TrainingReplayCopy'
import type { ReplayEvent, TrainingReplay } from './TrainingReplay'

/** 将实时 GameInput 节流为适合本地保存与平滑回放的 25Hz 历史。 */
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
    const snapshot = copyReplayEvent(event)
    if (snapshot) this.events.push(snapshot)
  }

  finish(durationMs: number): TrainingReplay {
    return copyTrainingReplay({
      schemaVersion: 1,
      durationMs: Math.max(0, Math.round(durationMs)),
      sampleRateHz: Math.round(1000 / this.sampleIntervalMs),
      samples: this.samples,
      events: this.events,
    })
  }
}
