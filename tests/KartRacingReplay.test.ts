import { describe, expect, it, vi } from 'vitest'
import type { TrainingReplay } from '../src/core/replay/TrainingReplay'
import { defaultKartRacingGameConfig } from '../src/games/kart-racing/KartRacingGameConfig'
import { buildKartRacingReplayFrames, KartRacingReplayPlayer, resolveKartRacingGameConfig } from '../src/games/kart-racing/replay/KartRacingReplayPlayer'

const replay: TrainingReplay = {
  schemaVersion: 1,
  durationMs: 1_000,
  sampleRateHz: 25,
  samples: [{ elapsedMs: 0, x: 0, y: 0 }, { elapsedMs: 1_000, x: 0.8, y: 0.6 }],
  events: [{ elapsedMs: 0, type: 'kart-start', payload: { version: 1, lateral: 0, speed: 14.4, seed: 42 } }],
}

describe('KartRacingReplay', () => {
  it('预计算车辆距离和横向轨迹并支持 Seek 与倍速', () => {
    const frames = buildKartRacingReplayFrames(replay, replay.events, defaultKartRacingGameConfig)
    expect(frames.at(-1)!.distance).toBeGreaterThan(0)
    expect(frames.at(-1)!.lateral).toBeGreaterThan(0)
    const player = new KartRacingReplayPlayer()
    player.load(replay)
    player.seek(500)
    player.setPlaybackRate(2)
    expect(player.getSnapshot()).toMatchObject({ state: 'paused', currentTimeMs: 500, playbackRate: 2 })
  })

  it('回放不依赖随机数，损坏配置回退默认值', () => {
    const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('回放不应随机') })
    expect(() => buildKartRacingReplayFrames(replay, replay.events, defaultKartRacingGameConfig)).not.toThrow()
    expect(resolveKartRacingGameConfig({ cruiseSpeed: Number.NaN }).cruiseSpeed).toBe(defaultKartRacingGameConfig.cruiseSpeed)
    random.mockRestore()
  })

  it('缺少开始事件时明确拒绝加载', () => {
    expect(() => new KartRacingReplayPlayer().load({ ...replay, events: [] })).toThrow('缺少训练开始事件')
  })
})
