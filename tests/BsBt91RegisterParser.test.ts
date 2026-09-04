import { describe, expect, it } from 'vitest'
import { BsBt91RegisterParser } from '../src/core/sensor/bsbt91/BsBt91RegisterParser'

function registerFrame(): Uint8Array {
  const bytes = new Uint8Array(20)
  const view = new DataView(bytes.buffer)
  bytes[0] = 0x55
  bytes[1] = 0x71
  view.setUint16(2, 0x64, true)
  view.setUint16(4, 0x1234, true)
  view.setUint16(6, 0xabcd, true)
  return bytes
}

describe('BsBt91RegisterParser', () => {
  it('解析 0x71 地址和多个小端 uint16 Raw 值', () => {
    expect(new BsBt91RegisterParser().parse(registerFrame(), 321)).toEqual({
      registerAddress: 0x64,
      values: [0x1234, 0xabcd, 0, 0, 0, 0, 0, 0],
      timestamp: 321,
    })
  })

  it('拒绝长度错误、错误 Header 和姿态帧', () => {
    const parser = new BsBt91RegisterParser()
    expect(parser.parse(new Uint8Array(19), 1)).toBeNull()
    const badHeader = registerFrame(); badHeader[0] = 0x54
    expect(parser.parse(badHeader, 1)).toBeNull()
    const realtime = registerFrame(); realtime[1] = 0x61
    expect(parser.parse(realtime, 1)).toBeNull()
  })
})
