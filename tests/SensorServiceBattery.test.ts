import { afterEach, describe, expect, it, vi } from 'vitest'
import { SensorService } from '../src/core/sensor/SensorService'
import type { ISensorTransport } from '../src/core/sensor/ISensorTransport'
import type { SensorConnectionState, SensorDataPacket, SensorDevice } from '../src/core/sensor/SensorDevice'
import type { SensorRuntimeSnapshot } from '../src/core/sensor/SensorService'

class FakeTransport implements ISensorTransport {
  writes: Uint8Array[] = []
  failBatteryWrites = false
  private dataCallbacks = new Set<(packet: SensorDataPacket) => void>()
  private stateCallbacks = new Set<(state: SensorConnectionState) => void>()

  async scan(): Promise<SensorDevice[]> { return [] }
  async connect(): Promise<void> { this.emitState('connected') }
  async disconnect(): Promise<void> { this.emitState('disconnected') }
  async write(data: Uint8Array): Promise<void> {
    if (this.failBatteryWrites && data[2] === 0x27 && data[3] === 0x64) throw new Error('write failed')
    this.writes.push(data)
    // 初始化读取 RATE 时立即模拟设备返回已配置的 50Hz。
    if (data[2] === 0x27 && data[3] === 0x03) this.emitData(registerFrame(0x03, 0x08), Date.now())
  }
  onData(callback: (packet: SensorDataPacket) => void): () => void { this.dataCallbacks.add(callback); return () => this.dataCallbacks.delete(callback) }
  onStateChanged(callback: (state: SensorConnectionState) => void): () => void { this.stateCallbacks.add(callback); return () => this.stateCallbacks.delete(callback) }
  /** 测试 Transport 没有原生资源，释放操作保持为空实现。 */
  async dispose(): Promise<void> {}
  emitState(state: SensorConnectionState): void { for (const callback of this.stateCallbacks) callback(state) }
  emitData(data: Uint8Array, timestamp: number): void { for (const callback of this.dataCallbacks) callback({ data, timestamp }) }
}

function batteryFrame(rawValue: number): Uint8Array {
  return registerFrame(0x64, rawValue)
}

function registerFrame(registerAddress: number, rawValue: number): Uint8Array {
  const bytes = new Uint8Array(20)
  const view = new DataView(bytes.buffer)
  bytes[0] = 0x55
  bytes[1] = 0x71
  view.setUint16(2, registerAddress, true)
  view.setUint16(4, rawValue, true)
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
}

afterEach(() => vi.useRealTimers())

describe('SensorService Battery', () => {
  it('连接后立即读取并每 30 秒低频刷新，重复 connected 不会创建第二个轮询', async () => {
    vi.useFakeTimers()
    const transport = new FakeTransport()
    const service = new SensorService(transport)
    await service.connect('device')
    await flushAsyncWork()
    expect(transport.writes).toEqual([
      Uint8Array.from([0xff, 0xaa, 0x27, 0x03, 0x00]),
      Uint8Array.from([0xff, 0xaa, 0x27, 0x64, 0x00]),
    ])

    transport.emitState('connected')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(transport.writes).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(transport.writes).toHaveLength(4)
    await service.disconnect()
  })

  it('0x71 Battery 只更新低频状态，不污染姿态帧率或游戏输入', () => {
    const transport = new FakeTransport()
    const service = new SensorService(transport)
    let snapshot = serviceSnapshot(service)

    transport.emitData(realtimeFrame(), 100)
    snapshot = serviceSnapshot(service)
    const inputBeforeBattery = snapshot.gameInput
    expect(snapshot.rateHz).toBe(1)

    transport.emitData(batteryFrame(391), 200)
    snapshot = serviceSnapshot(service)
    expect(snapshot.battery).toEqual({ rawValue: 391, percent: 75, updatedAt: 200, rawHex: '55 71 64 00 87 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00' })
    expect(snapshot.rateHz).toBe(1)
    expect(snapshot.gameInput).toEqual(inputBeforeBattery)
  })

  it('断线清空旧电量，重连立即重新读取', async () => {
    const transport = new FakeTransport()
    const service = new SensorService(transport)
    await service.connect('device')
    await flushAsyncWork()
    transport.emitData(batteryFrame(80), 123)
    expect(serviceSnapshot(service).battery.rawValue).toBe(80)

    await service.disconnect()
    expect(serviceSnapshot(service).battery).toEqual({ rawValue: null, percent: null, updatedAt: null, rawHex: null })
    await service.connect('device')
    await flushAsyncWork()
    expect(transport.writes).toHaveLength(4)
    await service.disconnect()
  })

  it('单次 Battery Write 失败不改变连接状态，也不会触发重连', async () => {
    const transport = new FakeTransport()
    transport.failBatteryWrites = true
    const service = new SensorService(transport)
    await service.connect('device')
    await flushAsyncWork()

    expect(serviceSnapshot(service).state).toBe('connected')
    expect(transport.writes).toEqual([Uint8Array.from([0xff, 0xaa, 0x27, 0x03, 0x00])])
    await service.disconnect()
  })
})

/** 通过订阅获取公开 Snapshot，避免测试触碰服务内部字段。 */
function serviceSnapshot(service: SensorService): SensorRuntimeSnapshot {
  let latest: SensorRuntimeSnapshot | null = null
  const unsubscribe = service.onSnapshot((snapshot) => { latest = snapshot })
  unsubscribe()
  if (!latest) throw new Error('未获得 Sensor Snapshot')
  return latest
}
