import { describe, expect, it, vi } from 'vitest'
import type { BleCharacteristicProperties, BleClientInterface, BleService, ScanResult } from '@capacitor-community/bluetooth-le'
import { CapacitorBleTransport } from '../src/platform/capacitor/CapacitorBleTransport'

const SERVICE = '0000ffe5-0000-1000-8000-00805f9a34fb'
const NOTIFY = '0000ffe4-0000-1000-8000-00805f9a34fb'
const WRITE = '0000ffe9-0000-1000-8000-00805f9a34fb'

function properties(values: Partial<BleCharacteristicProperties>): BleCharacteristicProperties {
  return { broadcast: false, read: false, writeWithoutResponse: false, write: false, notify: false, indicate: false, authenticatedSignedWrites: false, ...values }
}

function services(): BleService[] {
  return [{ uuid: SERVICE, characteristics: [
    { uuid: NOTIFY, properties: properties({ notify: true }), descriptors: [] },
    { uuid: WRITE, properties: properties({ writeWithoutResponse: true }), descriptors: [] },
  ] }]
}

function fakeClient() {
  let scanCallback: ((result: ScanResult) => void) | null = null
  let notificationCallback: ((value: DataView) => void) | null = null
  let disconnectCallback: ((deviceId: string) => void) | null = null
  const client = {
    initialize: vi.fn(async () => undefined),
    isEnabled: vi.fn(async () => true),
    startEnabledNotifications: vi.fn(async () => undefined),
    stopEnabledNotifications: vi.fn(async () => undefined),
    requestLEScan: vi.fn(async (_options, callback) => { scanCallback = callback }),
    stopLEScan: vi.fn(async () => undefined),
    connect: vi.fn(async (deviceId, callback) => { disconnectCallback = callback; void deviceId }),
    disconnect: vi.fn(async () => undefined),
    getServices: vi.fn(async () => services()),
    startNotifications: vi.fn(async (_deviceId, _service, _characteristic, callback) => { notificationCallback = callback }),
    stopNotifications: vi.fn(async () => undefined),
    writeWithoutResponse: vi.fn(async () => undefined),
    write: vi.fn(async () => undefined),
  }
  return {
    client: client as unknown as BleClientInterface,
    emitScan: (result: ScanResult) => scanCallback?.(result),
    emitData: (value: DataView) => notificationCallback?.(value),
    emitDisconnect: (deviceId: string) => disconnectCallback?.(deviceId),
    spies: client,
  }
}

describe('CapacitorBleTransport', () => {
  it('扫描按 ID 去重、过滤非 BS 名称，并始终停止扫描', async () => {
    const fake = fakeClient()
    const transport = new CapacitorBleTransport(fake.client, async () => {
      fake.emitScan({ device: { deviceId: 'one', name: 'BS-BT91' }, localName: 'BS-BT91' })
      fake.emitScan({ device: { deviceId: 'one', name: 'BS-BT91' }, localName: 'BS-BT91' })
      fake.emitScan({ device: { deviceId: 'other', name: 'Speaker' }, localName: 'Speaker' })
    })

    await expect(transport.scan()).resolves.toEqual([{ id: 'one', name: 'BS-BT91' }])
    expect(fake.spies.stopLEScan).toHaveBeenCalledOnce()
    expect(fake.spies.initialize).toHaveBeenCalledWith({ androidNeverForLocation: true })
  })

  it('连接后订阅 FFE4、复制通知数据并按特征能力无响应写入', async () => {
    const fake = fakeClient()
    const transport = new CapacitorBleTransport(fake.client, async () => undefined)
    const states: string[] = []
    const packets: number[][] = []
    transport.onStateChanged((state) => states.push(state))
    transport.onData((packet) => packets.push([...packet.data]))

    await transport.connect('device-1')
    const bytes = Uint8Array.from([0x55, 0x61])
    fake.emitData(new DataView(bytes.buffer))
    bytes[0] = 0
    await transport.write(Uint8Array.from([0xff, 0xaa]))
    fake.emitDisconnect('device-1')

    expect(states).toEqual(['connecting', 'discovering', 'subscribing', 'connected', 'disconnected'])
    expect(packets).toEqual([[0x55, 0x61]])
    expect(fake.spies.startNotifications).toHaveBeenCalledWith('device-1', SERVICE, NOTIFY, expect.any(Function))
    expect(fake.spies.writeWithoutResponse).toHaveBeenCalledOnce()
    expect(fake.spies.write).not.toHaveBeenCalled()
  })

  it('通知数据使用注入时钟生成 Unix Epoch 时间戳', async () => {
    const fake = fakeClient()
    const fixedEpochMs = 1_777_000_000_000
    const transport = new CapacitorBleTransport(
      fake.client,
      async () => undefined,
      () => fixedEpochMs,
    )
    const packets: Array<{ data: number[]; timestamp: number }> = []
    transport.onData((packet) => packets.push({
      data: [...packet.data],
      timestamp: packet.timestamp,
    }))

    await transport.connect('device-1')
    const bytes = Uint8Array.from([0x55, 0x61])
    fake.emitData(new DataView(bytes.buffer))
    bytes[0] = 0

    // 数据副本不受 Native 缓冲区复用影响，时间戳与 Date.now() 属于同一时钟域。
    expect(packets).toEqual([{ data: [0x55, 0x61], timestamp: fixedEpochMs }])
  })

  it('已连接时扫描新设备，完成后恢复 connected 而不是丢失旧连接状态', async () => {
    const fake = fakeClient()
    const transport = new CapacitorBleTransport(fake.client, async () => undefined)
    const states: string[] = []
    transport.onStateChanged((state) => states.push(state))
    await transport.connect('old-device')
    states.length = 0

    await transport.scan()

    expect(states).toEqual([])
    expect(fake.spies.disconnect).not.toHaveBeenCalled()
  })

  it('蓝牙关闭时返回可终止重试的中文错误', async () => {
    const fake = fakeClient()
    fake.spies.isEnabled.mockResolvedValue(false)
    const transport = new CapacitorBleTransport(fake.client, async () => undefined)
    await expect(transport.scan()).rejects.toMatchObject({ code: 'bluetooth-disabled', message: '手机蓝牙未开启，请开启蓝牙后重试。' })
    expect(fake.spies.requestLEScan).not.toHaveBeenCalled()
  })
})
