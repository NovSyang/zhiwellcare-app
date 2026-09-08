import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ISensorTransport } from '../src/core/sensor/ISensorTransport'
import type { SensorConnectionState, SensorDataPacket, SensorDevice } from '../src/core/sensor/SensorDevice'
import { SensorService, type SensorRuntimeSnapshot } from '../src/core/sensor/SensorService'

class ConfigTransport implements ISensorTransport {
  writes: Uint8Array[] = []
  rateResponses: Array<number | null> = []
  disconnectCount = 0
  failCommandByte: number | null = null
  connectError: Error | null = null
  private dataCallbacks = new Set<(packet: SensorDataPacket) => void>()
  private stateCallbacks = new Set<(state: SensorConnectionState) => void>()

  async scan(): Promise<SensorDevice[]> { return [] }
  async connect(): Promise<void> {
    if (this.connectError) throw this.connectError
    this.emitState('connecting')
    this.emitState('connected')
  }
  async disconnect(): Promise<void> {
    this.disconnectCount += 1
    this.emitState('disconnected')
  }
  async write(data: Uint8Array): Promise<void> {
    if (this.failCommandByte === data[2]) throw new Error('write failed')
    this.writes.push(Uint8Array.from(data))
    if (data[2] !== 0x27 || data[3] !== 0x03) return
    const response = this.rateResponses.shift()
    if (response !== undefined && response !== null) this.emitRegister(0x03, response)
  }
  onData(callback: (packet: SensorDataPacket) => void): () => void {
    this.dataCallbacks.add(callback)
    return () => this.dataCallbacks.delete(callback)
  }
  onStateChanged(callback: (state: SensorConnectionState) => void): () => void {
    this.stateCallbacks.add(callback)
    return () => this.stateCallbacks.delete(callback)
  }
  async dispose(): Promise<void> {}

  emitState(state: SensorConnectionState): void {
    for (const callback of this.stateCallbacks) callback(state)
  }
  emitRegister(registerAddress: number, value: number, timestamp = 100): void {
    this.emitData(registerFrame(registerAddress, value), timestamp)
  }
  emitData(data: Uint8Array, timestamp: number): void {
    for (const callback of this.dataCallbacks) callback({ data, timestamp })
  }
}

const READ_RATE = Uint8Array.from([0xff, 0xaa, 0x27, 0x03, 0x00])
const READ_BATTERY = Uint8Array.from([0xff, 0xaa, 0x27, 0x64, 0x00])
const UNLOCK = Uint8Array.from([0xff, 0xaa, 0x69, 0x88, 0xb5])
const SET_50_HZ = Uint8Array.from([0xff, 0xaa, 0x03, 0x08, 0x00])
const SAVE = Uint8Array.from([0xff, 0xaa, 0x00, 0x00, 0x00])

afterEach(() => vi.useRealTimers())

