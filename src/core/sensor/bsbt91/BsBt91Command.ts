import { BS_BT91_REGISTER } from './BsBt91Constants'

/** 按厂家协议创建通用寄存器读取命令。 */
export function createReadRegisterCommand(registerAddress: number): Uint8Array {
  return Uint8Array.from([0xff, 0xaa, 0x27, registerAddress & 0xff, 0x00])
}

/** 读取 0x64 Battery Register，最终字节严格为 FF AA 27 64 00。 */
export function createReadBatteryCommand(): Uint8Array {
  return createReadRegisterCommand(BS_BT91_REGISTER.battery)
}
