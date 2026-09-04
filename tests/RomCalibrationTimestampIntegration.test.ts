import { describe, expect, it } from 'vitest'
import type { RelativeMotion } from '../src/core/motion/MotionProcessor'
import { RomCalibrator } from '../src/core/motion/RomCalibrator'

const EPOCH_BASE_MS = 1_777_000_000_000
const FORWARD_MOTION: RelativeMotion = {
  relativeAngleX: -10,
  relativeAngleY: 0,
  horizontalDeg: 0,
  verticalDeg: 10,
}

describe('ROM calibration timestamp integration', () => {
  it('Epoch 时间戳在 50Hz 采样下能够通过预热期并生成有效 ROM', () => {
    const calibrator = new RomCalibrator()
    calibrator.prepare()
    calibrator.start('forward', EPOCH_BASE_MS)

    // 从 500ms 开始模拟 50Hz 数据，覆盖完整的 ROM 有效采样窗口。
    for (let elapsedMs = 500; elapsedMs <= 3_000; elapsedMs += 20) {
      calibrator.addSample(FORWARD_MOTION, EPOCH_BASE_MS + elapsedMs)
    }

    const result = calibrator.complete(EPOCH_BASE_MS + 3_000)
    expect(result).toMatchObject({ valid: true, measuredRom: 10 })
    expect(result?.validSamples).toBeGreaterThanOrEqual(30)
  })

  it('记录 Epoch 与页面相对时间混用会导致样本被预热规则丢弃', () => {
    const calibrator = new RomCalibrator()
    calibrator.prepare()
    calibrator.start('forward', EPOCH_BASE_MS)

    // 该场景固定本次 Android 故障原因，防止 Transport 再次改回 performance.now()。
    for (let relativeMs = 500; relativeMs <= 3_000; relativeMs += 20) {
      calibrator.addSample(FORWARD_MOTION, relativeMs)
    }

    const result = calibrator.complete(EPOCH_BASE_MS + 3_000)
    expect(result).toMatchObject({ valid: false, measuredRom: 0, validSamples: 0 })
  })
})
