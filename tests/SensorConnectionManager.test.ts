import { describe, expect, it } from 'vitest'
import type { IDeviceBindingRepository, DeviceBinding } from '../src/core/sensor/DeviceBinding'
import { SensorConnectionManager, type SensorConnectionPort } from '../src/core/sensor/SensorConnectionManager'
import type { SensorConnectionState, SensorDevice } from '../src/core/sensor/SensorDevice'
import { SensorTransportError } from '../src/core/sensor/SensorTransportError'

class BindingRepository implements IDeviceBindingRepository {
  saved: DeviceBinding | null
  constructor(binding: DeviceBinding | null) { this.saved = binding }
  async load(): Promise<DeviceBinding | null> { return this.saved }
  async save(binding: DeviceBinding): Promise<void> { this.saved = binding }
  async clear(): Promise<void> { this.saved = null }
}

class FakeSensor implements SensorConnectionPort {
  scans: SensorDevice[][] = []
  connected: string[] = []
  disconnected = 0
  resetCount = 0
  scanCount = 0
  connectFailures = new Set<string>()
  scanError: Error | null = null
  callback: ((snapshot: { state: SensorConnectionState }) => void) | null = null

  async scan(): Promise<SensorDevice[]> {
    this.scanCount += 1
    if (this.scanError) throw this.scanError
    return this.scans.shift() ?? []
  }
  async connect(deviceId: string): Promise<void> {
    this.connected.push(deviceId)
    if (this.connectFailures.has(deviceId)) throw new Error(`连接 ${deviceId} 失败`)
  }
  async disconnect(): Promise<void> { this.disconnected += 1; this.emit('disconnected') }
  resetCalibration(): void { this.resetCount += 1 }
  onSnapshot(callback: (snapshot: { state: SensorConnectionState }) => void): () => void {
    this.callback = callback
    callback({ state: 'idle' })
    return () => { this.callback = null }
  }
  emit(state: SensorConnectionState): void { this.callback?.({ state }) }
}

const boundDevice: DeviceBinding = { deviceId: 'old', address: 'AA', name: 'BS', updatedAt: 1 }
const foundDevice: SensorDevice = { id: 'new', address: 'AA', name: 'BS' }

