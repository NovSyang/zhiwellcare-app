import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MiniRangeSession } from '../apps/wechat-mini/src/features/settings/range/MiniRangeSession'
import { profileFromMeasuredRange, createDefaultMotionProfile } from '../src/core/motion/MotionProfile'
import { MotionProfileService } from '../src/core/motion/MotionProfileService'
import { ROM_DIRECTION_ORDER, type RomDirection } from '../src/core/motion/RomCalibrationState'
import type { RelativeMotion } from '../src/core/motion/MotionProcessor'
import { SensorService } from '../src/core/sensor/SensorService'
import { WebUnsupportedSensorTransport } from '../src/platform/web/WebUnsupportedSensorTransport'

const clockStart = 1_700_000_000_000

/** 模拟协调器、有效姿态帧和页面时钟，保留真实共享 ROM 流程。 */
function fixture() {
  const device = { id: 'one' as string | null, connected: true, calibrated: true, busy: false }
  let receive: ((timestamp: number, motion: RelativeMotion) => void) | undefined
  const startCenter = vi.fn()
  const cancelCenter = vi.fn()
  const invalidateCenter = vi.fn(() => { device.calibrated = false })
  const unsubscribe = vi.fn(() => { receive = undefined })
  const subscribeSamples = vi.fn((listener: NonNullable<typeof receive>) => { receive = listener; return unsubscribe })
  const session = new MiniRangeSession({
    getDevice: () => device, startCenter, cancelCenter, invalidateCenter, subscribeSamples, publish: () => {},
  })
  const update = (next: Partial<typeof device>) => { Object.assign(device, next); session.observeDevice() }
  function confirm() { session.startCenter(); update({ calibrated: true }) }
  function sample(direction: RomDirection, angle: number, timestamp = Date.now()) {
    const horizontalDeg = direction === 'left' ? -angle : direction === 'right' ? angle : 0
    const verticalDeg = direction === 'backward' ? -angle : direction === 'forward' ? angle : 0
    receive?.(timestamp, { relativeAngleX: -verticalDeg, relativeAngleY: horizontalDeg, horizontalDeg, verticalDeg })
  }
  function measure(direction: RomDirection, angle = 24) {
    session.begin()
    vi.advanceTimersByTime(3000)
    for (let i = 0; i < 149; i += 1) {
      vi.advanceTimersByTime(20)
      sample(direction, angle)
    }
    vi.advanceTimersByTime(20)
  }
  session.setVisible(true)
  return { session, update, confirm, sample, measure, startCenter, cancelCenter, invalidateCenter, unsubscribe, subscribeSamples }
}

