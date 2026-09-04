import { describe, expect, it } from 'vitest'
import { createReadBatteryCommand, createReadRegisterCommand } from '../src/core/sensor/bsbt91/BsBt91Command'

describe('BsBt91Command', () => {
  it('生成严格的 0x64 Battery Register 读取命令', () => {
    expect(createReadBatteryCommand()).toEqual(Uint8Array.from([0xff, 0xaa, 0x27, 0x64, 0x00]))
  })

  it('寄存器地址只保留协议定义的低八位', () => {
    expect(createReadRegisterCommand(0x164)).toEqual(Uint8Array.from([0xff, 0xaa, 0x27, 0x64, 0x00]))
  })
})
