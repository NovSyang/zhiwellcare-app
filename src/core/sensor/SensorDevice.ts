export interface SensorDevice {
  id: string
  name: string
  address?: string
}

/** configuring 表示 BLE 已建立，但设备参数尚未通过业务初始化校验。 */
export type SensorConnectionState =
  | 'idle'
  | 'scanning'
  | 'connecting'
  | 'discovering'
  | 'subscribing'
  | 'configuring'
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
