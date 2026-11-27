import {
  BS_BT91, SensorTransportError, type IClock, type ISensorTransport,
  type SensorConnectionState, type SensorDataPacket, type SensorDevice,
} from '../../../../../src/core/shared'

type FoundCallback = (event: { devices: Array<{
  deviceId: string
  name?: string
  localName?: string
  advertisServiceUUIDs?: string[]
}> }) => void
type AdapterCallback = (event: { available: boolean }) => void
type ConnectionCallback = (event: { deviceId: string; connected: boolean }) => void
type DataCallback = (event: { deviceId: string; serviceId: string; characteristicId: string; value: ArrayBuffer }) => void
type DeviceOption = { deviceId: string }
type ServiceOption = DeviceOption & { serviceId: string }
type CharacteristicOption = ServiceOption & { characteristicId: string }

/** 只描述微信桥接实际使用的字段，测试可在原 APP 的构建环境运行。 */
export interface WeChatBleApi {
  openBluetoothAdapter(): Promise<unknown>
  closeBluetoothAdapter(): Promise<unknown>
  getBluetoothAdapterState(): Promise<{ available: boolean }>
  startBluetoothDevicesDiscovery(options: { allowDuplicatesKey: boolean }): Promise<unknown>
  stopBluetoothDevicesDiscovery(): Promise<unknown>
  onBluetoothDeviceFound(callback: FoundCallback): void
  offBluetoothDeviceFound(callback: FoundCallback): void
  onBluetoothAdapterStateChange(callback: AdapterCallback): void
  offBluetoothAdapterStateChange(callback: AdapterCallback): void
  createBLEConnection(options: DeviceOption & { timeout: number }): Promise<unknown>
  closeBLEConnection(options: DeviceOption): Promise<unknown>
  getBLEDeviceServices(options: DeviceOption): Promise<{ services: Array<{ uuid: string }> }>
  getBLEDeviceCharacteristics(options: ServiceOption): Promise<{ characteristics: Array<{
    uuid: string
    properties: { notify: boolean; indicate: boolean; write: boolean; writeDefault?: boolean; writeNoResponse?: boolean }
  }> }>
  notifyBLECharacteristicValueChange(options: CharacteristicOption & { state: boolean }): Promise<unknown>
  onBLEConnectionStateChange(callback: ConnectionCallback): void
  offBLEConnectionStateChange(callback: ConnectionCallback): void
  onBLECharacteristicValueChange(callback: DataCallback): void
  offBLECharacteristicValueChange(callback: DataCallback): void
  writeBLECharacteristicValue(options: CharacteristicOption & {
    writeType?: 'write' | 'writeNoResponse'
    value: ArrayBuffer
  }): Promise<unknown>
}

interface Link {
  deviceId: string
  serviceId: string
  writeId: string
  writeType?: 'write' | 'writeNoResponse'
}

const CONNECT_TIMEOUT_MS = 10_000
const WRITE_TIMEOUT_MS = 3_000
const DEFAULT_WRITE_LIMIT = 20

/** 微信 BLE 每个连接拥有独立的监听、写队列和失效标记。 */
export class WeChatBleTransport implements ISensorTransport {
  private readonly dataListeners = new Set<(packet: SensorDataPacket) => void>()
  private readonly stateListeners = new Set<(state: SensorConnectionState) => void>()
  private state: SensorConnectionState = 'idle'
  private generation = 0
  private link: Link | null = null
  private scanning: Promise<SensorDevice[]> | null = null
  private connecting: Promise<void> | null = null
  private closing: Promise<void> | null = null
  private cancelScan: (() => void) | null = null
  private removeLinkListeners: (() => void) | null = null
  private cancelWrite: (() => void) | null = null
  private writeTail = Promise.resolve()
  private opened = false
  private disposed = false

  constructor(
    private readonly api: WeChatBleApi,
    private readonly clock: Pick<IClock, 'nowEpochMs'>,
    private readonly scanDurationMs = 2_500,
  ) {}

