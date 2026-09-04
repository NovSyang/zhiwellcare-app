/**
 * 设备能力标签体系（智为康乐 · 消费级主动训练硬件）
 *
 * 设计原则：设备型号由后台配置能力标签，游戏声明所需标签；
 * 匹配公式「设备能力标签 ⊇ 游戏所需标签」全部满足才可运行。
 * 手柄配件作为二级标签参与匹配；代码侧仅维护已知枚举便于展示与类型提示，
 * 真正的目录始终以服务端/本地目录源配置为准，新增硬件与游戏无需发版。
 */

/** 设备主能力标签（第一级）。 */
export const DeviceCapabilityTag = {
  /** 姿态传感（角度/朝向）→ 不倒翁手腕训练仪 */
  PostureSensor: 'posture-sensor',
  /** 力矩传感（纯主动阻力，无电机驱动）→ 桌面力矩主动训练底座 */
  TorqueSensor: 'torque-sensor',
  /** 六轴体感（IMU）→ 未来体感设备 */
  SixAxisImu: 'six-axis-imu',
  /** 握力传感（纯主动发力）→ 未来握力设备 */
  GripSensor: 'grip-sensor',
} as const
export type DeviceCapabilityTag = (typeof DeviceCapabilityTag)[keyof typeof DeviceCapabilityTag]

/** 手柄配件二级标签：作为配件附加到设备能力中参与匹配。 */
export const HandleTag = {
  SteeringWheel: 'handle-steering-wheel',
  Sphere: 'handle-sphere',
  TShape: 'handle-t',
  Key: 'handle-key',
} as const
export type HandleTag = (typeof HandleTag)[keyof typeof HandleTag]

/** 可用于标签匹配的全部标签标识（主能力 + 手柄配件）。 */
export type MatchTag = DeviceCapabilityTag | HandleTag

/** 面向用户的标签展示文案。 */
export const TAG_LABELS: Readonly<Record<MatchTag, string>> = {
  [DeviceCapabilityTag.PostureSensor]: '姿态传感',
  [DeviceCapabilityTag.TorqueSensor]: '力矩传感·主动阻力',
  [DeviceCapabilityTag.SixAxisImu]: '六轴体感',
  [DeviceCapabilityTag.GripSensor]: '握力传感',
  [HandleTag.SteeringWheel]: '方向盘手柄',
  [HandleTag.Sphere]: '球形手柄',
  [HandleTag.TShape]: 'T 型手柄',
  [HandleTag.Key]: '钥匙手柄',
}

export function tagLabel(tag: MatchTag): string {
  return TAG_LABELS[tag] ?? tag
}

/** 标签来源分组：主能力标签（第一级）或手柄配件（第二级）。 */
export function tagLevel(tag: MatchTag): 'device' | 'handle' {
  return (Object.values(HandleTag) as string[]).includes(tag) ? 'handle' : 'device'
}
