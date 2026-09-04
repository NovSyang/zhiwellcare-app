import type { MotionRange } from './MotionConfig'
import type { RelativeMotion } from './MotionProcessor'
import { ROM_DIRECTION_ORDER, type RomCalibrationState, type RomDirection } from './RomCalibrationState'

export interface RomCalibrationResult {
  direction: RomDirection
  measuredRom: number
  validSamples: number
  valid: boolean
  message: string | null
}

export interface RomCalibratorSnapshot {
  state: RomCalibrationState
  direction: RomDirection | null
  elapsedMs: number
  sampleCount: number
  result: RomCalibrationResult | null
  measuredRange: Partial<MotionRange>
}

/**
 * 采集中心零点后的相对运动，使用 P95 抑制单个传感器异常峰值。
 * 此类不依赖 Vue、BLE 或页面，因此可独立稳定测试。
 */
export class RomCalibrator {
  private state: RomCalibrationState = 'idle'
  private direction: RomDirection | null = null
  private startedAt = 0
  private samples: number[] = []
  private result: RomCalibrationResult | null = null
  private measuredRange: Partial<MotionRange> = {}

  constructor(
    readonly durationMs = 3000,
    readonly warmupMs = 500,
    readonly minimumSamples = 30,
    readonly minimumRomDeg = 3,
  ) {}

  prepare(): void { this.state = 'ready' }

  start(direction: RomDirection, now: number): void {
    this.state = 'measuring'
    this.direction = direction
    this.startedAt = now
    this.samples = []
    this.result = null
  }

  addSample(motion: RelativeMotion, now: number): void {
    if (this.state !== 'measuring' || !this.direction) return
    const elapsed = now - this.startedAt
    // 前 500ms 属于使用者开始动作的过渡期，不参与 ROM 统计。
    if (elapsed < this.warmupMs || elapsed > this.durationMs) return
    this.samples.push(directionMagnitude(this.direction, motion))
  }

  complete(now: number): RomCalibrationResult | null {
    if (this.state !== 'measuring' || !this.direction || now - this.startedAt < this.durationMs) return null
    const measuredRom = percentile(this.samples, 0.95)
    const valid = this.samples.length >= this.minimumSamples && measuredRom >= this.minimumRomDeg
    this.result = {
      direction: this.direction,
      measuredRom,
      validSamples: this.samples.length,
      valid,
      message: valid
        ? null
        : this.samples.length < this.minimumSamples
          ? '有效样本不足，请保持设备连接并重新测量。'
          : '本次活动范围过小，请确认操作方向或重新测量。',
    }
    this.state = 'review'
    return structuredClone(this.result)
  }

  accept(): boolean {
    if (this.state !== 'review' || !this.result?.valid) return false
    const key = rangeKeyFor(this.result.direction)
    this.measuredRange[key] = this.result.measuredRom
    this.state = ROM_DIRECTION_ORDER.every((direction) => this.measuredRange[rangeKeyFor(direction)] !== undefined)
      ? 'completed'
      : 'ready'
    this.direction = null
    return true
  }

  retry(): void {
    if (this.state !== 'review') return
    this.state = 'ready'
    this.direction = null
    this.result = null
  }

  cancel(): void { this.state = 'cancelled' }

  getSnapshot(now: number): RomCalibratorSnapshot {
    return {
      state: this.state,
      direction: this.direction,
      elapsedMs: this.state === 'measuring' ? Math.max(0, now - this.startedAt) : 0,
      sampleCount: this.samples.length,
      result: this.result ? structuredClone(this.result) : null,
      measuredRange: structuredClone(this.measuredRange),
    }
  }

  getMeasuredRange(): MotionRange | null {
    const range = this.measuredRange
    if (!ROM_DIRECTION_ORDER.every((direction) => range[rangeKeyFor(direction)] !== undefined)) return null
    return {
      leftMax: range.leftMax!, rightMax: range.rightMax!,
      forwardMax: range.forwardMax!, backwardMax: range.backwardMax!,
    }
  }
}

/** 返回当前方向上的正向幅度，反向或串轴动作自然记为 0。 */
export function directionMagnitude(direction: RomDirection, motion: RelativeMotion): number {
  switch (direction) {
    case 'left': return Math.max(0, -motion.horizontalDeg)
    case 'right': return Math.max(0, motion.horizontalDeg)
    case 'forward': return Math.max(0, motion.verticalDeg)
    case 'backward': return Math.max(0, -motion.verticalDeg)
  }
}

/** 线性插值百分位，避免最大值被单个异常峰值支配。 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = (sorted.length - 1) * Math.max(0, Math.min(1, p))
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return sorted[lower]
  const weight = index - lower
  return sorted[lower] * (1 - weight) + sorted[upper] * weight
}

function rangeKeyFor(direction: RomDirection): keyof MotionRange {
  return direction === 'left' ? 'leftMax'
    : direction === 'right' ? 'rightMax'
      : direction === 'forward' ? 'forwardMax'
        : 'backwardMax'
}
