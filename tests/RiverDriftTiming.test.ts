import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GameInput } from '../src/core/game-input/GameInput'
import { RiverDriftController } from '../src/games/river-drift/RiverDriftController'
import { defaultRiverDriftGameConfig } from '../src/games/river-drift/RiverDriftGameConfig'
import type { RiverDriftTrainingResult } from '../src/games/river-drift/RiverDriftTrainingResult'

const connectedInput: GameInput = { x: 0.2, y: 0.1, connected: true, calibrated: true, timestamp: 0 }

afterEach(() => vi.restoreAllMocks())

// 拆分 Pixi 后，从控制器的公开快照检查双方共用的有效时间。
describe('RiverDriftController 有效时间', () => {
  it('倒计时后训练，暂停时间不计入结果并保存完成事件', () => {
    const completed: RiverDriftTrainingResult[] = []
    const replayTypes: string[] = []
    vi.spyOn(performance, 'now').mockReturnValue(1_000)
    const config = { ...defaultRiverDriftGameConfig, sessionDurationMs: 1_000, stopSpawningBeforeEndMs: 200 }
    const game = new RiverDriftController({ nowMonotonicMs: () => performance.now() }, config, {
      onCompleted: (result) => completed.push(result),
      onReplayEvent: (event) => replayTypes.push(event.type),
    })
    game.setInput(connectedInput)
    game.start()
    game.update(4_000)
    expect(game.getFrame(4_000).session.state).toBe('playing')
    for (let now = 4_020; now <= 4_500; now += 20) game.update(now)
    game.pause(4_500)
    expect(game.getFrame(8_000).session.playingElapsedMs).toBe(500)
    game.resume(8_000)
    for (let now = 8_020; now <= 8_500; now += 20) game.update(now)
    game.update(8_520)
    expect(completed).toHaveLength(1)
    expect(completed[0].durationMs).toBe(1_000)
    expect(replayTypes).toContain('pause')
    expect(replayTypes).toContain('resume')
    expect(replayTypes.at(-1)).toBe('river-complete')
  })
})
