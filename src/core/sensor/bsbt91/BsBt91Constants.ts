export const BS_BT91 = {
  serviceUuid: '0000ffe5-0000-1000-8000-00805f9a34fb',
  notifyUuid: '0000ffe4-0000-1000-8000-00805f9a34fb',
  writeUuid: '0000ffe9-0000-1000-8000-00805f9a34fb',
  frameHeader: 0x55,
  realtimeFrameType: 0x61,
  registerFrameType: 0x71,
  realtimeFrameLength: 20,
} as const

/** 厂家协议已确认的寄存器地址，业务层不直接散落魔法数字。 */
export const BS_BT91_REGISTER = {
  battery: 0x64,
  version: 0x2e,
  quaternion: 0x51,
  magnetic: 0x3a,
  temperature: 0x40,
} as const
