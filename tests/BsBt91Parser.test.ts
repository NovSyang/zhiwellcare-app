import { describe, expect, it } from 'vitest'
import { BsBt91Parser } from '../src/core/sensor/bsbt91/BsBt91Parser'

function writeInt16LE(bytes: Uint8Array, offset: number, value: number) {
  new DataView(bytes.buffer).setInt16(offset, value, true)
}

describe('BsBt91Parser', () => {
  it('解析 0x55 0x61 实时姿态帧', () => {
    const bytes = new Uint8Array(20)
    bytes[0] = 0x55
    bytes[1] = 0x61
    writeInt16LE(bytes, 2, 16384) // 8g
    writeInt16LE(bytes, 8, 16384) // 1000°/s
    writeInt16LE(bytes, 14, -3277) // ≈ -18°
    writeInt16LE(bytes, 16, 1820) // ≈ 10°

    const frame = new BsBt91Parser().parseRealtimeFrame(bytes, 123)
    expect(frame).not.toBeNull()
    expect(frame?.accX).toBeCloseTo(8, 4)
    expect(frame?.gyroX).toBeCloseTo(1000, 4)
    expect(frame?.angleX).toBeCloseTo(-18, 1)
    expect(frame?.angleY).toBeCloseTo(10, 1)
    expect(frame?.timestamp).toBe(123)
  })
})
