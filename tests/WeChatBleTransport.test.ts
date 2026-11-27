import { afterEach, describe, expect, it, vi } from 'vitest'
import { WeChatBleTransport, type WeChatBleApi } from '../apps/wechat-mini/src/platform/ble/WeChatBleTransport'
import { BS_BT91, BS_BT91_REGISTER, BS_BT91_OUTPUT_RATE, SensorService, type SensorRuntimeSnapshot } from '../src/core/shared'

/** 模拟微信桥接层，保留事件订阅器，测试断线和旧回调。 */
function fixture() {
  const ok = { errMsg: 'ok', errCode: 0 }
  const api = {
    openBluetoothAdapter: vi.fn(async () => ok),
    closeBluetoothAdapter: vi.fn(async () => ok),
    getBluetoothAdapterState: vi.fn(async () => ({ ...ok, available: true, discovering: false })),
    startBluetoothDevicesDiscovery: vi.fn(async () => ok),
    stopBluetoothDevicesDiscovery: vi.fn(async () => ok),
    onBluetoothDeviceFound: vi.fn<WeChatBleApi['onBluetoothDeviceFound']>(),
    offBluetoothDeviceFound: vi.fn<WeChatBleApi['offBluetoothDeviceFound']>(),
    onBluetoothAdapterStateChange: vi.fn<WeChatBleApi['onBluetoothAdapterStateChange']>(),
    offBluetoothAdapterStateChange: vi.fn<WeChatBleApi['offBluetoothAdapterStateChange']>(),
    createBLEConnection: vi.fn(async () => ok),
    closeBLEConnection: vi.fn(async () => ok),
    getBLEDeviceServices: vi.fn(async () => ({ ...ok, services: [{ uuid: 'FFE5', isPrimary: true }] })),
    getBLEDeviceCharacteristics: vi.fn(async () => ({
      ...ok,
      characteristics: [
        { uuid: 'FFE4', properties: properties({ notify: true }) },
        { uuid: 'FFE9', properties: properties({ writeNoResponse: true }) },
      ],
    })),
    notifyBLECharacteristicValueChange: vi.fn(async () => ok),
    onBLEConnectionStateChange: vi.fn<WeChatBleApi['onBLEConnectionStateChange']>(),
    offBLEConnectionStateChange: vi.fn<WeChatBleApi['offBLEConnectionStateChange']>(),
    onBLECharacteristicValueChange: vi.fn<WeChatBleApi['onBLECharacteristicValueChange']>(),
    offBLECharacteristicValueChange: vi.fn<WeChatBleApi['offBLECharacteristicValueChange']>(),
    writeBLECharacteristicValue: vi.fn<WeChatBleApi['writeBLECharacteristicValue']>().mockResolvedValue(ok),
  } satisfies WeChatBleApi
  let now = 1_700_000_000_000
  const transport = new WeChatBleTransport(api, { nowEpochMs: () => now }, 30)
  const event = (deviceId: string, value: ArrayBuffer) => ({
    deviceId, serviceId: BS_BT91.serviceUuid, characteristicId: BS_BT91.notifyUuid, value,
  })
  return { api, transport, event, ok, advanceEpoch: (ms: number) => { now += ms } }
}

function properties(overrides: Record<string, boolean>) {
  return { notify: false, indicate: false, read: false, write: false, writeNoResponse: false, writeDefault: false, ...overrides }
}

afterEach(() => vi.useRealTimers())

