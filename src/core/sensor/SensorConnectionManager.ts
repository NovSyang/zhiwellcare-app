import type { SensorRuntimeSnapshot } from './SensorService'
import type { DeviceBinding, IDeviceBindingRepository } from './DeviceBinding'
import { matchBoundDevice } from './DeviceBinding'
import type { SensorDevice } from './SensorDevice'
import type { ConnectionOperation } from './ConnectionOperation'
import { isTerminalSensorTransportError } from './SensorTransportError'

/** 自动恢复连接的独立状态，不与底层 BLE 状态混在一起。 */
export type ReconnectState = 'idle' | 'reconnecting' | 'waiting-user'

/** 首次连接加三次重试，避免无限扫描占用蓝牙资源。 */
const CONNECTION_ATTEMPT_DELAYS_MS = [0, 1000, 2000, 5000] as const
const MAX_CONNECTION_ATTEMPTS = CONNECTION_ATTEMPT_DELAYS_MS.length

export interface SensorConnectionSnapshot {
  reconnectState: ReconnectState
  binding: DeviceBinding | null
  operation: ConnectionOperation
  /** 当前总尝试序号，范围为 1 到 4；没有工作流时为 0。 */
  attemptNumber: number
  /** 0 表示首次尝试，1 到 3 分别表示三次重试；没有工作流时为 0。 */
  retryIndex: number
  maxAttempts: number
  message: string | null
}

/** 连接管理实际需要的最小传感器能力，便于独立单元测试。 */
export interface SensorConnectionPort {
  scan(): Promise<SensorDevice[]>
  connect(deviceId: string): Promise<void>
  disconnect(): Promise<void>
  resetCalibration(): void
  onSnapshot(callback: (snapshot: Pick<SensorRuntimeSnapshot, 'state'>) => void): () => void
}

type WaitFunction = (milliseconds: number) => Promise<void>

/**
 * 协调设备绑定与异常断线恢复；Transport 仍只负责原生 IPC。
 * 重连成功总会清除旧中心校准，避免旧零点用于新会话。
 */
export class SensorConnectionManager {
  private binding: DeviceBinding | null = null
  private reconnectState: ReconnectState = 'idle'
  private operation: ConnectionOperation = 'idle'
  private attemptNumber = 0
  private retryIndex = 0
  private message: string | null = null
  private manualDisconnect = false
  private previousState = 'idle'
  private listeners = new Set<(snapshot: SensorConnectionSnapshot) => void>()
  private unsubscribe: (() => void) | null = null
  private workflowVersion = 0

