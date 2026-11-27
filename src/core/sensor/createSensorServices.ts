import { LocalStorageMotionProfileRepository } from '../motion/LocalStorageMotionProfileRepository'
import { MotionProfileService } from '../motion/MotionProfileService'
import type { IKeyValueStore } from '../storage/IKeyValueStore'
import { LocalStorageDeviceBindingRepository, type DeviceBinding } from './DeviceBinding'
import type { ISensorTransport } from './ISensorTransport'
import { SensorConnectionManager } from './SensorConnectionManager'
import type { SensorDevice } from './SensorDevice'
import { SensorService } from './SensorService'

/** 业务链路由两端共享，平台只需提供 BLE 传输与异步存储。 */
export function createSensorServices(
  transport: ISensorTransport,
  storage: IKeyValueStore,
  matchDevice?: (binding: DeviceBinding, devices: SensorDevice[]) => SensorDevice | null,
) {
  const sensorService = new SensorService(transport)
  const connectionManager = new SensorConnectionManager(
    sensorService,
    new LocalStorageDeviceBindingRepository(storage),
    undefined,
    matchDevice,
  )
  const motionProfileService = new MotionProfileService(
    new LocalStorageMotionProfileRepository(storage),
    sensorService,
  )
  return { sensorService, connectionManager, motionProfileService }
}
