import { BS_BT91 } from './BsBt91Constants'

export interface AssembledBsBt91Frame {
  bytes: Uint8Array
  timestamp: number
}

/**
 * BLE Notify 的一次回调不应该被假定为“一次完整协议帧”。
 * 这里使用缓存按 0x55 + FrameType 进行重组。
 */
export class BsBt91FrameAssembler {
  private buffer: number[] = []

  push(chunk: Uint8Array, timestamp: number): AssembledBsBt91Frame[] {
    this.buffer.push(...chunk)
    const frames: AssembledBsBt91Frame[] = []

    while (this.buffer.length >= 2) {
      const headerIndex = this.buffer.indexOf(BS_BT91.frameHeader)
      if (headerIndex < 0) {
        this.buffer = []
        break
      }

      if (headerIndex > 0) {
        this.buffer.splice(0, headerIndex)
      }

      if (this.buffer.length < 2) break

      const type = this.buffer[1]
      if (type !== BS_BT91.realtimeFrameType && type !== BS_BT91.registerFrameType) {
        this.buffer.shift()
        continue
      }

      // 厂家 SDK 对 0x61 / 0x71 都按 20 Byte 组帧。
      const expectedLength = BS_BT91.realtimeFrameLength
      if (this.buffer.length < expectedLength) break

      frames.push({
        bytes: Uint8Array.from(this.buffer.slice(0, expectedLength)),
        timestamp,
      })
      this.buffer.splice(0, expectedLength)
    }

    // 防止异常数据长期累积。
    if (this.buffer.length > 1024) {
      this.buffer = this.buffer.slice(-64)
    }

    return frames
  }

  reset(): void {
    this.buffer = []
  }
}
