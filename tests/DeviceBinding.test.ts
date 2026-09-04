import { describe, expect, it } from 'vitest'
import { matchBoundDevice, type DeviceBinding } from '../src/core/sensor/DeviceBinding'
import type { SensorDevice } from '../src/core/sensor/SensorDevice'

const binding: DeviceBinding = { deviceId: 'old-id', address: 'AA:BB', name: 'BS-BT91', updatedAt: 1 }

describe('DeviceBinding', () => {
  it('按 ID、地址和唯一名称依次匹配设备', () => {
    const devices: SensorDevice[] = [
      { id: 'old-id', address: 'CC:DD', name: 'other' },
      { id: 'new-id', address: 'AA:BB', name: 'BS-BT91' },
    ]
    expect(matchBoundDevice(binding, devices)?.id).toBe('old-id')
    expect(matchBoundDevice(binding, [devices[1]])?.id).toBe('new-id')
    expect(matchBoundDevice({ ...binding, address: undefined }, [{ id: 'name-id', name: 'BS-BT91' }])?.id).toBe('name-id')
  })

  it('多个同名设备时不自动选择', () => {
    expect(matchBoundDevice({ ...binding, address: undefined }, [
      { id: 'one', name: 'BS-BT91' }, { id: 'two', name: 'BS-BT91' },
    ])).toBeNull()
  })
})
