import { describe, expect, it } from 'vitest'
import {
  createReadBatteryCommand,
  createReadRegisterCommand,
  createSaveSettingsCommand,
  createSetOutputRate50HzCommand,
  createUnlockCommand,
  createWriteRegisterCommand,
} from '../src/core/sensor/bsbt91/BsBt91Command'

describe('BsBt91Command', () => {
  it('生成严格的 0x64 Battery Register 读取命令', () => {
    expect(createReadBatteryCommand()).toEqual(Uint8Array.from([0xff, 0xaa, 0x27, 0x64, 0x00]))
  })

  it('寄存器地址只保留协议定义的低八位', () => {
    expect(createReadRegisterCommand(0x164)).toEqual(Uint8Array.from([0xff, 0xaa, 0x27, 0x64, 0x00]))
  })

  it('生成通用写入、解锁、50Hz 设置和保存命令', () => {
    expect(createWriteRegisterCommand(0x103, 0x108)).toEqual(Uint8Array.from([0xff, 0xaa, 0x03, 0x08, 0x00]))
    expect(createUnlockCommand()).toEqual(Uint8Array.from([0xff, 0xaa, 0x69, 0x88, 0xb5]))
    expect(createSetOutputRate50HzCommand()).toEqual(Uint8Array.from([0xff, 0xaa, 0x03, 0x08, 0x00]))
    expect(createSaveSettingsCommand()).toEqual(Uint8Array.from([0xff, 0xaa, 0x00, 0x00, 0x00]))
  })
})
