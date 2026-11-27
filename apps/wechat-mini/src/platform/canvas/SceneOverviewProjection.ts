import { clamp } from '../../../../../src/core/replay/ReplayMath'

/** 两个比例是概览坐标，不是设备输入，也不是透视画布像素。 */
export interface SceneOverviewPoint { lateralRatio: number; progressRatio: number }

// 漂流保持历史回放的横向船位与有效时间轴。
export function projectRiverOverview(elapsedMs: number, boatX: number, durationMs: number): SceneOverviewPoint {
  return { lateralRatio: boatX, progressRatio: elapsedMs / Math.max(1, durationMs) }
}

// 卡丁车保持历史回放的横向车位与赛道里程轴。
export function projectKartOverview(lateral: number, distance: number, trackLength: number): SceneOverviewPoint {
  return { lateralRatio: clamp((lateral + 1) / 2, 0, 1), progressRatio: clamp(distance / trackLength, 0, 1) }
}
