import { describe, expect, it, vi } from 'vitest'
import type { TrainingReplay } from '../src/core/replay/TrainingReplay'
import { defaultRiverDriftGameConfig } from '../src/games/river-drift/RiverDriftGameConfig'
import { buildRiverDriftReplayFrames, resolveRiverDriftGameConfig, RiverDriftReplayPlayer } from '../src/games/river-drift/replay/RiverDriftReplayPlayer'

const replay: TrainingReplay = {
  schemaVersion: 1,
  durationMs: 1_000,
  sampleRateHz: 25,
  samples: [{ elapsedMs: 0, x: 0, y: 0 }, { elapsedMs: 1_000, x: 0.8, y: 0.4 }],
  events: [
    { elapsedMs: 0, type: 'river-start', payload: { version: 1, boatX: 0.5, boatY: 0.74 } },
    { elapsedMs: 0, type: 'segment-spawn', payload: { id: 's1', y: -0.2, height: 1.4, startCenterX: 0.5, endCenterX: 0.5, decorationVariant: 0 } },
  ],
}

describe('RiverDriftReplay', () => {
  it('预计算船体轨迹并支持 Seek 与倍速', () => {
    const frames = buildRiverDriftReplayFrames(replay, replay.events, defaultRiverDriftGameConfig)
    expect(frames.at(-1)?.x).toBeGreaterThan(0.5)
    const player = new RiverDriftReplayPlayer()
    player.load(replay)
    player.seek(500)
    player.setPlaybackRate(2)
    expect(player.getSnapshot()).toMatchObject({ state: 'paused', currentTimeMs: 500, playbackRate: 2 })
  })

  it('回放不依赖随机数，并对损坏配置回退默认值', () => {
    const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('回放不应随机') })
    expect(() => new RiverDriftReplayPlayer().load(replay, { gameConfig: { worldSpeed: 0, boatRadius: Number.NaN } })).not.toThrow()
    expect(resolveRiverDriftGameConfig({ worldSpeed: 0 }).worldSpeed).toBe(defaultRiverDriftGameConfig.worldSpeed)
    random.mockRestore()
  })

  it('缺少开始事件时明确拒绝加载', () => {
    const player = new RiverDriftReplayPlayer()
    expect(() => player.load({ ...replay, events: [] })).toThrow('缺少训练开始事件')
  })
})
