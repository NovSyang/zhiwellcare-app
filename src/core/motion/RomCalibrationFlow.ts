import type { MotionRange } from './MotionConfig'
import type { RelativeMotion } from './MotionProcessor'
import { RomCalibrator, type RomCalibrationResult, type RomCalibratorSnapshot } from './RomCalibrator'
import { ROM_DIRECTION_ORDER, type RomDirection } from './RomCalibrationState'

/** 页面层的个人活动范围流程状态，不改变底层采样算法状态。 */
export type RomCalibrationUiPhase = 'guide' | 'countdown' | 'measuring' | 'review' | 'summary'

export interface RomCalibrationFlowSnapshot {
  phase: RomCalibrationUiPhase
  currentDirection: RomDirection
  currentDirectionIndex: number
  totalDirections: number
  countdown: number
  measurementDurationMs: number
  calibration: RomCalibratorSnapshot
  summary: MotionRange | null
}

/**
 * 固定编排“前、后、左、右”的页面交互，实际采样和 P95 计算仍由 RomCalibrator 完成。
 */
export class RomCalibrationFlow {
  private phase: RomCalibrationUiPhase = 'guide'
  private currentDirectionIndex = 0
  private countdown = 3
  private summary: MotionRange | null = null

  constructor(private readonly calibrator = new RomCalibrator()) {
    this.calibrator.prepare()
  }

  beginCountdown(): boolean {
    if (this.phase !== 'guide') return false
    this.countdown = 3
    this.phase = 'countdown'
    return true
  }

  /** 每秒调用一次；第三次调用后才真正启动底层测量。 */
  advanceCountdown(now: number): boolean {
    if (this.phase !== 'countdown') return false
    if (this.countdown > 1) {
      this.countdown -= 1
      return false
    }
    this.countdown = 0
    this.calibrator.start(this.currentDirection(), now)
    this.phase = 'measuring'
    return true
  }

  addSample(motion: RelativeMotion, now: number): void {
    if (this.phase === 'measuring') this.calibrator.addSample(motion, now)
  }

  complete(now: number): RomCalibrationResult | null {
    if (this.phase !== 'measuring') return null
    const result = this.calibrator.complete(now)
    if (result) this.phase = 'review'
    return result
  }

  accept(): boolean {
    if (this.phase !== 'review' || !this.calibrator.accept()) return false
    const range = this.calibrator.getMeasuredRange()
    if (range) {
      this.summary = range
      this.phase = 'summary'
    } else {
      this.currentDirectionIndex += 1
      this.countdown = 3
      this.phase = 'guide'
    }
    return true
  }

  retry(): boolean {
    if (this.phase !== 'review') return false
    this.calibrator.retry()
    this.countdown = 3
    this.phase = 'guide'
    return true
  }

  /** 断线时丢弃当前未完成采样，但保留此前已经接受的方向结果。 */
  abortCurrentAttempt(): void {
    if (this.phase === 'measuring') {
      this.calibrator.cancel()
      this.calibrator.prepare()
    }
    if (this.phase === 'countdown' || this.phase === 'measuring') {
      this.countdown = 3
      this.phase = 'guide'
    }
  }

  cancel(): void {
    this.calibrator.cancel()
  }

  finish(): MotionRange | null {
    return this.phase === 'summary' && this.summary ? structuredClone(this.summary) : null
  }

  getSnapshot(now: number): RomCalibrationFlowSnapshot {
    return {
      phase: this.phase,
      currentDirection: this.currentDirection(),
      currentDirectionIndex: this.currentDirectionIndex,
      totalDirections: ROM_DIRECTION_ORDER.length,
      countdown: this.countdown,
      measurementDurationMs: this.calibrator.durationMs,
      calibration: this.calibrator.getSnapshot(now),
      summary: this.summary ? structuredClone(this.summary) : null,
    }
  }

  private currentDirection(): RomDirection {
    return ROM_DIRECTION_ORDER[this.currentDirectionIndex] ?? ROM_DIRECTION_ORDER[ROM_DIRECTION_ORDER.length - 1]
  }
}
