import { BS_BT91_OUTPUT_RATE, BS_BT91_REGISTER } from './BsBt91Constants'

/** 按厂家协议创建通用寄存器读取命令。 */
export function createReadRegisterCommand(registerAddress: number): Uint8Array {
  return Uint8Array.from([0xff, 0xaa, 0x27, registerAddress & 0xff, 0x00])
}

/** 按厂家协议创建通用寄存器写入命令。 */
export function createWriteRegisterCommand(registerAddress: number, value: number): Uint8Array {
  return Uint8Array.from([0xff, 0xaa, registerAddress & 0xff, value & 0xff, 0x00])
}

/** 写寄存器前先解锁设备配置。 */
export function createUnlockCommand(): Uint8Array {
  return Uint8Array.from([0xff, 0xaa, 0x69, 0x88, 0xb5])
}

/** 将 RATE 寄存器设置为厂家定义的 50Hz 枚举值。 */
export function createSetOutputRate50HzCommand(): Uint8Array {
  return createWriteRegisterCommand(BS_BT91_REGISTER.rate, BS_BT91_OUTPUT_RATE.hz50)
}

/** 将当前寄存器配置保存到设备，断电后仍然生效。 */
export function createSaveSettingsCommand(): Uint8Array {
  return createWriteRegisterCommand(BS_BT91_REGISTER.save, 0x00)
}

/** 读取 0x64 Battery Register，最终字节严格为 FF AA 27 64 00。 */
export function createReadBatteryCommand(): Uint8Array {
  return createReadRegisterCommand(BS_BT91_REGISTER.battery)
}
