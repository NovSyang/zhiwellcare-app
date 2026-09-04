import type {
  SensorConnectionState,
  SensorDataPacket,
  SensorDevice,
} from './SensorDevice'

export interface ISensorTransport {
  scan(): Promise<SensorDevice[]>
  connect(deviceId: string): Promise<void>
  disconnect(): Promise<void>
  write(data: Uint8Array): Promise<void>
  onData(callback: (packet: SensorDataPacket) => void): () => void
  onStateChanged(callback: (state: SensorConnectionState) => void): () => void
  /** 释放平台监听、扫描和连接，防止应用卸载后仍占用蓝牙资源。 */
  dispose(): Promise<void>
}
