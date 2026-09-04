import type { IKeyValueStore } from '../storage/IKeyValueStore'
import { StorageKeys } from '../storage/StorageKeys'
import type { SensorDevice } from './SensorDevice'

/** 最近一次成功连接设备的可恢复标识，不假定设备 ID 永远稳定。 */
export interface DeviceBinding {
  deviceId: string
  address?: string
  name: string
  updatedAt: number
}

/** 设备绑定的存储接口，方便连接管理与存储实现解耦。 */
export interface IDeviceBindingRepository {
  load(): Promise<DeviceBinding | null>
  save(binding: DeviceBinding): Promise<void>
  clear(): Promise<void>
}

/** localStorage 中保存最后一个成功连接的设备。 */
export class LocalStorageDeviceBindingRepository implements IDeviceBindingRepository {
  constructor(private readonly store: IKeyValueStore) {}

  async load(): Promise<DeviceBinding | null> {
    const raw = await this.store.get(StorageKeys.lastDevice)
    if (!raw) return null
    try {
      const value: unknown = JSON.parse(raw)
      return isDeviceBinding(value) ? value : null
    } catch { return null }
  }

  async save(binding: DeviceBinding): Promise<void> {
    await this.store.set(StorageKeys.lastDevice, JSON.stringify(binding))
  }

  async clear(): Promise<void> { await this.store.remove(StorageKeys.lastDevice) }
}

/** 按 ID、地址、唯一名称的顺序寻找本次扫描中的已绑定设备。 */
export function matchBoundDevice(binding: DeviceBinding, devices: SensorDevice[]): SensorDevice | null {
  const byId = devices.find((device) => device.id === binding.deviceId)
  if (byId) return byId
  if (binding.address) {
    const byAddress = devices.find((device) => device.address === binding.address)
    if (byAddress) return byAddress
  }
  const named = devices.filter((device) => device.name === binding.name)
  return named.length === 1 ? named[0] : null
}

function isDeviceBinding(value: unknown): value is DeviceBinding {
  if (!value || typeof value !== 'object') return false
  const binding = value as Partial<DeviceBinding>
  return typeof binding.deviceId === 'string'
    && typeof binding.name === 'string'
    && typeof binding.updatedAt === 'number'
    && (binding.address === undefined || typeof binding.address === 'string')
}