describe('SensorService 50Hz initialization', () => {
  it('已是 50Hz 时只读取 RATE，验证后才连接并开始读取电量', async () => {
    const transport = new ConfigTransport()
    transport.rateResponses = [0x08]
    const states: SensorConnectionState[] = []
    const service = new SensorService(transport)
    service.onSnapshot((snapshot) => states.push(snapshot.state))

    await service.connect('device')

    expect(transport.writes).toEqual([READ_RATE, READ_BATTERY])
    expect(states).toContain('configuring')
    expect(serviceSnapshot(service).state).toBe('connected')
    await service.disconnect()
  })

  it('非 50Hz 时按解锁、设置、保存、复核的固定顺序执行', async () => {
    const transport = new ConfigTransport()
    transport.rateResponses = [0x05, 0x08]
    const delays: number[] = []
    const service = new SensorService(transport, async (milliseconds) => { delays.push(milliseconds) })

    await service.connect('device')

    expect(delays).toEqual([200, 200, 300])
    expect(transport.writes).toEqual([READ_RATE, UNLOCK, SET_50_HZ, SAVE, READ_RATE, READ_BATTERY])
    expect(serviceSnapshot(service).state).toBe('connected')
    await service.disconnect()
  })

  it('复核仍不是 50Hz 时断开并返回统一初始化错误', async () => {
    const transport = new ConfigTransport()
    transport.rateResponses = [0x05, 0x05]
    const service = new SensorService(transport, async () => {})

    await expect(service.connect('device')).rejects.toThrow('设备初始化失败，请重试或重新连接。')

    expect(transport.disconnectCount).toBe(1)
    expect(transport.writes).toEqual([READ_RATE, UNLOCK, SET_50_HZ, SAVE, READ_RATE])
    expect(serviceSnapshot(service).state).toBe('disconnected')
  })

  it('RATE 读取超时后清理等待器并断开设备', async () => {
    vi.useFakeTimers()
    const transport = new ConfigTransport()
    transport.rateResponses = [null]
    const service = new SensorService(transport)
    const task = service.connect('device')
    const rejection = expect(task).rejects.toThrow('设备初始化失败，请重试或重新连接。')

    await vi.advanceTimersByTimeAsync(1000)
    await rejection

    expect(transport.disconnectCount).toBe(1)
    expect(serviceSnapshot(service).state).toBe('disconnected')
  })

  it('配置中主动断开会取消旧任务，恢复延时后也不会发布 connected', async () => {
    const transport = new ConfigTransport()
    transport.rateResponses = [0x05]
    const delayGate: { release: (() => void) | null } = { release: null }
    const service = new SensorService(transport, async () => new Promise<void>((resolve) => { delayGate.release = resolve }))
    const task = service.connect('device')
    await flushAsyncWork()

    expect(serviceSnapshot(service).state).toBe('configuring')
    expect(transport.writes).toEqual([READ_RATE, UNLOCK])
    await service.disconnect()
    delayGate.release?.()

    await expect(task).rejects.toThrow('设备连接初始化已取消。')
    expect(serviceSnapshot(service).state).toBe('disconnected')
    expect(transport.writes).toEqual([READ_RATE, UNLOCK])
  })

  it('配置期间不启动电量轮询，并在成功时清空旧实时帧率样本', async () => {
    const transport = new ConfigTransport()
    transport.rateResponses = [null]
    const service = new SensorService(transport)
    const task = service.connect('device')
    await flushAsyncWork()

    transport.emitData(realtimeFrame(), 200)
    transport.emitRegister(0x64, 80, 210)
    expect(serviceSnapshot(service)).toMatchObject({ state: 'configuring', rateHz: 1 })
    expect(transport.writes).toEqual([READ_RATE])

    transport.emitRegister(0x03, 0x08, 220)
    await task

    expect(serviceSnapshot(service)).toMatchObject({ state: 'connected', rateHz: 0 })
    expect(transport.writes).toEqual([READ_RATE, READ_BATTERY])
    await service.disconnect()
  })

  it('配置命令写入失败时不会进入 connected', async () => {
    const transport = new ConfigTransport()
    transport.rateResponses = [0x05]
    transport.failCommandByte = 0x69
    const service = new SensorService(transport, async () => {})

    await expect(service.connect('device')).rejects.toThrow('设备初始化失败，请重试或重新连接。')
    expect(serviceSnapshot(service).state).toBe('disconnected')
    expect(transport.disconnectCount).toBe(1)
  })

  it('BLE 通道尚未建立时保留 Transport 原始连接错误', async () => {
    const transport = new ConfigTransport()
    const connectError = new Error('蓝牙权限被拒绝')
    transport.connectError = connectError
    const service = new SensorService(transport)

    await expect(service.connect('device')).rejects.toBe(connectError)
    expect(serviceSnapshot(service).state).toBe('error')
    expect(transport.disconnectCount).toBe(0)
  })
})

function registerFrame(registerAddress: number, value: number): Uint8Array {
  const bytes = new Uint8Array(20)
  const view = new DataView(bytes.buffer)
  bytes[0] = 0x55
  bytes[1] = 0x71
  view.setUint16(2, registerAddress, true)
  view.setUint16(4, value, true)
  return bytes
}

function realtimeFrame(): Uint8Array {
  const bytes = new Uint8Array(20)
  bytes[0] = 0x55
  bytes[1] = 0x61
  return bytes
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

/** 仅通过公开订阅读取状态，避免测试依赖 SensorService 的私有实现。 */
function serviceSnapshot(service: SensorService): SensorRuntimeSnapshot {
  let latest: SensorRuntimeSnapshot | null = null
  const unsubscribe = service.onSnapshot((snapshot) => { latest = snapshot })
  unsubscribe()
  if (!latest) throw new Error('未获得 Sensor Snapshot')
  return latest
}
