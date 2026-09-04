import { describe, expect, it } from 'vitest'
import { directionMagnitude, percentile, RomCalibrator } from '../src/core/motion/RomCalibrator'
import type { RelativeMotion } from '../src/core/motion/MotionProcessor'

const motion = (horizontalDeg: number, verticalDeg: number): RelativeMotion => ({ relativeAngleX: -verticalDeg, relativeAngleY: horizontalDeg, horizontalDeg, verticalDeg })

describe('RomCalibrator', () => {
  it('P95 忽略单个异常峰值并支持基础边界值', () => {
    expect(percentile([], 0.95)).toBe(0)
    expect(percentile([7], 0.95)).toBe(7)
    expect(percentile([5, 5, 5], 0.95)).toBe(5)
    expect(percentile([10, 10, 10, 1000], 0.95)).toBeLessThan(1000)
  })

  it('按指定方向取值、忽略前 500ms，并在样本足够时接受 P95', () => {
    const calibrator = new RomCalibrator(3000, 500, 30, 3)
    calibrator.start('forward', 0)
    calibrator.addSample(motion(20, 99), 300)
    for (let index = 0; index < 30; index += 1) calibrator.addSample(motion(20, 10 + index / 10), 500 + index * 50)
    const result = calibrator.complete(3000)

    expect(result?.valid).toBe(true)
    expect(result?.validSamples).toBe(30)
    expect(result?.measuredRom).toBeGreaterThan(12)
    expect(directionMagnitude('left', motion(-8, 0))).toBe(8)
    expect(directionMagnitude('backward', motion(0, -6))).toBe(6)
  })

  it('样本不足不能通过，四方向接受后才生成 Range', () => {
    const calibrator = new RomCalibrator(1000, 0, 1, 3)
    for (const direction of ['forward', 'backward', 'left', 'right'] as const) {
      calibrator.start(direction, 0)
      calibrator.addSample(direction === 'forward' ? motion(0, 6) : direction === 'backward' ? motion(0, -6) : direction === 'left' ? motion(-6, 0) : motion(6, 0), 100)
      calibrator.complete(1000)
      calibrator.accept()
    }
    expect(calibrator.getMeasuredRange()).toEqual({ leftMax: 6, rightMax: 6, forwardMax: 6, backwardMax: 6 })
  })
})
