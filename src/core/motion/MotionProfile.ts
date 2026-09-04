import type { MotionConfig, MotionRange } from './MotionConfig'

/** 当前使用者的死区与四方向活动范围配置。 */
export interface MotionProfile {
  schemaVersion: 1
  id: string
  name: string
  horizontalDeadZone: number
  verticalDeadZone: number
  measuredRange: MotionRange | null
  activeRange: MotionRange
  trainingRatio: number
  createdAt: number
  updatedAt: number
}

/** 创建默认配置，调用时生成时间戳以便持久化记录真实创建时间。 */
export function createDefaultMotionProfile(now = Date.now()): MotionProfile {
  return {
    schemaVersion: 1,
    id: 'default',
    name: '默认运动配置',
    horizontalDeadZone: 0.5,
    verticalDeadZone: 0.5,
    measuredRange: null,
    activeRange: { leftMax: 20, rightMax: 20, forwardMax: 20, backwardMax: 20 },
    trainingRatio: 0.8,
    createdAt: now,
    updatedAt: now,
  }
}

/** 兼容需要默认对象的调用方；保存前服务会生成独立副本。 */
export const defaultMotionProfile = createDefaultMotionProfile()

/** 将 Profile 中实际训练使用的范围转换为输入处理器配置。 */
export function motionConfigFromProfile(profile: MotionProfile): MotionConfig {
  return {
    horizontalDeadZone: profile.horizontalDeadZone,
    verticalDeadZone: profile.verticalDeadZone,
    range: structuredClone(profile.activeRange),
  }
}

/** 按训练比例缩放实测四方向 ROM，避免超过舒适训练范围。 */
export function activeRangeFromMeasured(range: MotionRange, ratio: number): MotionRange {
  const safeRatio = Math.max(0.1, Math.min(1, ratio))
  return {
    leftMax: range.leftMax * safeRatio,
    rightMax: range.rightMax * safeRatio,
    forwardMax: range.forwardMax * safeRatio,
    backwardMax: range.backwardMax * safeRatio,
  }
}

/** 使用 ROM 标定值生成可保存的 Profile，并保留旧 Profile 的偏好设置。 */
export function profileFromMeasuredRange(
  measuredRange: MotionRange,
  previous: MotionProfile,
  now = Date.now(),
): MotionProfile {
  return {
    ...structuredClone(previous),
    measuredRange: structuredClone(measuredRange),
    activeRange: activeRangeFromMeasured(measuredRange, previous.trainingRatio),
    updatedAt: now,
  }
}
