import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GameInput } from '../src/core/game-input/GameInput'
import { TrainingSession } from '../src/core/training/TrainingSession'
import { TrajectoryFollowGame } from '../src/games/trajectory-follow/TrajectoryFollowGame'
import type { TrajectoryFollowGameConfig } from '../src/games/trajectory-follow/TrajectoryFollowGameConfig'
import type { TrajectoryFollowTrainingResult } from '../src/games/trajectory-follow/TrajectoryFollowTrainingResult'

const config: TrajectoryFollowGameConfig = {
  sessionDurationMs: 2_000, cycleDurationMs: 1_000, horizontalAmplitude: 0.65, verticalAmplitude: 0.45,
  toleranceRadius: 0.18, playerRadius: 18, guideRadius: 18, referenceSampleIntervalMs: 40,
  metricSampleIntervalMs: 40, trailWindowMs: 2_500,
}
const input = (connected = true): GameInput => ({ x: 0, y: 0, connected, calibrated: connected, timestamp: 0 })
interface Internals { session: TrainingSession; update(now: number): void }

afterEach(() => vi.restoreAllMocks())

describe('TrajectoryFollowGame 有效时间', () => {
  it('3 秒倒计时后开始，并排除断线等待后完成原会话', () => {
    const completed: TrajectoryFollowTrainingResult[] = []
    const replayTypes: string[] = []
    const now = vi.spyOn(performance, 'now').mockReturnValue(1_000)
    const game = new TrajectoryFollowGame(config, { onCompleted: (result) => completed.push(result), onReplayEvent: (event) => replayTypes.push(event.type) })
    const internals = game as unknown as Internals
    game.setInput(input())
    game.start()
    internals.update(3_999)
    expect(internals.session.getSnapshot(3_999).state).toBe('countdown')
    internals.update(4_000)
    expect(internals.session.getSnapshot(4_000).state).toBe('playing')
    now.mockReturnValue(5_000)
    game.setInput(input(false))
    expect(internals.session.getSnapshot(10_000).playingElapsedMs).toBe(1_000)
    game.setInput(input())
    game.resume(15_000)
    internals.update(16_000)
    expect(completed).toHaveLength(1)
    expect(completed[0].durationMs).toBe(2_000)
    expect(replayTypes).toEqual(['reference-path', 'pause', 'resume'])
  })
})
