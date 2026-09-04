import { describe, expect, it } from 'vitest'
import { getAppReadiness } from '../src/app/AppReadiness'
import { createDefaultMotionProfile } from '../src/core/motion/MotionProfile'
import { createEmptyBatteryState } from '../src/core/sensor/bsbt91/BsBt91Battery'

describe('AppReadiness', () => {
  it('仅根据真实绑定、连接、ROM 与中心校准状态推导准备度', () => {
    const profile = createDefaultMotionProfile(1)
    const sensor = { state: 'connected', frame: null, rateHz: 0, rawHex: '', battery: createEmptyBatteryState(), gameInput: { x: 0, y: 0, connected: true, calibrated: true, timestamp: 1 } } as const
    const connection = { reconnectState: 'idle', binding: { deviceId: 'id', name: 'BS', updatedAt: 1 }, operation: 'idle', attemptNumber: 0, retryIndex: 0, maxAttempts: 4, message: null } as const
    expect(getAppReadiness(sensor, connection, profile)).toEqual({ deviceBound: true, connected: true, hasMeasuredProfile: false, centerCalibrated: true })
  })
})
