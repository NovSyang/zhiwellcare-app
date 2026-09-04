import type { GameInput } from '../game-input/GameInput'
import { MotionProcessor } from '../motion/MotionProcessor'
import type { MotionConfig } from '../motion/MotionConfig'
import type { ISensorTransport } from './ISensorTransport'
import type { SensorConnectionState, SensorDevice } from './SensorDevice'
import type { SensorFrame } from './SensorFrame'
import { BATTERY_POLL_INTERVAL_MS, createEmptyBatteryState, decodeBatteryPercent, type SensorBatteryState } from './bsbt91/BsBt91Battery'
import { createReadBatteryCommand } from './bsbt91/BsBt91Command'
import { BS_BT91, BS_BT91_REGISTER } from './bsbt91/BsBt91Constants'
import { BsBt91FrameAssembler } from './bsbt91/BsBt91FrameAssembler'
import { BsBt91Parser } from './bsbt91/BsBt91Parser'
import { BsBt91RegisterParser, type BsBt91RegisterFrame } from './bsbt91/BsBt91RegisterParser'

export interface SensorRuntimeSnapshot {
  state: SensorConnectionState
  frame: SensorFrame | null
  gameInput: GameInput
  rateHz: number
  rawHex: string
  battery: SensorBatteryState
}

export class SensorService {
  private assembler = new BsBt91FrameAssembler()
  private parser = new BsBt91Parser()
  private registerParser = new BsBt91RegisterParser()
  readonly motion = new MotionProcessor()

  private snapshotCallbacks = new Set<(snapshot: SensorRuntimeSnapshot) => void>()
  private frameTimes: number[] = []
  private state: SensorConnectionState = 'idle'
  private frame: SensorFrame | null = null
  private gameInput: GameInput = {
    x: 0,
    y: 0,
    connected: false,
    calibrated: false,
    timestamp: 0,
  }
  private rawHex = ''
  private battery = createEmptyBatteryState()
  private batteryPollTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly transport: ISensorTransport) {
    this.transport.onData((packet) => this.handleData(packet.data, packet.timestamp))
    this.transport.onStateChanged((state) => {
      const wasConnected = this.state === 'connected'
      this.state = state
      if (state === 'connected' && !wasConnected) {
        this.startBatteryPolling()
      } else if (state !== 'connected') {
        this.stopBatteryPolling()
        this.clearBattery()
        this.gameInput = { ...this.gameInput, connected: false, x: 0, y: 0 }
      }
      this.publish()
    })
  }

  scan(): Promise<SensorDevice[]> {
    return this.transport.scan()
  }

  connect(deviceId: string): Promise<void> {
    this.assembler.reset()
    this.frameTimes = []
    return this.transport.connect(deviceId)
  }

  disconnect(): Promise<void> {
    return this.transport.disconnect()
  }

  /** 发送读取命令；电量值会稍后通过 FFE4 的 0x71 Notify 返回。 */
  async readBattery(): Promise<void> {
    if (this.state !== 'connected') return
    await this.transport.write(createReadBatteryCommand())
  }

  startCalibration(): void {
    this.motion.startCalibration(1000)
    this.publish()
  }

  /** 应用新的 ROM 与死区后，立即刷新最近一帧对应的游戏输入。 */
  updateMotionConfig(config: MotionConfig): void {
    this.motion.updateConfig(config)
    if (this.frame) {
      this.gameInput = this.motion.process(this.frame, this.state === 'connected')
    }
    this.publish()
  }

  /** 断线或更换设备后清除旧中心零点，避免错误复用校准结果。 */
  resetCalibration(): void {
    this.motion.resetCalibration()
    this.gameInput = this.frame
      ? this.motion.process(this.frame, this.state === 'connected')
      : { ...this.gameInput, calibrated: false, x: 0, y: 0 }
    this.publish()
  }

  onSnapshot(callback: (snapshot: SensorRuntimeSnapshot) => void): () => void {
    this.snapshotCallbacks.add(callback)
    callback(this.getSnapshot())
    return () => this.snapshotCallbacks.delete(callback)
  }

  private handleData(chunk: Uint8Array, timestamp: number): void {
    const assembled = this.assembler.push(chunk, timestamp)
    for (const item of assembled) {
      this.rawHex = toHex(item.bytes)
      if (item.bytes[1] === BS_BT91.realtimeFrameType) this.handleRealtimeFrame(item.bytes, item.timestamp)
      else if (item.bytes[1] === BS_BT91.registerFrameType) this.handleRegisterFrame(item.bytes, item.timestamp)
    }
  }

  /** 0x61 是唯一可进入 MotionProcessor 与频率统计的高频姿态数据。 */
  private handleRealtimeFrame(bytes: Uint8Array, timestamp: number): void {
    const frame = this.parser.parseRealtimeFrame(bytes, timestamp)
    if (!frame) return

    this.frame = frame
    this.frameTimes.push(frame.timestamp)
    const threshold = frame.timestamp - 1000
    while (this.frameTimes.length > 0 && this.frameTimes[0] < threshold) {
      this.frameTimes.shift()
    }

    this.gameInput = this.motion.process(frame, this.state === 'connected')
    this.publish()
  }

  /** 0x71 是低频寄存器状态，不能影响姿态输入或采样频率。 */
  private handleRegisterFrame(bytes: Uint8Array, timestamp: number): void {
    const frame = this.registerParser.parse(bytes, timestamp)
    if (!frame || frame.registerAddress !== BS_BT91_REGISTER.battery) return
    this.handleBatteryRegister(frame, bytes)
  }

  /** 处理已验证的 Battery Register，保存 Raw、百分比、更新时间和原始寄存器帧。 */
  private handleBatteryRegister(frame: BsBt91RegisterFrame, bytes: Uint8Array): void {
    const rawValue = frame.values[0] ?? null
    this.battery = {
      rawValue,
      percent: rawValue === null ? null : decodeBatteryPercent(rawValue),
      updatedAt: frame.timestamp,
      rawHex: toHex(bytes),
    }
    this.publish()
  }

  /** 递归调度保证同一时刻最多只有一个低频电量读取任务。 */
  private startBatteryPolling(): void {
    this.stopBatteryPolling()
    void this.pollBattery()
  }

  private async pollBattery(): Promise<void> {
    if (this.state !== 'connected') return
    try {
      await this.readBattery()
    } catch {
      // 单次读取失败只等待下一轮，不影响 BLE 连接与正在进行的训练。
    }
    if (this.state === 'connected') {
      this.batteryPollTimer = setTimeout(() => { void this.pollBattery() }, BATTERY_POLL_INTERVAL_MS)
    }
  }

  private stopBatteryPolling(): void {
    if (this.batteryPollTimer !== null) clearTimeout(this.batteryPollTimer)
    this.batteryPollTimer = null
  }

  private clearBattery(): void {
    this.battery = createEmptyBatteryState()
  }

  private getSnapshot(): SensorRuntimeSnapshot {
    return {
      state: this.state,
      frame: this.frame,
      gameInput: this.gameInput,
      rateHz: this.frameTimes.length,
      rawHex: this.rawHex,
      battery: { ...this.battery },
    }
  }

  private publish(): void {
    const snapshot = this.getSnapshot()
    for (const callback of this.snapshotCallbacks) callback(snapshot)
  }
}

/** 保留完整帧十六进制文本，供开发者与厂家调试软件逐字节对照。 */
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0').toUpperCase())
    .join(' ')
}
