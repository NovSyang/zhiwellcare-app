import { describe, expect, it } from 'vitest'
import { TrainingSession } from '../src/core/training/TrainingSession'

describe('TrainingSession', () => {
  it('3 秒倒计时结束后进入训练状态', () => {
    const session = new TrainingSession()
    session.start(1000, 3000)

    session.update(3999)
    expect(session.getSnapshot(3999).state).toBe('countdown')

    session.update(4000)
    expect(session.getSnapshot(4000).state).toBe('playing')
  })

  it('暂停时间不计入有效训练时长', () => {
    const session = new TrainingSession()
    session.start(1, 0)
    session.pause(1001)
    session.resume(3001)

    expect(session.getSnapshot(4001).playingElapsedMs).toBe(2000)
  })

  it('倒计时期间暂停会冻结剩余时间并从原位置继续', () => {
    const session = new TrainingSession()
    session.start(1000, 3000)
    session.pause(2000)
    expect(session.getSnapshot(20_000)).toMatchObject({ state: 'paused', countdownRemainingMs: 2000, playingElapsedMs: 0 })
    session.resume(20_000)
    session.update(21_999)
    expect(session.getSnapshot(21_999).state).toBe('countdown')
    session.update(22_000)
    expect(session.getSnapshot(22_000).state).toBe('playing')
  })
})
