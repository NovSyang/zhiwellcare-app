/** 低频电量属于设备运行状态，不属于每帧运动数据。 */
export interface SensorBatteryState {
  rawValue: number | null
  percent: number | null
  updatedAt: number | null
  rawHex: string | null
}

/** 电量变化缓慢，30 秒刷新足以反映状态且不会干扰训练数据流。 */
export const BATTERY_POLL_INTERVAL_MS = 30_000
export const LOW_BATTERY_PERCENT = 20

/**
 * 厂家电压表中的寄存器值等于电压的 100 倍。
 * 分界值优先归入较高电压档，例如 406 为 95%、391 为 75%、389 为 70%。
 */
const BATTERY_PERCENT_THRESHOLDS: ReadonlyArray<{ minRaw: number; percent: number }> = [
  { minRaw: 406, percent: 95 },
  { minRaw: 402, percent: 90 },
  { minRaw: 397, percent: 85 },
  { minRaw: 393, percent: 80 },
  { minRaw: 390, percent: 75 },
  { minRaw: 386, percent: 70 },
  { minRaw: 384, percent: 65 },
  { minRaw: 381, percent: 60 },
  { minRaw: 376, percent: 55 },
  { minRaw: 373, percent: 50 },
  { minRaw: 370, percent: 45 },
  { minRaw: 368, percent: 40 },
  { minRaw: 366, percent: 35 },
  { minRaw: 364, percent: 30 },
  { minRaw: 362, percent: 25 },
  { minRaw: 359, percent: 20 },
  { minRaw: 355, percent: 15 },
  { minRaw: 350, percent: 10 },
  { minRaw: 342, percent: 5 },
]

/** 每次断线都创建新对象，确保旧设备电量不会继续显示。 */
export function createEmptyBatteryState(): SensorBatteryState {
  return { rawValue: null, percent: null, updatedAt: null, rawHex: null }
}

/**
 * 按厂家提供的离散电压表解码 Battery Raw。
 * 非法输入不应显示虚假电量，因此继续返回未知状态。
 */
export function decodeBatteryPercent(rawValue: number): number | null {
  if (!Number.isFinite(rawValue) || !Number.isInteger(rawValue) || rawValue < 0) return null
  if (rawValue > 413) return 100
  return BATTERY_PERCENT_THRESHOLDS.find((band) => rawValue >= band.minRaw)?.percent ?? 0
}

/** 将运行时电量限制为图标可安全渲染的 0 到 100 范围。 */
export function getBatteryFillPercent(percent: number | null): number {
  if (percent === null || !Number.isFinite(percent)) return 0
  return Math.min(100, Math.max(0, percent))
}

/** 低电量只用于视觉提醒，不会中断训练或改变设备连接状态。 */
export function isLowBatteryPercent(percent: number | null): boolean {
  return percent !== null && Number.isFinite(percent) && percent <= LOW_BATTERY_PERCENT
}
