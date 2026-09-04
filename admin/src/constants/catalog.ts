/** 目录运营用共享常量：能力标签 / 手柄标签 / 分类 / 状态（与后端 API_CONTRACT.md 对齐）。 */

export const DEVICE_TAGS = [
  { value: 'posture-sensor', label: '姿态传感', kind: 'device' },
  { value: 'torque-sensor', label: '力矩传感·主动阻力', kind: 'device' },
  { value: 'six-axis-imu', label: '六轴体感', kind: 'device' },
  { value: 'grip-sensor', label: '握力传感', kind: 'device' },
] as const

export const HANDLE_TAGS = [
  { value: 'handle-steering-wheel', label: '方向盘手柄', kind: 'handle' },
  { value: 'handle-sphere', label: '球形手柄', kind: 'handle' },
  { value: 'handle-t', label: 'T 型手柄', kind: 'handle' },
  { value: 'handle-key', label: '钥匙手柄', kind: 'handle' },
] as const

export const ALL_TAGS = [...DEVICE_TAGS, ...HANDLE_TAGS]

export function tagLabel(value: string): string {
  return ALL_TAGS.find((tag) => tag.value === value)?.label ?? value
}

export const DEVICE_CATEGORIES = [
  { value: 'wrist', label: '腕部设备' },
  { value: 'desk-torque', label: '桌面力矩' },
  { value: 'grip', label: '握力设备' },
  { value: 'body', label: '体感设备' },
  { value: 'other', label: '其他' },
] as const

export const PLAY_MODES = [
  { value: 'active-force', label: '纯主动发力（合规）' },
] as const

export function statusText(status: string): string {
  return status === 'on' ? '已上架' : status === 'off' ? '已下架' : status
}