describe('SensorConnectionManager', () => {
  it('启动时立即连接已绑定设备，且不等待退避时间', async () => {
    const delays: number[] = []
    const sensor = new FakeSensor()
    sensor.scans = [[foundDevice]]
    const manager = new SensorConnectionManager(sensor, new BindingRepository(boundDevice), async (delay) => { delays.push(delay) })
    await manager.initialize()
    await manager.startupConnect()

    expect(sensor.connected).toEqual(['new'])
    expect(delays).toEqual([])
    expect(manager.getSnapshot()).toMatchObject({ reconnectState: 'idle', operation: 'idle', attemptNumber: 0 })
  })

  it('首次失败后按 1/2/5 秒重试，第四次成功', async () => {
    const delays: number[] = []
    const sensor = new FakeSensor()
    sensor.scans = [[], [], [], [foundDevice]]
    const manager = new SensorConnectionManager(sensor, new BindingRepository(boundDevice), async (delay) => { delays.push(delay) })
    await manager.initialize()
    await manager.startupConnect()

    expect(delays).toEqual([1000, 2000, 5000])
    expect(sensor.connected).toEqual(['new'])
  })

  it('四次都失败后停止自动扫描并等待用户', async () => {
    const sensor = new FakeSensor()
    sensor.scans = [[], [], [], []]
    const manager = new SensorConnectionManager(sensor, new BindingRepository(boundDevice), async () => {})
    await manager.initialize()
    await manager.startupConnect()

    expect(sensor.scanCount).toBe(4)
    expect(manager.getSnapshot()).toMatchObject({ reconnectState: 'waiting-user', operation: 'idle', attemptNumber: 4, retryIndex: 3 })
  })

  it('无绑定设备时不会扫描或自动连接陌生设备', async () => {
    const sensor = new FakeSensor()
    const manager = new SensorConnectionManager(sensor, new BindingRepository(null), async () => {})
    await manager.initialize()
    await manager.startupConnect()

    expect(sensor.scanCount).toBe(0)
    expect(sensor.connected).toEqual([])
  })

  it('权限或蓝牙关闭属于终止错误，不执行后续退避重试', async () => {
    const sensor = new FakeSensor()
    sensor.scanError = new SensorTransportError('permission-denied', '请允许附近设备权限。')
    const manager = new SensorConnectionManager(sensor, new BindingRepository(boundDevice), async () => {})
    await manager.initialize()
    await manager.startupConnect()

    expect(sensor.scanCount).toBe(1)
    expect(manager.getSnapshot()).toMatchObject({ reconnectState: 'waiting-user', message: '请允许附近设备权限。' })
  })

  it('首次设置发现设备时同样采用有限扫描，并在发现后立即停止重试', async () => {
    const delays: number[] = []
    const sensor = new FakeSensor()
    sensor.scans = [[], [foundDevice]]
    const manager = new SensorConnectionManager(sensor, new BindingRepository(null), async (delay) => { delays.push(delay) })
    await manager.initialize()

    await expect(manager.discoverDevicesForSelection()).resolves.toEqual([foundDevice])
    expect(delays).toEqual([1000])
    expect(sensor.scanCount).toBe(2)
  })

  it('取消工作流后，过期等待不会继续下一轮扫描', async () => {
    const sensor = new FakeSensor()
    sensor.scans = [[]]
    const gate: { release: (() => void) | null } = { release: null }
    const manager = new SensorConnectionManager(sensor, new BindingRepository(boundDevice), async () => new Promise<void>((resolve) => { gate.release = resolve }))
    await manager.initialize()
    const task = manager.startupConnect()
    await Promise.resolve()
    manager.cancelCurrentWorkflow()
    gate.release?.()
    await task

    expect(sensor.scanCount).toBe(1)
    expect(manager.getSnapshot().operation).toBe('idle')
  })

  it('异常断线恢复会清除中心校准，主动断开不会触发恢复', async () => {
    const sensor = new FakeSensor()
    sensor.scans = [[foundDevice]]
    const manager = new SensorConnectionManager(sensor, new BindingRepository(boundDevice), async () => {})
    await manager.initialize()
    await manager.reconnectAfterDrop()
    expect(sensor.resetCount).toBe(2)
    expect(sensor.connected).toEqual(['new'])

    sensor.emit('connected')
    await manager.disconnectManually()
    expect(sensor.scanCount).toBe(1)
  })

  it('手动重连会先主动断开，再使用完整四次连接规则', async () => {
    const sensor = new FakeSensor()
    sensor.scans = [[foundDevice]]
    const manager = new SensorConnectionManager(sensor, new BindingRepository(boundDevice), async () => {})
    await manager.initialize()
    sensor.emit('connected')
    await manager.reconnectNow()

    expect(sensor.disconnected).toBe(1)
    expect(sensor.connected).toEqual(['new'])
    expect(sensor.resetCount).toBe(2)
  })

  it('更换失败时恢复旧 Binding 并尝试恢复旧设备', async () => {
    const sensor = new FakeSensor()
    sensor.connectFailures.add('replacement')
    sensor.scans = [[{ id: 'old-restored', address: 'AA', name: 'BS' }]]
    const repository = new BindingRepository(boundDevice)
    const manager = new SensorConnectionManager(sensor, repository, async () => {})
    await manager.initialize()

    await expect(manager.switchDevice({ id: 'replacement', name: 'New BS' })).rejects.toThrow('连接 replacement 失败')
    expect(repository.saved).toMatchObject({ deviceId: 'old-restored', address: 'AA', name: 'BS' })
    expect(sensor.connected).toEqual(['replacement', 'old-restored'])
  })

  it('忘记设备会断开、清除绑定并重置中心校准', async () => {
    const sensor = new FakeSensor()
    const repository = new BindingRepository(boundDevice)
    const manager = new SensorConnectionManager(sensor, repository, async () => {})
    await manager.initialize()
    await manager.forgetCurrentDevice()

    expect(sensor.disconnected).toBe(1)
    expect(sensor.resetCount).toBe(1)
    expect(repository.saved).toBeNull()
    expect(manager.getSnapshot().binding).toBeNull()
  })
})
