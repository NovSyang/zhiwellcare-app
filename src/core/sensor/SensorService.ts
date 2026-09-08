import type { GameInput } from '../game-input/GameInput'
import { MotionProcessor } from '../motion/MotionProcessor'
import type { MotionConfig } from '../motion/MotionConfig'
import type { ISensorTransport } from './ISensorTransport'
import type { SensorConnectionState, SensorDevice } from './SensorDevice'
import type { SensorFrame } from './SensorFrame'
import { BATTERY_POLL_INTERVAL_MS, createEmptyBatteryState, decodeBatteryPercent, type SensorBatteryState } from './bsbt91/BsBt91Battery'
import {
  createReadBatteryCommand,
  createReadRegisterCommand,
  createSaveSettingsCommand,
  createSetOutputRate50HzCommand,
  createUnlockCommand,
} from './bsbt91/BsBt91Command'
import { BS_BT91, BS_BT91_OUTPUT_RATE, BS_BT91_REGISTER } from './bsbt91/BsBt91Constants'
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

type DelayFunction = (milliseconds: number) => Promise<void>

interface PendingRegisterRead {
  generation: number
  resolve: (frame: BsBt91RegisterFrame) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const REGISTER_READ_TIMEOUT_MS = 1000
const CONFIG_WRITE_DELAY_MS = 200
const CONFIG_SAVE_DELAY_MS = 300
const INITIALIZATION_FAILED_MESSAGE = '设备初始化失败，请重试或重新连接。'

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
  private pendingRegisterReads = new Map<number, PendingRegisterRead>()
  private connectionGeneration = 0
  private setupGeneration: number | null = null
  private transportReady = false