  scan(): Promise<SensorDevice[]> {
    if (this.disposed || this.connecting || this.closing) return Promise.reject(cancelled())
    this.scanning ??= this.scanCandidates(this.generation).finally(() => { this.scanning = null })
    return this.scanning
  }

  async connect(deviceId: string): Promise<void> {
    if (this.disposed || this.connecting) throw cancelled()
    if (this.link || this.closing) await this.disconnect()
    this.cancelScan?.()
    await this.scanning?.catch(() => undefined)
    if (this.disposed || this.connecting || this.closing) throw cancelled()
    const generation = ++this.generation
    const job = this.connectLink(deviceId, generation)
    this.connecting = job
    try {
      await job
    } finally {
      this.connecting = null
    }
  }

  disconnect(): Promise<void> {
    if (this.closing) return this.closing
    const deviceId = this.link?.deviceId
    const connecting = this.connecting
    const scanning = this.scanning
    this.invalidateLink()
    this.closing = Promise.resolve().then(async () => {
      try {
        this.publish('disconnected')
        await scanning?.catch(() => undefined)
        await connecting?.catch(() => undefined)
        if (deviceId) await this.closeDevice(deviceId)
      } finally {
        this.closing = null
      }
    })
    return this.closing
  }

  /** 返回前台前重置蓝牙会话，下次连接重新订阅并校准。 */
  async suspend(): Promise<void> {
    try {
      await this.disconnect()
    } finally {
      await this.closeAdapter()
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true
    try {
      await this.suspend()
    } finally {
      this.dataListeners.clear()
      this.stateListeners.clear()
    }
  }

  write(data: Uint8Array): Promise<void> {
    const link = this.link
    if (!link) return Promise.reject(cancelled())
    if (!data.length || data.length > DEFAULT_WRITE_LIMIT) {
      return Promise.reject(new SensorTransportError('operation-failed', '蓝牙指令长度无效。'))
    }
    // 复制字节区间，避免调用方复用缓冲区影响排队中的命令。
    const value = new Uint8Array(data).buffer
    const job = this.writeTail.then(() => this.writeToLink(link, value))
    this.writeTail = job.catch(() => undefined)
    return job
  }

  onData(callback: (packet: SensorDataPacket) => void): () => void {
    this.dataListeners.add(callback)
    return () => this.dataListeners.delete(callback)
  }

  onStateChanged(callback: (state: SensorConnectionState) => void): () => void {
    this.stateListeners.add(callback)
    callback(this.state)
    return () => this.stateListeners.delete(callback)
  }

  private async scanCandidates(generation: number): Promise<SensorDevice[]> {
    const devices = new Map<string, SensorDevice>()
    const onFound: FoundCallback = ({ devices: found }) => {
      if (generation !== this.generation) return
      for (const device of found) {
        const name = (device.localName || device.name || '').trim()
        // 部分固件只广播名称，因此同时检查广告服务和已有 APP 的名称规则。
        if (!device.advertisServiceUUIDs?.some((uuid) => matchesUuid(uuid, BS_BT91.serviceUuid))
          && !/(bs|bt91|wobble|zwkl-wrist|不倒翁)/i.test(name)) continue
        devices.set(device.deviceId, { id: device.deviceId, name: name || 'BS-BT91' })
      }
    }
    try {
      await this.openAdapter()
      this.ensureCurrent(generation)
      if (!this.link) this.publish('scanning')
      this.api.onBluetoothDeviceFound(onFound)
      let discoveryStarted = false
      try {
        await this.api.startBluetoothDevicesDiscovery({ allowDuplicatesKey: true })
        discoveryStarted = true
        this.ensureCurrent(generation)
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, this.scanDurationMs)
          this.cancelScan = () => { clearTimeout(timer); resolve() }
        })
        this.ensureCurrent(generation)
        return [...devices.values()]
      } finally {
        this.cancelScan = null
        this.api.offBluetoothDeviceFound(onFound)
        if (discoveryStarted) await this.api.stopBluetoothDevicesDiscovery()
      }
    } catch (error) {
      throw mapBleError(error, '扫描设备')
    } finally {
      if (generation === this.generation && this.state === 'scanning') this.publish('idle')
    }
  }

  private async connectLink(deviceId: string, generation: number): Promise<void> {
    let connected = false
    try {
      this.publish('connecting')
      await this.openAdapter()
      this.ensureCurrent(generation)
      this.listenForLink(deviceId, generation)
      await this.api.createBLEConnection({ deviceId, timeout: CONNECT_TIMEOUT_MS })
      connected = true
      this.ensureCurrent(generation)
      this.publish('discovering')
      const { services } = await this.api.getBLEDeviceServices({ deviceId })
      this.ensureCurrent(generation)
      const service = services.find(({ uuid }) => matchesUuid(uuid, BS_BT91.serviceUuid))
      if (!service) throw new SensorTransportError('operation-failed', '设备缺少 BS-BT91 的 FFE5 服务。')
      const serviceId = service.uuid
      const { characteristics } = await this.api.getBLEDeviceCharacteristics({ deviceId, serviceId })
      this.ensureCurrent(generation)
      const notify = characteristics.find(({ uuid, properties }) =>
        matchesUuid(uuid, BS_BT91.notifyUuid) && (properties.notify || properties.indicate))
      const write = characteristics.find(({ uuid, properties }) =>
        matchesUuid(uuid, BS_BT91.writeUuid) && (properties.write || properties.writeDefault || properties.writeNoResponse))
      if (!notify || !write) throw new SensorTransportError('operation-failed', '设备缺少可订阅的 FFE4 或可写的 FFE9 特征。')
      const writeWithResponse = write.properties.writeDefault || write.properties.write
      this.publish('subscribing')
      await this.api.notifyBLECharacteristicValueChange({
        deviceId, serviceId, characteristicId: notify.uuid, state: true,
      })
      this.ensureCurrent(generation)
      this.link = {
        deviceId, serviceId, writeId: write.uuid,
        writeType: writeWithResponse && write.properties.writeNoResponse
          ? undefined : writeWithResponse ? 'write' : 'writeNoResponse',
      }
      this.publish('connected')
    } catch (error) {
      if (generation === this.generation) {
        this.invalidateLink()
        this.publish('error')
      }
      if (connected) {
        try { await this.closeDevice(deviceId) } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], '连接失败，且蓝牙连接清理失败。')
        }
      }
      throw mapBleError(error, '连接设备')
    }
  }

  private listenForLink(deviceId: string, generation: number): void {
    const onState: ConnectionCallback = (event) => {
      if (!event.connected && event.deviceId === deviceId && generation === this.generation) {
        this.invalidateLink()
        this.publish('disconnected')
      }
    }
    const onData: DataCallback = (event) => {
      const link = this.link
      if (!link || generation !== this.generation || event.deviceId !== deviceId
        || !matchesUuid(event.serviceId, BS_BT91.serviceUuid)
        || !matchesUuid(event.characteristicId, BS_BT91.notifyUuid)) return
      const packet = { data: new Uint8Array(event.value.slice(0)), timestamp: this.clock.nowEpochMs() }
      for (const callback of this.dataListeners) callback(packet)
    }
    this.api.onBLEConnectionStateChange(onState)
    this.api.onBLECharacteristicValueChange(onData)
    this.removeLinkListeners = () => {
      this.api.offBLEConnectionStateChange(onState)
      this.api.offBLECharacteristicValueChange(onData)
    }
  }

  private async writeToLink(link: Link, value: ArrayBuffer): Promise<void> {
    if (link !== this.link) throw cancelled()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      this.cancelWrite = () => reject(cancelled())
      timer = setTimeout(() => {
        reject(new SensorTransportError('operation-failed', '蓝牙写入超时，请重新连接设备。'))
        // 原生请求仍可能挂起，必须先断开才能执行下一条指令。
        void this.disconnect().catch((error: unknown) => console.warn('清理蓝牙连接失败', mapBleError(error, '断开设备').message))
      }, WRITE_TIMEOUT_MS)
    })
    try {
      await Promise.race([timeout, this.api.writeBLECharacteristicValue({
        deviceId: link.deviceId, serviceId: link.serviceId, characteristicId: link.writeId,
        writeType: link.writeType, value,
      })])
    } catch (error) {
      throw mapBleError(error, '写入设备')
    } finally {
      clearTimeout(timer)
      this.cancelWrite = null
    }
  }

  private readonly handleAdapterState: AdapterCallback = ({ available }) => {
    if (!available && !this.disposed && (this.scanning || this.connecting || this.link)) {
      this.invalidateLink()
      this.publish('disconnected')
    }
  }

  private async openAdapter(): Promise<void> {
    if (!this.opened) {
      await this.api.openBluetoothAdapter()
      this.opened = true
      this.api.onBluetoothAdapterStateChange(this.handleAdapterState)
    }
    const { available } = await this.api.getBluetoothAdapterState()
    if (!available) throw new SensorTransportError('bluetooth-disabled', '请打开手机蓝牙后重试。')
  }

  private async closeAdapter(): Promise<void> {
    if (!this.opened) return
    this.opened = false
    this.api.offBluetoothAdapterStateChange(this.handleAdapterState)
    await this.api.closeBluetoothAdapter()
  }

  private async closeDevice(deviceId: string): Promise<void> {
    try { await this.api.closeBLEConnection({ deviceId }) } catch (error) {
      // 对端已经断开时，微信可能返回 no connection。
      if (bleCode(error) !== 10006) throw mapBleError(error, '断开设备')
    }
  }

  private invalidateLink(): void {
    this.generation += 1
    this.link = null
    this.cancelScan?.()
    this.cancelWrite?.()
    this.removeLinkListeners?.()
    this.removeLinkListeners = null
  }

  private ensureCurrent(generation: number): void {
    if (this.disposed || generation !== this.generation) throw cancelled()
  }

  private publish(state: SensorConnectionState): void {
    if (this.state === state) return
    this.state = state
    for (const callback of this.stateListeners) callback(state)
  }
}

