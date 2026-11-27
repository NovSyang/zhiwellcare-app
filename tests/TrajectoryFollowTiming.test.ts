import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GameInput } from '../src/core/game-input/GameInput'
import { TrajectoryFollowController } from '../src/games/trajectory-follow/TrajectoryFollowController'
import type { TrajectoryFollowGameConfig } from '../src/games/trajectory-follow/TrajectoryFollowGameConfig'
import type { TrajectoryFollowTrainingResult } from '../src/games/trajectory-follow/TrajectoryFollowTrainingResult'

const config: TrajectoryFollowGameConfig = {
  sessionDurationMs: 2_000, cycleDurationMs: 1_000, horizontalAmplitude: 0.65, verticalAmplitude: 0.45,
  toleranceRadius: 0.18, playerRadius: 18, guideRadius: 18, referenceSampleIntervalMs: 40,
  metricSampleIntervalMs: 40, trailWindowMs: 2_500,
}
const input = (connected = true): GameInput => ({ x: 0, y: 0, connected, calibrated: connected, timestamp: 0 })

afterEach(() => vi.restoreAllMocks())

// 直接验证两端共用的计时规则，不再访问 Pixi 游戏的私有字段。
describe('TrajectoryFollowController 有效时间', () => {
  it('3 秒倒计时后开始，并排除断线等待后完成原会话', () => {
    const completed: TrajectoryFollowTrainingResult[] = []
    const replayTypes: string[] = []
    const now = vi.spyOn(performance, 'now').mockReturnValue(1_000)
    const game = new TrajectoryFollowController({ nowMonotonicMs: () => performance.now() }, config, {
      onCompleted: (result) => completed.push(result),
      onReplayEvent: (event) => replayTypes.push(event.type),
    })
    game.setInput(input())
    game.start()
    game.update(3_999)
    expect(game.getFrame(3_999).session.state).toBe('countdown')
    game.update(4_000)
    expect(game.getFrame(4_000).session.state).toBe('playing')
    now.mockReturnValue(5_000)
    game.setInput(input(false))
    expect(game.getFrame(10_000).session.playingElapsedMs).toBe(1_000)
    game.setInput(input())
    game.resume(15_000)
    game.update(16_000)
    expect(completed).toHaveLength(1)
    expect(completed[0].durationMs).toBe(2_000)
    expect(replayTypes).toEqual(['reference-path', 'pause', 'resume'])
  })
})