describe('微信活动范围向导', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(clockStart) })
  afterEach(() => { vi.useRealTimers() })

  it('未连接时禁用中心和测量，旧中心不能替代新一轮确认', () => {
    const f = fixture()
    f.update({ connected: false })
    f.session.startCenter()
    expect(f.startCenter).not.toHaveBeenCalled()
    f.update({ connected: true, calibrated: true })
    f.session.begin()
    expect(f.session.getSnapshot().flow.phase).toBe('guide')
    f.session.startCenter()
    expect(f.invalidateCenter).toHaveBeenCalledBefore(f.startCenter)
    expect(f.session.getSnapshot().center).toBe('confirming')
    f.session.begin()
    expect(f.session.getSnapshot().flow.phase).toBe('guide')
    f.update({ calibrated: true })
    expect(f.session.getSnapshot().center).toBe('confirmed')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('自然中心超时释放占用，重试并隐藏页面会取消尚未完成的确认', () => {
    const f = fixture()
    f.session.startCenter()
    vi.advanceTimersByTime(6000)
    expect(f.cancelCenter).toHaveBeenCalledTimes(1)
    expect(f.session.getSnapshot()).toMatchObject({ center: 'required', error: expect.stringContaining('超时') })
    f.session.startCenter()
    f.session.setVisible(false)
    f.session.setVisible(false)
    expect(f.cancelCenter).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('中心启动报错和确认时断线都能回到可重试状态', () => {
    const f = fixture()
    f.startCenter.mockImplementationOnce(() => { throw new Error('设备暂忙') })
    f.session.startCenter()
    expect(f.session.getSnapshot()).toMatchObject({ center: 'required', error: '设备暂忙' })
    f.session.startCenter()
    f.update({ connected: false, calibrated: false })
    expect(f.session.getSnapshot()).toMatchObject({ center: 'required', error: expect.stringContaining('断开') })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('调用共享倒计时，三秒前不订阅测量，失效的中心阻止临界帧开启采样', () => {
    const f = fixture()
    f.confirm()
    f.session.begin()
    expect(f.session.getSnapshot().flow.countdown).toBe(3)
    vi.advanceTimersByTime(1000)
    expect(f.session.getSnapshot().flow.countdown).toBe(2)
    vi.advanceTimersByTime(1000)
    expect(f.session.getSnapshot().flow.countdown).toBe(1)
    f.update({ calibrated: false })
    vi.advanceTimersByTime(1000)
    expect(f.subscribeSamples).not.toHaveBeenCalled()
    expect(f.session.getSnapshot()).toMatchObject({ center: 'required', flow: { phase: 'guide' } })
  })

  it('共享流程会拒绝重复帧累加、预热期间的样本及角度不足的结果', () => {
    const f = fixture()
    f.confirm()
    f.session.begin()
    vi.advanceTimersByTime(3000)
    for (let i = 0; i < 24; i += 1) {
      vi.advanceTimersByTime(20)
      f.sample('forward', 100)
    }
    vi.advanceTimersByTime(20)
    for (let i = 0; i < 100; i += 1) f.sample('forward', 24)
    vi.advanceTimersByTime(2500)
    f.session.accept()
    expect(f.session.getSnapshot().flow).toMatchObject({
      phase: 'review', calibration: { result: { valid: false, validSamples: 1, message: expect.stringContaining('样本不足') } },
    })
    f.session.retry()
    f.measure('forward', 2)
    f.session.accept()
    expect(f.session.getSnapshot().flow).toMatchObject({
      phase: 'review', calibration: { result: { valid: false, message: expect.stringContaining('范围过小') } },
    })
  })

  it.each(['measuring', 'review'] as const)('断线时保留已接受的方向并重测当前 %s', (phase) => {
    const f = fixture()
    f.confirm()
    f.measure('forward')
    f.session.accept()
    if (phase === 'measuring') { f.session.begin(); vi.advanceTimersByTime(3000) }
    else f.measure('backward')
    f.update({ connected: false, calibrated: false })
    expect(f.unsubscribe).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
    expect(f.session.getSnapshot()).toMatchObject({
      center: 'required', flow: { phase: 'guide', currentDirection: 'backward', calibration: { measuredRange: { forwardMax: 24 } } },
    })
    f.update({ connected: true, calibrated: true })
    f.session.begin()
    expect(f.session.getSnapshot().flow.phase).toBe('guide')
    f.confirm()
    f.measure('backward', 21)
    f.session.accept()
    expect(f.session.getSnapshot().flow.currentDirection).toBe('left')
  })

  it('更换绑定清空整轮结果，退出页面停止剩余采样', () => {
    const f = fixture()
    f.confirm()
    f.measure('forward')
    f.session.accept()
    f.session.begin()
    vi.advanceTimersByTime(3000)
    f.update({ id: 'two' })
    expect(f.session.getSnapshot()).toMatchObject({
      center: 'required', flow: { phase: 'guide', currentDirection: 'forward', calibration: { measuredRange: {} } },
    })
    f.confirm()
    f.session.begin()
    vi.advanceTimersByTime(3000)
    f.session.setVisible(false)
    expect(f.unsubscribe).toHaveBeenCalledTimes(3)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('四方向按共享顺序汇总，失败保存保留旧配置和可重试结果', async () => {
    const f = fixture()
    f.confirm()
    for (const [index, direction] of ROM_DIRECTION_ORDER.entries()) {
      expect(f.session.getSnapshot().flow.currentDirection).toBe(direction)
      f.measure(direction, 20 + index)
      f.session.accept()
    }
    const range = f.session.getCompletedRange()
    expect(range).toEqual({ forwardMax: 20, backwardMax: 21, leftMax: 22, rightMax: 23 })
    if (!range) throw new Error('未生成范围汇总')
    const previous = { ...createDefaultMotionProfile(), trainingRatio: 0.75 }
    const save = vi.fn().mockRejectedValueOnce(new Error('写入失败')).mockResolvedValue(undefined)
    const service = new MotionProfileService({ load: async () => previous, save, clear: async () => {} }, new SensorService(new WebUnsupportedSensorTransport()))
    await service.load()
    const next = profileFromMeasuredRange(range, service.getCurrent())
    await expect(service.save(next)).rejects.toThrow('写入失败')
    expect(service.getCurrent()).toEqual(previous)
    expect(f.session.getCompletedRange()).toEqual(range)
    await service.save(next)
    expect(service.getCurrent()).toMatchObject({ measuredRange: range, activeRange: { forwardMax: 15 }, trainingRatio: 0.75 })
    f.session.cancel()
    expect(f.session.getCompletedRange()).toBeNull()
    expect(f.session.getSnapshot().center).toBe('required')
  })
})