describe('微信 BLE 传输', () => {
  it('扫描合并同 ID 广播，保留两台同名设备并解除监听', async () => {
    vi.useFakeTimers()
    const { api, transport } = fixture()
    const task = transport.scan()
    await vi.advanceTimersByTimeAsync(0)
    const callback = api.onBluetoothDeviceFound.mock.calls[0][0]
    const device = { localName: 'BS-BT91', name: '', advertisServiceUUIDs: [], advertisData: new ArrayBuffer(0), RSSI: -50, serviceData: {} }
    callback({ devices: [
      { ...device, deviceId: 'one' }, { ...device, deviceId: 'one' },
      { ...device, deviceId: 'two' }, { ...device, deviceId: 'other', localName: 'other' },
    ] })
    await vi.advanceTimersByTimeAsync(30)
    expect(await task).toEqual([{ id: 'one', name: 'BS-BT91' }, { id: 'two', name: 'BS-BT91' }])
    expect(api.stopBluetoothDevicesDiscovery).toHaveBeenCalledOnce()
    expect(api.offBluetoothDeviceFound).toHaveBeenCalledWith(callback)
    await transport.dispose()
  })

  it('适配器首次关闭失败后仍能重新清理，成功后解绑监听', async () => {
    const { api, transport } = fixture()
    await transport.connect('one')
    api.closeBluetoothAdapter.mockRejectedValueOnce(new Error('关闭失败'))
    await expect(transport.suspend()).rejects.toThrow('关闭失败')
    expect(api.offBluetoothAdapterStateChange).not.toHaveBeenCalled()
    await transport.suspend()
    expect(api.closeBluetoothAdapter).toHaveBeenCalledTimes(2)
    expect(api.offBluetoothAdapterStateChange).toHaveBeenCalledOnce()
  })

  it('订阅后只发布匹配的字节流，复制原生缓冲区并忽略上条连接的回调', async () => {
    const { api, transport, event } = fixture()
    const listener = vi.fn()
    transport.onData(listener)
    await transport.connect('one')
    expect(api.notifyBLECharacteristicValueChange).toHaveBeenCalledWith({
      deviceId: 'one', serviceId: 'FFE5', characteristicId: 'FFE4', state: true,
    })
    const oldCallback = api.onBLECharacteristicValueChange.mock.calls[0][0]
    const bytes = new Uint8Array([0x55, 0x61])
    oldCallback(event('other', bytes.buffer))
    oldCallback(event('one', bytes.buffer))
    bytes.fill(0)
    expect(listener).toHaveBeenCalledExactlyOnceWith({
      data: new Uint8Array([0x55, 0x61]), timestamp: 1_700_000_000_000,
    })
    await transport.disconnect()
    await transport.connect('one')
    oldCallback(event('one', bytes.buffer))
    expect(listener).toHaveBeenCalledOnce()
    expect(api.offBLECharacteristicValueChange).toHaveBeenCalledWith(oldCallback)
    await transport.dispose()
  })

  it('写入串行，断线后立即结束运行中与排队的写入', async () => {
    const { api, transport } = fixture()
    await transport.connect('one')
    api.writeBLECharacteristicValue.mockImplementationOnce(() => new Promise(() => {}))
    const first = expect(transport.write(Uint8Array.of(1))).rejects.toThrow('已取消')
    const second = expect(transport.write(Uint8Array.of(2))).rejects.toThrow('已取消')
    await Promise.resolve()
    expect(api.writeBLECharacteristicValue).toHaveBeenCalledOnce()
    api.onBLEConnectionStateChange.mock.calls[0][0]({ deviceId: 'one', connected: false })
    await Promise.all([first, second])
    await transport.dispose()
  })

  it('写入超时关闭连接，避免迟到的系统请求与新指令并发', async () => {
    vi.useFakeTimers()
    const { api, transport } = fixture()
    await transport.connect('one')
    api.writeBLECharacteristicValue.mockImplementationOnce(() => new Promise(() => {}))
    const failure = expect(transport.write(Uint8Array.of(1))).rejects.toThrow('写入超时')
    await vi.advanceTimersByTimeAsync(3000)
    await failure
    expect(api.closeBLEConnection).toHaveBeenCalledWith({ deviceId: 'one' })
    await transport.dispose()
  })

  it('把微信通知交给现有 SensorService，50Hz 已正确时只读寄存器', async () => {
    const { api, transport, event, ok, advanceEpoch } = fixture()
    const sensor = new SensorService(transport)
    const states: string[] = []
    const snapshots: SensorRuntimeSnapshot[] = []
    sensor.onSnapshot((snapshot) => { states.push(snapshot.state); snapshots.push(snapshot) })
    api.writeBLECharacteristicValue.mockImplementation(async ({ value }) => {
      const command = new Uint8Array(value)
      if (command[3] === BS_BT91_REGISTER.rate) {
        const frame = new Uint8Array(BS_BT91.realtimeFrameLength)
        frame.set([BS_BT91.frameHeader, BS_BT91.registerFrameType, BS_BT91_REGISTER.rate, 0, BS_BT91_OUTPUT_RATE.hz50, 0])
        api.onBLECharacteristicValueChange.mock.calls[0][0](event('one', frame.buffer.slice(0, 8)))
        api.onBLECharacteristicValueChange.mock.calls[0][0](event('one', frame.buffer.slice(8)))
      }
      return ok
    })
    await sensor.connect('one')
    expect(states).toContain('configuring')
    expect(states.at(-1)).toBe('connected')
    // 电量轮询在连接就绪后异步进入写队列。
    await vi.waitFor(() => {
      const registers = api.writeBLECharacteristicValue.mock.calls.map(([call]) => new Uint8Array(call.value)[3])
      expect(registers).toEqual([BS_BT91_REGISTER.rate, BS_BT91_REGISTER.battery])
    })
    // 50Hz 姿态流标定中心后，AngleY 向右，-AngleX 向前。
    sensor.startCalibration()
    const frame = new Uint8Array(BS_BT91.realtimeFrameLength)
    frame.set([BS_BT91.frameHeader, BS_BT91.realtimeFrameType])
    const notify = api.onBLECharacteristicValueChange.mock.calls[0][0]
    for (let sample = 0; sample <= 50; sample += 1) {
      advanceEpoch(20)
      notify(event('one', frame.buffer))
    }
    expect(snapshots.at(-1)?.gameInput).toMatchObject({ connected: true, calibrated: true, x: 0, y: 0 })
    const angles = new DataView(frame.buffer)
    angles.setInt16(14, -1820, true)
    angles.setInt16(16, 1820, true)
    advanceEpoch(20)
    notify(event('one', frame.buffer))
    expect(snapshots.at(-1)?.gameInput.x).toBeGreaterThan(0)
    expect(snapshots.at(-1)?.gameInput.y).toBeGreaterThan(0)
    await sensor.disconnect()
    await transport.dispose()
  })
})