  constructor(
    private readonly transport: ISensorTransport,
    private readonly delay: DelayFunction = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {
    this.transport.onData((packet) => this.handleData(packet.data, packet.timestamp))
    this.transport.onStateChanged((state) => this.handleTransportState(state))
  }

  scan(): Promise<SensorDevice[]> {
    return this.transport.scan()
  }

  async connect(deviceId: string): Promise<void> {
    const generation = this.beginConnectionSetup()
    let transportConnected = false

    try {
      await this.transport.connect(deviceId)
      transportConnected = true
      this.ensureSetupActive(generation)
      await this.ensureOutputRate50Hz(generation)
      this.ensureSetupActive(generation)
      this.finishConnectionSetup(generation)
    } catch (error) {
      // 新连接或主动断开已经接管时，不允许旧任务再改变当前状态。
      if (generation !== this.connectionGeneration) throw error

      const shouldDisconnect = transportConnected || this.transportReady
      // BLE 通道尚未建立时保留平台错误类型，权限、蓝牙开关等提示才能继续准确展示。
      if (!shouldDisconnect) {
        this.failConnectionSetup(toError(error))
        throw error
      }

      const setupError = new Error(INITIALIZATION_FAILED_MESSAGE)
      this.failConnectionSetup(setupError)
      if (shouldDisconnect) {
        try { await this.transport.disconnect() } catch { /* 初始化错误仍由统一提示交给连接管理器。 */ }
      }
      throw setupError
    }
  }

  async disconnect(): Promise<void> {
    this.connectionGeneration += 1
    this.setupGeneration = null
    this.transportReady = false
    this.rejectPendingRegisterReads(new Error('设备连接已取消。'))
    this.stopBatteryPolling()
    this.gameInput = { ...this.gameInput, connected: false, x: 0, y: 0 }
    await this.transport.disconnect()
  }

  /** 每次连接都建立新代次，让上一条连接链路的回包和延时自动失效。 */
  private beginConnectionSetup(): number {
    this.connectionGeneration += 1
    this.setupGeneration = this.connectionGeneration
    this.transportReady = false
    this.rejectPendingRegisterReads(new Error('新的设备连接已开始。'))
    this.assembler.reset()
    this.frameTimes = []
    this.stopBatteryPolling()
    this.clearBattery()
    this.gameInput = { ...this.gameInput, connected: false, x: 0, y: 0 }
    return this.connectionGeneration
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

  /** 底层 connected 仅代表通道可写，业务 connected 必须等待 50Hz 校验成功。 */
  private handleTransportState(state: SensorConnectionState): void {
    if (state === 'connected') {
      // 部分平台可能重复上报同一状态，业务已就绪时无需重新进入初始化。
      if (this.state === 'connected' && this.setupGeneration === null) return
      this.transportReady = true
      this.state = 'configuring'
      this.stopBatteryPolling()
      this.gameInput = { ...this.gameInput, connected: false, x: 0, y: 0 }
      this.publish()
      return
    }

    this.state = state
    if (state === 'disconnected' || state === 'error') {
      this.transportReady = false
      this.rejectPendingRegisterReads(new Error('设备连接已中断。'))
    }
    this.stopBatteryPolling()
    this.clearBattery()
    this.gameInput = { ...this.gameInput, connected: false, x: 0, y: 0 }
    this.publish()
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
    if (!frame) return
    this.resolvePendingRegisterRead(frame)
    if (frame.registerAddress === BS_BT91_REGISTER.battery) this.handleBatteryRegister(frame, bytes)
  }

  /** 先读取 RATE；只有不等于 50Hz 时才解锁、写入并保存设备配置。 */
  private async ensureOutputRate50Hz(generation: number): Promise<void> {
    const current = await this.readRegister(BS_BT91_REGISTER.rate, generation)
    if (current.values[0] === BS_BT91_OUTPUT_RATE.hz50) return

    this.ensureSetupActive(generation)
    await this.transport.write(createUnlockCommand())
    await this.delay(CONFIG_WRITE_DELAY_MS)
    this.ensureSetupActive(generation)
    await this.transport.write(createSetOutputRate50HzCommand())
    await this.delay(CONFIG_WRITE_DELAY_MS)
    this.ensureSetupActive(generation)
    await this.transport.write(createSaveSettingsCommand())
    await this.delay(CONFIG_SAVE_DELAY_MS)
    this.ensureSetupActive(generation)

    const verified = await this.readRegister(BS_BT91_REGISTER.rate, generation)
    if (verified.values[0] !== BS_BT91_OUTPUT_RATE.hz50) {
      throw new Error('设备未确认 50Hz 回传速率。')
    }
  }

  /** 等待指定寄存器的下一条 0x71 回包；等待器必须早于写命令注册。 */
  private readRegister(registerAddress: number, generation: number): Promise<BsBt91RegisterFrame> {
    this.ensureSetupActive(generation)
    const previous = this.pendingRegisterReads.get(registerAddress)
    if (previous) {
      clearTimeout(previous.timer)
      previous.reject(new Error('同一寄存器发起了新的读取请求。'))
      this.pendingRegisterReads.delete(registerAddress)
    }

    return new Promise((resolve, reject) => {
      const pending: PendingRegisterRead = {
        generation,
        resolve,
        reject,
        timer: setTimeout(() => {
          if (this.pendingRegisterReads.get(registerAddress) !== pending) return
          this.pendingRegisterReads.delete(registerAddress)
          reject(new Error(`读取寄存器 0x${registerAddress.toString(16).padStart(2, '0')} 超时。`))
        }, REGISTER_READ_TIMEOUT_MS),
      }
      this.pendingRegisterReads.set(registerAddress, pending)

      void this.transport.write(createReadRegisterCommand(registerAddress)).catch((error) => {
        this.rejectPendingRegisterRead(registerAddress, pending, toError(error))
      })
    })
  }

  private resolvePendingRegisterRead(frame: BsBt91RegisterFrame): void {
    const pending = this.pendingRegisterReads.get(frame.registerAddress)
    if (!pending) return
    this.pendingRegisterReads.delete(frame.registerAddress)
    clearTimeout(pending.timer)
    if (pending.generation !== this.connectionGeneration) {
      pending.reject(new Error('寄存器回包来自已结束的连接。'))
      return
    }
    pending.resolve(frame)
  }

  private rejectPendingRegisterRead(registerAddress: number, pending: PendingRegisterRead, error: Error): void {
    if (this.pendingRegisterReads.get(registerAddress) !== pending) return
    this.pendingRegisterReads.delete(registerAddress)
    clearTimeout(pending.timer)
    pending.reject(error)
  }

  private rejectPendingRegisterReads(error: Error): void {
    for (const [registerAddress, pending] of this.pendingRegisterReads) {
      this.rejectPendingRegisterRead(registerAddress, pending, error)
    }
  }

  private ensureSetupActive(generation: number): void {
    if (generation !== this.connectionGeneration || this.setupGeneration !== generation) {
      throw new Error('设备连接初始化已取消。')
    }
    if (!this.transportReady) throw new Error('设备连接已中断。')
  }

  /** 验证通过后才恢复实时输入、电量轮询和业务 connected 状态。 */
  private finishConnectionSetup(generation: number): void {
    this.ensureSetupActive(generation)
    this.setupGeneration = null
    this.frameTimes = []
    this.state = 'connected'
    if (this.frame) this.gameInput = this.motion.process(this.frame, true)
    this.startBatteryPolling()
    this.publish()
  }

  private failConnectionSetup(error: Error): void {
    this.connectionGeneration += 1
    this.setupGeneration = null
    this.transportReady = false
    this.rejectPendingRegisterReads(error)
    this.stopBatteryPolling()
    this.clearBattery()
    this.gameInput = { ...this.gameInput, connected: false, x: 0, y: 0 }
    this.state = 'error'
    this.publish()
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

/** 将未知异常收敛为 Error，便于所有等待器使用同一拒绝类型。 */
function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
