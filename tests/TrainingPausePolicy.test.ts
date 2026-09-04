import { describe, expect, it } from 'vitest'
import { pauseReasonAfterBackground, pauseReasonAfterDisconnect, shouldAutoResume } from '../src/core/game/TrainingPausePolicy'

describe('TrainingPausePolicy', () => {
  it('运行或倒计时断线标记为系统暂停', () => {
    expect(pauseReasonAfterDisconnect('none', 'playing')).toBe('disconnect')
    expect(pauseReasonAfterDisconnect('none', 'countdown')).toBe('disconnect')
    expect(shouldAutoResume('disconnect')).toBe(true)
  })

  it('手动暂停后断线仍保持手动暂停', () => {
    expect(pauseReasonAfterDisconnect('manual', 'paused')).toBe('manual')
    expect(shouldAutoResume('manual')).toBe(false)
  })

  it('后台暂停可在重新校准后恢复，但不会覆盖用户手动暂停', () => {
    expect(pauseReasonAfterBackground('none', 'countdown')).toBe('app-background')
    expect(pauseReasonAfterBackground('none', 'playing')).toBe('app-background')
    expect(pauseReasonAfterBackground('manual', 'paused')).toBe('manual')
    expect(shouldAutoResume('app-background')).toBe(true)
  })
})
