export interface SensorDevice {
  id: string
  name: string
  address?: string
}

export type SensorConnectionState =
  | 'idle'
  | 'scanning'
  | 'connecting'
  | 'discovering'
  | 'subscribing'
  | 'connected'
  | 'disconnected'
  | 'error'

export interface SensorDataPacket {
  data: Uint8Array

  /**
   * 数据进入应用层时的 Unix Epoch 毫秒。
   * 所有平台 Transport 都必须与 Date.now() 使用相同时间基准。
   */
  timestamp: number
}
