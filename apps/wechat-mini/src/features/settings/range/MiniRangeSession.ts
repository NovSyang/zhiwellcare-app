import { RomCalibrationFlow } from '../../../../../../src/core/motion/RomCalibrationFlow'
import type { RelativeMotion } from '../../../../../../src/core/motion/MotionProcessor'

interface RangeDevice {
  id: string | null
  connected: boolean
  calibrated: boolean
  busy: boolean
}

interface RangePorts {
  getDevice: () => RangeDevice
  startCenter: () => void
  cancelCenter: () => void
  invalidateCenter: () => void
  subscribeSamples: (receive: (timestamp: number, motion: RelativeMotion) => void) => () => void
  publish: () => void
}

const CENTER_TIMEOUT_MS = 6000

/** 管理小程序页面和设备生命周期。角度、计时阶段和样本筛选仍由共享 ROM 流程计算。 */
export class MiniRangeSession {
  private flow = new RomCalibrationFlow()
  private deviceId: string | null = null
  private center: 'required' | 'confirming' | 'confirmed' = 'required'
  private visible = false
  private error = ''
  private centerTimeout?: ReturnType<typeof setTimeout>
  private timer?: ReturnType<typeof setInterval>
  private unsubscribe?: () => void

  constructor(private readonly ports: RangePorts) {}

  getSnapshot() {
    return { flow: this.flow.getSnapshot(Date.now()), center: this.center, error: this.error }
  }

  setVisible(visible: boolean) {
    if (this.visible === visible) return
    this.visible = visible
    if (visible) this.observeDevice()
    else this.interrupt()
  }

  observeDevice() {
    if (!this.visible) return
    const device = this.ports.getDevice()
    if (this.deviceId !== null && this.deviceId !== device.id) {
      // 同一绑定掉线可续测，不同绑定必须清空整轮临时结果。
      this.deviceId = null
      this.flow = new RomCalibrationFlow()
      this.interrupt('训练设备已更换，请从自然中心和第一项重新测量。')
    } else if (this.center !== 'required' && !device.connected) {
      this.interrupt('设备已断开。重连后请重新确认自然中心位置。')
    } else if (this.center === 'confirming' && device.calibrated) {
      this.clearCenterTimeout()
      this.center = 'confirmed'
      this.ports.publish()
    } else if (this.center === 'confirmed' && !device.calibrated) {
      this.interrupt('自然中心已失效，请重新确认后继续。')
    }
  }

  startCenter() {
    const device = this.ports.getDevice()
    if (!this.visible || !device.id || !device.connected || device.busy || this.center !== 'required') return
    this.deviceId = device.id
    this.error = ''
    try {
      // 先使旧 GameInput 失效，再开始监听本次真实的已校准状态。
      this.ports.invalidateCenter()
      this.center = 'confirming'
      this.ports.startCenter()
      if (this.center === 'confirming') {
        this.centerTimeout = setTimeout(() => this.interrupt('自然中心确认超时，请保持设备连接并重新确认。'), CENTER_TIMEOUT_MS)
      }
      this.ports.publish()
    } catch (failure) {
      this.interrupt(failure instanceof Error ? failure.message : '无法确认自然中心，请重试。')
    }
  }

  begin() {
    if (!this.canMeasure() || this.ports.getDevice().busy || !this.flow.beginCountdown()) return
    this.error = ''
    this.timer = setInterval(() => {
      if (!this.canMeasure()) { this.observeDevice(); return }
      if (this.flow.advanceCountdown(Date.now())) {
        this.stopSampling()
        this.capture()
      }
      this.ports.publish()
    }, 1000)
    this.ports.publish()
  }

  accept() {
    if (this.canMeasure() && this.flow.accept()) this.ports.publish()
  }

  retry() {
    if (this.canMeasure() && this.flow.retry()) this.ports.publish()
  }

  getCompletedRange() {
    return this.canMeasure() ? this.flow.finish() : null
  }

  cancel() {
    this.deviceId = null
    this.flow = new RomCalibrationFlow()
    this.interrupt('')
  }

  private canMeasure() {
    const device = this.ports.getDevice()
    return this.visible && this.center === 'confirmed' && device.id === this.deviceId && device.connected && device.calibrated
  }

  private capture() {
    let lastSampleAt = 0
    this.unsubscribe = this.ports.subscribeSamples((timestamp, motion) => {
      // 订阅可能回放上一帧，只接受递增的传感器 Epoch 时间戳。
      if (!this.canMeasure() || !Number.isFinite(timestamp) || timestamp <= lastSampleAt) return
      lastSampleAt = timestamp
      this.flow.addSample(motion, timestamp)
    })
    this.timer = setInterval(() => {
      if (!this.canMeasure()) { this.observeDevice(); return }
      if (this.flow.complete(Date.now())) this.stopSampling()
      this.ports.publish()
    }, 100)
  }

  private interrupt(error = this.error) {
    const wasConfirming = this.center === 'confirming'
    this.center = 'required'
    this.error = error
    this.clearCenterTimeout()
    this.stopSampling()
    // 未接受的 review 同样属于当前未完成方向，已接受方向留在共享流程中。
    this.flow.abortCurrentAttempt()
    this.flow.retry()
    // 协调器负责释放占用，即使清理报告异常也让页面退出并停止计时。
    if (wasConfirming) {
      try { this.ports.cancelCenter() }
      catch { this.error ||= '结束自然中心确认时出现异常，请重试。' }
    }
    this.ports.publish()
  }

  private clearCenterTimeout() {
    clearTimeout(this.centerTimeout)
    this.centerTimeout = undefined
  }

  private stopSampling() {
    clearInterval(this.timer)
    this.timer = undefined
    this.unsubscribe?.()
    this.unsubscribe = undefined
  }
}
