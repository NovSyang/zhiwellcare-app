import type { SensorFrame } from '../SensorFrame'
import { BS_BT91 } from './BsBt91Constants'

export class BsBt91Parser {
  parseRealtimeFrame(bytes: Uint8Array, timestamp: number): SensorFrame | null {
    if (bytes.length !== BS_BT91.realtimeFrameLength) return null
    if (bytes[0] !== BS_BT91.frameHeader || bytes[1] !== BS_BT91.realtimeFrameType) {
      return null
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const int16 = (offset: number) => view.getInt16(offset, true)

    return {
      accX: (int16(2) / 32768) * 16,
      accY: (int16(4) / 32768) * 16,
      accZ: (int16(6) / 32768) * 16,

      gyroX: (int16(8) / 32768) * 2000,
      gyroY: (int16(10) / 32768) * 2000,
      gyroZ: (int16(12) / 32768) * 2000,

      angleX: (int16(14) / 32768) * 180,
      angleY: (int16(16) / 32768) * 180,
      angleZ: (int16(18) / 32768) * 180,

      timestamp,
    }
  }
}
