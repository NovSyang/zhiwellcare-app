import { describe, expect, it } from 'vitest'
import type { GameInput } from '../src/core/game-input/GameInput'
import { TrainingSession } from '../src/core/training/TrainingSession'
import type { TargetAttemptResult } from '../src/games/target-reach/TargetReachTrainingResult'
import { TargetReachGame } from '../src/games/target-reach/TargetReachGame'
import type { TargetReachGameConfig } from '../src/games/target-reach/TargetReachGameConfig'
import type { TargetReachReplayEvent } from '../src/games/target-reach/replay/TargetReachReplayEvent'

const config: TargetReachGameConfig = {
  sessionDurationMs: 60_000, targetCount: 20, targetDistance: 0.7, targetRadius: 0.2,
  playerRadius: 20, holdTimeMs: 300, targetTimeoutMs: 8000, movementThreshold: 0.08,
  enabledDirections: ['right'],
}
const neutral = (timestamp: number): GameInput => ({ x: 0, y: 0, connected: true, calibrated: true, timestamp })
const onTarget = (timestamp: number): GameInput => ({ x: 0.7, y: 0, connected: true, calibrated: true, timestamp })

interface GameInternals {
  session: TrainingSession
  attempts: TargetAttemptResult[]
  update(now: number): void
}

/** 不挂载 Pixi Canvas，直接验证游戏时间轴与目标判定的纯运行逻辑。 */
function createPlayingGame(): { game: TargetReachGame; internals: GameInternals } {
  const game = new TargetReachGame(config)
  const internals = game as unknown as GameInternals
  internals.session.start(1, 0)
  game.setInput(neutral(1))
  internals.update(1) // 生成第一个固定向右目标。
  return { game, internals }
}

describe('TargetReachGame 暂停计时', () => {
  it('无暂停时以有效训练时间记录反应与到达时间', () => {
    const { game, internals } = createPlayingGame()
    game.setInput(onTarget(501)); internals.update(501)
    internals.update(801)

    expect(internals.attempts).toHaveLength(1)
    expect(internals.attempts[0].reactionTimeMs).toBe(500)
    expect(internals.attempts[0].reachTimeMs).toBe(800)
  })

  it('首次动作后暂停再恢复，反应时间不会为负且暂停不计入到达时间', () => {
    const { game, internals } = createPlayingGame()
    game.setInput(onTarget(501)); internals.update(501)
    game.pause(601)
    game.resume(10_601)
    game.setInput(onTarget(10_700)); internals.update(10_700)
    internals.update(11_000)

    expect(internals.attempts).toHaveLength(1)
    expect(internals.attempts[0].reactionTimeMs).toBe(500)
    expect(internals.attempts[0].reachTimeMs).toBe(999)
    expect(internals.attempts[0].reactionTimeMs).toBeGreaterThanOrEqual(0)
  })

  it('Hold 中暂停会清空保持进度，恢复后必须重新保持完整 300ms', () => {
    const { game, internals } = createPlayingGame()
    game.setInput(onTarget(501)); internals.update(501)
    game.pause(601)
    game.resume(10_601)
    game.setInput(onTarget(10_700)); internals.update(10_700)
    expect(internals.attempts).toHaveLength(0)
    internals.update(11_000)
    expect(internals.attempts).toHaveLength(1)
  })

  it('长时间暂停不消耗单目标超时时间，连续暂停后数据仍非负', () => {
    const { game, internals } = createPlayingGame()
    game.pause(100); game.resume(10_100)
    internals.update(10_500)
    expect(internals.attempts).toHaveLength(0)
    game.setInput(onTarget(10_600)); internals.update(10_600)
    game.pause(10_650); game.resume(20_650)
    game.setInput(onTarget(20_700)); internals.update(20_700)
    internals.update(21_000)

    expect(internals.attempts[0].reactionTimeMs).toBeGreaterThanOrEqual(0)
    expect(internals.attempts[0].reachTimeMs).toBeGreaterThanOrEqual(internals.attempts[0].reactionTimeMs ?? 0)
  })

  it('记录目标与暂停事件，并使用非负有效训练时间', () => {
    const events: TargetReachReplayEvent[] = []
    const game = new TargetReachGame(config, { onReplayEvent: (event) => events.push(event) })
    const internals = game as unknown as GameInternals
    internals.session.start(1, 0)
    game.setInput(neutral(1)); internals.update(1)
    game.pause(101); game.resume(10_101)
    game.setInput(onTarget(10_601)); internals.update(10_601); internals.update(10_901)

    expect(events.map((event) => event.type)).toEqual(['target-start', 'pause', 'resume', 'target-success'])
    expect(events.every((event) => event.elapsedMs >= 0)).toBe(true)
    expect(events[0]).toMatchObject({ payload: { index: 1, direction: 'right', targetX: 0.7, targetY: 0 } })
  })
})
