import { describe, expect, it } from 'vitest'
import type { TrainingReplay } from '../src/core/replay/TrainingReplay'
import { extractReferenceSamples, TrajectoryFollowReplayPlayer } from '../src/games/trajectory-follow/replay/TrajectoryFollowReplayPlayer'

const replay: TrainingReplay = {
  schemaVersion: 1,
  durationMs: 1000,
  sampleRateHz: 25,
  samples: [{ elapsedMs: 0, x: 0, y: 0 }, { elapsedMs: 1000, x: 0.5, y: 0 }],
  events: [{ elapsedMs: 0, type: 'reference-path', payload: { samples: [{ elapsedMs: 0, x: 0, y: 0 }, { elapsedMs: 1000, x: -0.5, y: 0 }] } }],
}

describe('TrajectoryFollowReplayPlayer', () => {
  it('读取保存的参考路径并支持 Seek 与倍速状态', () => {
    const player = new TrajectoryFollowReplayPlayer()
    player.load(replay)
    player.seek(500)
    player.setPlaybackRate(2)
    expect(player.getSnapshot()).toMatchObject({ state: 'paused', currentTimeMs: 500, durationMs: 1000, playbackRate: 2 })
    expect(extractReferenceSamples(replay.events)).toHaveLength(2)
    player.destroy()
  })

  it('缺少参考路径时明确拒绝加载而不重新计算', () => {
    const player = new TrajectoryFollowReplayPlayer()
    expect(() => player.load({ ...replay, events: [] })).toThrow('缺少训练时保存的参考路径')
  })
})
