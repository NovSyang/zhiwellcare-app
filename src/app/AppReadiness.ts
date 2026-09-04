import type { MotionProfile } from '../core/motion/MotionProfile'
import type { SensorConnectionSnapshot } from '../core/sensor/SensorConnectionManager'
import type { SensorRuntimeSnapshot } from '../core/sensor/SensorService'

/** 根据真实持久化与运行时状态判断应用是否具备开始训练的条件。 */
export interface AppReadiness {
  deviceBound: boolean
  connected: boolean
  hasMeasuredProfile: boolean
  centerCalibrated: boolean
}

/** 不保存额外完成标记，避免绑定或 ROM 被清除后出现错误的已完成状态。 */
export function getAppReadiness(
  sensor: SensorRuntimeSnapshot,
  connection: SensorConnectionSnapshot,
  profile: MotionProfile,
): AppReadiness {
  return {
    deviceBound: connection.binding !== null,
    connected: sensor.state === 'connected',
    hasMeasuredProfile: profile.measuredRange !== null,
    centerCalibrated: sensor.gameInput.calibrated,
  }
}
