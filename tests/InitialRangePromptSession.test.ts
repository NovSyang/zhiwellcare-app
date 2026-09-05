import { describe, expect, it } from 'vitest'
import { InitialRangePromptSession, type InitialRangePromptContext } from '../src/core/motion/InitialRangePromptSession'

const eligible: InitialRangePromptContext = {
  connected: true,
  profile: { measuredRange: null },
  route: { path: '/games', immersive: false },
  blockingOverlayVisible: false,
}

describe('InitialRangePromptSession', () => {
  it('仅在设备已连接、范围未测量且页面没有阻塞弹窗时展示', () => {
    const session = new InitialRangePromptSession()
    expect(session.shouldShow(eligible)).toBe(true)
    expect(session.shouldShow({ ...eligible, connected: false })).toBe(false)
    expect(session.shouldShow({ ...eligible, profile: { measuredRange: { leftMax: 10, rightMax: 10, forwardMax: 10, backwardMax: 10 } } })).toBe(false)
    expect(session.shouldShow({ ...eligible, route: { path: '/calibration', immersive: false } })).toBe(false)
    expect(session.shouldShow({ ...eligible, route: { path: '/training/target-reach', immersive: true } })).toBe(false)
    expect(session.shouldShow({ ...eligible, blockingOverlayVisible: true })).toBe(false)
  })

  it('本会话处理后不再展示，新会话仍可重新判断', () => {
    const session = new InitialRangePromptSession()
    session.markHandled()
    expect(session.isHandled()).toBe(true)
    expect(session.shouldShow(eligible)).toBe(false)
    expect(new InitialRangePromptSession().shouldShow(eligible)).toBe(true)
  })
})
