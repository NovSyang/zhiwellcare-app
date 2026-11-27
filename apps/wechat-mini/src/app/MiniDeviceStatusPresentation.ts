import type { SensorRuntimeSnapshot } from '../../../../src/core/sensor/SensorService'
import type { SensorConnectionSnapshot } from '../../../../src/core/sensor/SensorConnectionManager'
import { getBatteryFillPercent, isLowBatteryPercent } from '../../../../src/core/sensor/bsbt91/BsBt91Battery'
import type { DeviceAction } from './MiniDeviceCoordinator'

interface Input {
  initialized: boolean
  foreground: boolean
  action: DeviceAction
  calibrating: boolean
  connection: SensorConnectionSnapshot
  sensor?: SensorRuntimeSnapshot
  error?: string
}

/** 设备身份、连接阶段和电量只从真实快照派生。 */
export function presentDeviceStatus(input: Input) {
  const { initialized, foreground, action, calibrating, connection, sensor } = input
  const connected = foreground && initialized && sensor?.state === 'connected'
    && !['suspending', 'disconnecting', 'forgetting', 'selecting', 'reconnecting', 'auto-connecting'].includes(action)
    && connection.operation === 'idle'
  const value = sensor?.battery.percent
  const batteryPercent = connected && typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null
  const base = {
    connected, batteryPercent, batteryFill: getBatteryFillPercent(batteryPercent), batteryLow: isLowBatteryPercent(batteryPercent),
    calibrationLabel: connected ? calibrating ? '正在校准中心' : sensor?.gameInput.calibrated ? '中心已校准' : '需校准中心' : '',
  }
  if (!foreground) return { ...base, label: '设备未连接', tone: 'offline' }
  if (action === 'suspending' || action === 'disconnecting' || action === 'forgetting') return { ...base, label: '正在断开', tone: 'pending' }
  if (!initialized) return { ...base, label: input.error ? '读取设备失败' : '正在读取设备', tone: input.error ? 'offline' : 'pending' }
  if (action === 'selecting' || connection.operation === 'switch-device') return { ...base, label: '正在更换设备', tone: 'pending' }
  if (action === 'auto-connecting' || action === 'reconnecting' || connection.reconnectState === 'reconnecting') {
    return { ...base, label: '正在重连', tone: 'pending' }
  }
  if (connected) return { ...base, label: calibrating ? '正在校准' : '设备已连接', tone: calibrating ? 'pending' : 'online' }
  if (action === 'scanning' || sensor?.state === 'scanning') return { ...base, label: '正在查找设备', tone: 'pending' }
  if (sensor?.state === 'connecting') return { ...base, label: '正在连接', tone: 'pending' }
  if (sensor?.state === 'discovering' || sensor?.state === 'subscribing' || sensor?.state === 'configuring') {
    return { ...base, label: '设备初始化中', tone: 'pending' }
  }
  if (sensor?.state === 'error' || connection.reconnectState === 'waiting-user' || input.error) {
    return { ...base, label: '连接异常', tone: 'offline' }
  }
  return { ...base, label: '设备未连接', tone: 'offline' }
}
