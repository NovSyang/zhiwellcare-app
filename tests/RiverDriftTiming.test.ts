import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GameInput } from '../src/core/game-input/GameInput'
import { TrainingSession } from '../src/core/training/TrainingSession'
import { RiverDriftGame } from '../src/games/river-drift/RiverDriftGame'
import { defaultRiverDriftGameConfig } from '../src/games/river-drift/RiverDriftGameConfig'
import type { RiverDriftTrainingResult } from '../src/games/river-drift/RiverDriftTrainingResult'

interface RiverDriftInternals { session: TrainingSession; tick(now: number): void }
const connectedInput: GameInput = { x: 0.2, y: 0.1, connected: true, calibrated: true, timestamp: 0 }

afterEach(() => vi.restoreAllMocks())

describe('RiverDriftGame 有效时间', () => {
  it('倒计时后训练，暂停时间不计入结果并保存完成事件', () => {
    const completed: RiverDriftTrainingResult[] = []
    const replayTypes: string[] = []
    vi.spyOn(performance, 'now').mockReturnValue(1_000)
    const config = { ...defaultRiverDriftGameConfig, sessionDurationMs: 1_000, stopSpawningBeforeEndMs: 200 }
    const game = new RiverDriftGame(config, {
      onCompleted: (result) => completed.push(result),
      onReplayEvent: (event) => replayTypes.push(event.type),
    })
    const internals = game as unknown as RiverDriftInternals
    game.setInput(connectedInput)
    game.start()
    internals.tick(4_000)
    expect(internals.session.getSnapshot(4_000).state).toBe('playing')
    for (let now = 4_020; now <= 4_500; now += 20) internals.tick(now)
    game.pause(4_500)
    expect(internals.session.getSnapshot(8_000).playingElapsedMs).toBe(500)
    game.resume(8_000)
    for (let now = 8_020; now <= 8_500; now += 20) internals.tick(now)
    internals.tick(8_520)
    expect(completed).toHaveLength(1)
    expect(completed[0].durationMs).toBe(1_000)
    expect(replayTypes).toContain('pause')
    expect(replayTypes).toContain('resume')
    expect(replayTypes.at(-1)).toBe('river-complete')
  })
})
