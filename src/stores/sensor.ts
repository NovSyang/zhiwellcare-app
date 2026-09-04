import { defineStore } from 'pinia'
import type { SensorConnectionState, SensorDevice } from '../core/sensor/SensorDevice'

export const useSensorStore = defineStore('sensor', {
  state: () => ({
    state: 'idle' as SensorConnectionState,
    devices: [] as SensorDevice[],
    selectedDeviceId: '',
    errorMessage: '',
  }),
})
