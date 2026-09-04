import { BS_BT91 } from './BsBt91Constants'

/** 0x71 寄存器回复的原始无符号数据，具体含义由各业务解码器决定。 */
export interface BsBt91RegisterFrame {
  registerAddress: number
  values: number[]
  timestamp: number
}

/** 独立解析寄存器帧，避免低频状态数据进入运动姿态链路。 */
export class BsBt91RegisterParser {
  parse(bytes: Uint8Array, timestamp: number): BsBt91RegisterFrame | null {
    if (bytes.length !== BS_BT91.realtimeFrameLength) return null
    if (bytes[0] !== BS_BT91.frameHeader || bytes[1] !== BS_BT91.registerFrameType) return null

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const values: number[] = []
    for (let offset = 4; offset < bytes.length; offset += 2) {
      values.push(view.getUint16(offset, true))
    }

    return {
      registerAddress: view.getUint16(2, true),
      values,
      timestamp,
    }
  }
}