function matchesUuid(uuid: string, expected: string): boolean {
  const normalized = uuid.toLowerCase()
  return normalized === expected || normalized === expected.slice(4, 8)
}

function cancelled(): SensorTransportError {
  return new SensorTransportError('operation-failed', '蓝牙操作已取消或设备已断开。')
}

function bleCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('errCode' in error)) return undefined
  return typeof error.errCode === 'number' ? error.errCode : undefined
}

/** 将微信错误映射到共享重试策略，界面无需解析平台错误码。 */
function mapBleError(error: unknown, action: string): SensorTransportError {
  if (error instanceof SensorTransportError) return error
  const code = bleCode(error)
  const reason = error && typeof error === 'object' && 'errMsg' in error ? String(error.errMsg) : String(error)
  if (code === 10009 || /not supported/i.test(reason)) {
    return new SensorTransportError('unsupported', '此环境不支持低功耗蓝牙，请在手机微信中使用。')
  }
  if (/authorize|permission|auth deny/i.test(reason)) {
    return new SensorTransportError('permission-denied', '蓝牙权限未开启，请在手机设置中允许微信使用蓝牙。')
  }
  if (code === 10001) return new SensorTransportError('bluetooth-disabled', '请打开手机蓝牙后重试。')
  return new SensorTransportError('operation-failed', `${action}失败${code === undefined ? '' : `（${code}）`}，请重试。`)
}
