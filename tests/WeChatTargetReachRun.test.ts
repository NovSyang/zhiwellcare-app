import { describe, expect, it } from 'vitest'
import { TargetReachRun } from '../apps/wechat-mini/src/features/training/session/TargetReachRun'
import { createTrainingClock } from '../apps/wechat-mini/src/platform/TrainingClock'
import { createDefaultMotionProfile } from '../src/core/shared'
import { defaultTargetReachGameConfig } from '../src/games/target-reach/TargetReachGameConfig'

/** 以相同的下发节奏模拟 50Hz 姿态，单调时间从零开始。 */
function fixture() {
  const epoch = 1_700_000_000_000
  let now = 0
  const profile = createDefaultMotionProfile(epoch)
  const device = { modelId: 'wobble-wrist-band', modelName: 'BS-BT91', capabilityTags: ['posture-sensor'] }
  const clock = { nowMonotonicMs: () => now, nowEpochMs: () => epoch + now }
  const run = new TargetReachRun({
    clock, config: { ...defaultTargetReachGameConfig, targetCount: 1, enabledDirections: ['right'] },
    profile, device, makeId: () => 'training-one',
  })
  const sample = (x = 0, connected = true, calibrated = true, timestamp = clock.nowEpochMs()) => {
    run.receive({ x, y: 0, connected, calibrated, timestamp })
  }
  const stream = (ms: number, x = 0) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 20) {
      now += 20
      sample(x)
      run.tick()
    }
  }
  const advance = (ms: number) => { now += ms; run.tick() }
  return { run, clock, sample, stream, advance, profile, device }
}

describe('微信四方挥腕训练会话', () => {
  it('真实输入序列产生指标、回放及同一条本地记录', () => {
    const { run, clock, sample, stream, profile, device } = fixture()
    sample()
    run.start()
    stream(3000)
    stream(580, 0.7)
    const record = run.getRecord()
    expect(record).toMatchObject({
      id: 'training-one', gameId: 'target-reach', gameName: '四方挥腕挑战',
      completedAt: clock.nowEpochMs(), device,
      result: { durationMs: 580, successTargets: 1, failedTargets: 0, averageReachTimeMs: 320 },
      replay: { durationMs: 580, sampleRateHz: 25 },
    })
    expect(record?.replay?.events.map(({ type, elapsedMs }) => [type, elapsedMs]))
      .toEqual([['target-start', 0], ['target-success', 320]])
    expect(record?.replay?.samples.length).toBeGreaterThan(5)
    profile.activeRange.leftMax = 1
    device.capabilityTags.push('changed')
    expect(record?.motionProfile.activeRange.leftMax).toBe(20)
    expect(record?.device?.capabilityTags).toEqual(['posture-sensor'])
    expect(run.getRecord()).toBe(record)
  })

  it('重复状态通知和断流不能产生命中', () => {
    const { run, clock, sample, stream, advance } = fixture()
    sample()
    run.start()
    stream(3000)
    stream(120, 0.7)
    const lastTimestamp = clock.nowEpochMs()
    advance(200)
    sample(0.7, true, true, lastTimestamp)
    advance(40)
    expect(run.getStatus().successTargets).toBe(0)
    advance(20)
    expect(run.getFrame().session.state).toBe('paused')
    expect(run.getStatus().reason).toBe('signal')
  })

  it('后台与断线冻结有效时长，重连后必须有新的校准输入', () => {
    const { run, sample, stream, advance } = fixture()
    sample()
    run.start()
    stream(3200)
    sample(0, false, false)
    expect(run.getStatus().reason).toBe('disconnect')
    run.setForeground(false)
    advance(10_000)
    sample(0)
    expect(() => run.resume()).toThrow('中心校准')
    run.setForeground(true)
    advance(20)
    sample(0, true, false)
    expect(() => run.resume()).toThrow('中心校准')
    advance(20)
    sample(0)
    run.resume()
    expect(run.getFrame().session.playingElapsedMs).toBe(200)
    stream(20)
    expect(run.getFrame().session.playingElapsedMs).toBe(220)
  })

  it('超过时效的初始姿态不能启动训练', () => {
    const { run, sample, clock } = fixture()
    sample(0, true, true, clock.nowEpochMs() - 1000)
    expect(run.getStatus().ready).toBe(false)
    expect(() => run.start()).toThrow('姿态数据')
  })
})

describe('微信训练时钟', () => {
  it('兼容时钟在系统回拨时保持单调，并限制向前跳时', () => {
    let epoch = 1_700_000_000_000
    const clock = createTrainingClock(null, () => epoch)
    expect(clock.nowMonotonicMs()).toBe(0)
    epoch += 20
    expect(clock.nowMonotonicMs()).toBe(20)
    epoch -= 10_000
    expect(clock.nowMonotonicMs()).toBe(20)
    epoch += 60_000
    expect(clock.nowMonotonicMs()).toBe(120)
    expect(clock.nowEpochMs()).toBe(epoch)
  })
})
