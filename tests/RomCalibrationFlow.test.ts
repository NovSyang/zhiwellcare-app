import { describe, expect, it } from 'vitest'
import type { RelativeMotion } from '../src/core/motion/MotionProcessor'
import { RomCalibrator } from '../src/core/motion/RomCalibrator'
import { RomCalibrationFlow } from '../src/core/motion/RomCalibrationFlow'
import type { RomDirection } from '../src/core/motion/RomCalibrationState'

const motionFor = (direction: RomDirection): RelativeMotion => ({
  relativeAngleX: direction === 'forward' ? -6 : direction === 'backward' ? 6 : 0,
  relativeAngleY: direction === 'left' ? -6 : direction === 'right' ? 6 : 0,
  horizontalDeg: direction === 'left' ? -6 : direction === 'right' ? 6 : 0,
  verticalDeg: direction === 'forward' ? 6 : direction === 'backward' ? -6 : 0,
})

/** 使用短测量窗口驱动真实 RomCalibrator，避免测试复制算法行为。 */
function completeCurrentDirection(flow: RomCalibrationFlow, startedAt: number): void {
  expect(flow.beginCountdown()).toBe(true)
  expect(flow.advanceCountdown(startedAt - 2_000)).toBe(false)
  expect(flow.advanceCountdown(startedAt - 1_000)).toBe(false)
  expect(flow.advanceCountdown(startedAt)).toBe(true)
  const direction = flow.getSnapshot(startedAt).currentDirection
  flow.addSample(motionFor(direction), startedAt + 100)
  flow.complete(startedAt + 1_000)
}

describe('RomCalibrationFlow', () => {
  it('从向前说明开始，三秒倒计时完成前不会启动测量', () => {
    const flow = new RomCalibrationFlow(new RomCalibrator(1_000, 0, 1, 3))
    expect(flow.getSnapshot(0)).toMatchObject({ phase: 'guide', currentDirection: 'forward', countdown: 3 })
    flow.beginCountdown()
    expect(flow.advanceCountdown(1_000)).toBe(false)
    expect(flow.getSnapshot(1_000)).toMatchObject({ phase: 'countdown', countdown: 2 })
    expect(flow.advanceCountdown(2_000)).toBe(false)
    expect(flow.getSnapshot(2_000).calibration.state).toBe('ready')
    expect(flow.advanceCountdown(3_000)).toBe(true)
    expect(flow.getSnapshot(3_000)).toMatchObject({ phase: 'measuring', currentDirection: 'forward' })
  })

  it('按前后左右固定推进，第四方向接受后先进入汇总再完成', () => {
    const flow = new RomCalibrationFlow(new RomCalibrator(1_000, 0, 1, 3))
    const order: RomDirection[] = ['forward', 'backward', 'left', 'right']
    for (let index = 0; index < order.length; index += 1) {
      expect(flow.getSnapshot(index * 5_000).currentDirection).toBe(order[index])
      expect(flow.finish()).toBeNull()
      completeCurrentDirection(flow, index * 5_000 + 3_000)
      expect(flow.getSnapshot(index * 5_000 + 4_000).phase).toBe('review')
      expect(flow.accept()).toBe(true)
    }
    expect(flow.getSnapshot(20_000).phase).toBe('summary')
    expect(flow.finish()).toEqual({ leftMax: 6, rightMax: 6, forwardMax: 6, backwardMax: 6 })
  })

  it('重测回到当前方向说明，断线中止保留此前接受结果', () => {
    const flow = new RomCalibrationFlow(new RomCalibrator(1_000, 0, 1, 3))
    completeCurrentDirection(flow, 3_000)
    expect(flow.retry()).toBe(true)
    expect(flow.getSnapshot(4_000)).toMatchObject({ phase: 'guide', currentDirection: 'forward' })

    completeCurrentDirection(flow, 8_000)
    flow.accept()
    expect(flow.getSnapshot(9_000).currentDirection).toBe('backward')
    flow.beginCountdown()
    flow.advanceCountdown(10_000)
    flow.advanceCountdown(11_000)
    flow.advanceCountdown(12_000)
    flow.abortCurrentAttempt()

    const snapshot = flow.getSnapshot(12_100)
    expect(snapshot).toMatchObject({ phase: 'guide', currentDirection: 'backward', countdown: 3 })
    expect(snapshot.calibration.measuredRange).toMatchObject({ forwardMax: 6 })
  })
})