  constructor(
    private readonly sensor: SensorConnectionPort,
    private readonly repository: IDeviceBindingRepository,
    private readonly wait: WaitFunction = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {}

  async initialize(): Promise<void> {
    this.binding = await this.repository.load()
    this.unsubscribe ??= this.sensor.onSnapshot((snapshot) => this.handleSensorState(snapshot.state))
    this.publish()
  }

  dispose(): void {
    this.cancelCurrentWorkflow()
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  onChanged(callback: (snapshot: SensorConnectionSnapshot) => void): () => void {
    this.listeners.add(callback)
    callback(this.getSnapshot())
    return () => this.listeners.delete(callback)
  }

  getSnapshot(): SensorConnectionSnapshot {
    return {
      reconnectState: this.reconnectState,
      binding: this.binding ? { ...this.binding } : null,
      operation: this.operation,
      attemptNumber: this.attemptNumber,
      retryIndex: this.retryIndex,
      maxAttempts: MAX_CONNECTION_ATTEMPTS,
      message: this.message,
    }
  }

  /** 首次选择设备时保存绑定；页面无需直接调用底层传感器连接。 */
  async connect(device: SensorDevice): Promise<void> {
    const workflowId = this.beginWorkflow('switch-device')
    await this.connectAndSave(device, workflowId)
  }

  async disconnectManually(): Promise<void> {
    this.cancelCurrentWorkflow()
    this.manualDisconnect = true
    try {
      await this.sensor.disconnect()
    } finally {
      this.manualDisconnect = false
      this.finishIdle()
    }
  }

  /** 忘记设备同时断开 BLE，但不会影响 ROM、历史记录或回放。 */
  async forgetCurrentDevice(): Promise<void> {
    this.cancelCurrentWorkflow()
    this.manualDisconnect = true
    try {
      await this.sensor.disconnect()
    } finally {
      this.manualDisconnect = false
    }
    this.binding = null
    await this.repository.clear()
    this.sensor.resetCalibration()
    this.finishIdle()
  }

  /** 软件启动时仅恢复已绑定的设备，绝不自动绑定陌生设备。 */
  async startupConnect(): Promise<void> {
    if (!this.binding || this.previousState === 'connected') return
    await this.runBoundDeviceWorkflow('startup')
  }

  /** 用户主动重连时，已连接设备也会先安全断开后再按完整重试规则连接。 */
  async reconnectNow(): Promise<void> {
    if (!this.binding) {
      this.finishWaitingUser('尚未选择训练设备，请点击“更换设备”进行选择。')
      return
    }
    this.cancelCurrentWorkflow()
    if (this.previousState === 'connected') {
      this.manualDisconnect = true
      try {
        await this.sensor.disconnect()
      } finally {
        this.manualDisconnect = false
      }
    }
    this.sensor.resetCalibration()
    await this.runBoundDeviceWorkflow('manual-reconnect')
  }

  /** 训练期间异常掉线后自动恢复；调用方不需要自行组合扫描和连接。 */
  async reconnectAfterDrop(): Promise<void> {
    if (!this.binding || this.operation !== 'idle') return
    this.sensor.resetCalibration()
    await this.runBoundDeviceWorkflow('runtime-reconnect')
  }

  /** 选择新设备后才断开旧设备，失败时保留旧绑定并尝试恢复旧设备。 */
  async switchDevice(device: SensorDevice): Promise<void> {
    const oldBinding = this.binding ? { ...this.binding } : null
    const workflowId = this.beginWorkflow('switch-device')
    if (this.previousState === 'connected') {
      this.manualDisconnect = true
      try {
        await this.sensor.disconnect()
      } finally {
        this.manualDisconnect = false
      }
    }

    try {
      await this.connectAndSave(device, workflowId)
    } catch (error) {
      this.binding = oldBinding
      if (oldBinding) {
        await this.repository.save(oldBinding)
        await this.runBoundDeviceWorkflow('manual-reconnect')
      } else {
        this.finishWaitingUser('新设备连接失败，请重新选择训练设备。')
      }
      throw error
    }
  }

  /** 供首次设置和更换设备使用的受控扫描，不允许页面直接访问 BLE。 */
  async discoverDevicesForSelection(): Promise<SensorDevice[]> {
    const workflowId = ++this.workflowVersion
    this.operation = 'idle'
    this.reconnectState = 'idle'
    this.message = null
    this.publish()

    for (const delay of CONNECTION_ATTEMPT_DELAYS_MS) {
      if (delay > 0) await this.wait(delay)
      if (!this.isWorkflowCurrent(workflowId)) return []
      try {
        const devices = await this.sensor.scan()
        if (!this.isWorkflowCurrent(workflowId)) return []
        if (devices.length > 0) return devices
      } catch (error) {
        // 权限和蓝牙开关不会通过短时间重试恢复，立即交给用户处理。
        if (isTerminalSensorTransportError(error)) {
          this.finishWaitingUser(error.message)
          throw error
        }
      }
    }
    return []
  }

  /** 使等待、扫描或连接返回后的旧工作流不再继续业务步骤。 */
  cancelCurrentWorkflow(): void {
    this.workflowVersion += 1
    this.finishIdle()
  }

  private handleSensorState(state: string): void {
    const wasConnected = this.previousState === 'connected'
    this.previousState = state
    if (wasConnected && (state === 'disconnected' || state === 'error') && !this.manualDisconnect) {
      this.sensor.resetCalibration()
      void this.reconnectAfterDrop()
    }
    if (state === 'disconnected' && this.manualDisconnect) this.manualDisconnect = false
  }

  private async runBoundDeviceWorkflow(operation: Exclude<ConnectionOperation, 'idle' | 'switch-device'>): Promise<void> {
    if (!this.binding) return
    const workflowId = this.beginWorkflow(operation)
    for (let index = 0; index < CONNECTION_ATTEMPT_DELAYS_MS.length; index += 1) {
      const delay = CONNECTION_ATTEMPT_DELAYS_MS[index]
      this.attemptNumber = index + 1
      this.retryIndex = index
      this.message = connectionAttemptMessage(index)
      this.publish()
      if (delay > 0) await this.wait(delay)
      if (!this.isWorkflowCurrent(workflowId)) return
      try {
        const devices = await this.sensor.scan()
        if (!this.isWorkflowCurrent(workflowId)) return
        const binding: DeviceBinding | null = this.binding
        const device: SensorDevice | null = binding ? matchBoundDevice(binding, devices) : null
        if (!device) continue
        await this.connectAndSave(device, workflowId)
        return
      } catch (error) {
        if (isTerminalSensorTransportError(error)) {
          this.finishWaitingUser(error.message)
          return
        }
        // 普通扫描或连接失败后仍按照既有退避策略继续尝试。
      }
    }
    if (this.isWorkflowCurrent(workflowId)) {
      this.finishWaitingUser('未能连接训练设备，请点击右上角设备状态重新连接或更换设备。')
    }
  }

  private beginWorkflow(operation: Exclude<ConnectionOperation, 'idle'>): number {
    const workflowId = ++this.workflowVersion
    this.operation = operation
    this.reconnectState = 'reconnecting'
    this.attemptNumber = 0
    this.retryIndex = 0
    this.message = operation === 'switch-device' ? '正在连接新训练设备…' : '正在搜索并连接训练设备…'
    this.publish()
    return workflowId
  }

  private async connectAndSave(device: SensorDevice, workflowId: number): Promise<void> {
    this.attemptNumber = 1
    this.retryIndex = 0
    this.publish()
    await this.sensor.connect(device.id)
    if (!this.isWorkflowCurrent(workflowId)) return
    this.binding = { deviceId: device.id, address: device.address, name: device.name, updatedAt: Date.now() }
    await this.repository.save(this.binding)
    if (!this.isWorkflowCurrent(workflowId)) return
    this.sensor.resetCalibration()
    this.finishIdle()
  }

  private finishIdle(): void {
    this.operation = 'idle'
    this.reconnectState = 'idle'
    this.attemptNumber = 0
    this.retryIndex = 0
    this.message = null
    this.publish()
  }

  private finishWaitingUser(message: string): void {
    this.operation = 'idle'
    this.reconnectState = 'waiting-user'
    this.message = message
    this.publish()
  }

  private isWorkflowCurrent(workflowId: number): boolean {
    return workflowId === this.workflowVersion
  }

  private publish(): void {
    const snapshot = this.getSnapshot()
    for (const callback of this.listeners) callback(snapshot)
  }
}

/** 将重试序号转换为界面可直接显示的阶段提示。 */
function connectionAttemptMessage(retryIndex: number): string {
  if (retryIndex === 0) return '正在搜索并连接训练设备…'
  if (retryIndex === 1) return '首次连接未成功，正在进行第 1 次重试…'
  if (retryIndex === 2) return '正在进行第 2 次重试…'
  return '正在进行最后一次重试…'
}
