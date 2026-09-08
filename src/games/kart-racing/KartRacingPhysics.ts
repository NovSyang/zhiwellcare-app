import type { GameInput } from '../../core/game-input/GameInput'
import type { KartRacingGameConfig } from './KartRacingGameConfig'
import type { KartTrackSegment } from './KartRacingTrack'
import { getKartTrackSegment } from './KartRacingTrack'

export interface KartState {
  /** -1~1 的赛道横向位置，零点始终是当前道路中心。 */
  lateral: number
  lateralVelocity: number
  speed: number
  distance: number
}

export interface KartPhysicsEffects {
  slowdownFactor?: number
  boostFactor?: number
}

/** 小输入先归零，再平滑拉伸剩余范围，避免跨过死区时跳变。 */
export function applyKartNeutralThreshold(value: number, threshold: number): number {
  const safeValue = clamp(Number.isFinite(value) ? value : 0, -1, 1)
  const safeThreshold = clamp(Number.isFinite(threshold) ? threshold : 0, 0, 0.95)
  if (Math.abs(safeValue) <= safeThreshold) return 0
  return Math.sign(safeValue) * (Math.abs(safeValue) - safeThreshold) / (1 - safeThreshold)
}

/** 计算前后动作对应的目标速度；自然中心始终回到巡航速度。 */
export function kartTargetSpeed(inputY: number, config: KartRacingGameConfig, boostFactor = 1): number {
  const normalized = applyKartNeutralThreshold(inputY, config.throttleNeutralThreshold)
  const base = normalized >= 0
    ? config.cruiseSpeed + normalized * (config.maxSpeed - config.cruiseSpeed)
    : config.cruiseSpeed + normalized * (config.cruiseSpeed - config.minSpeed)
  return clamp(base * Math.max(1, boostFactor), config.minSpeed, config.maxSpeed * Math.max(1, boostFactor))
}

/** 固定时间步推进车辆，速度、转向和弯道趋势均保持帧率无关。 */
export function stepKartRacing(
  state: KartState,
  input: Pick<GameInput, 'x' | 'y'>,
  track: readonly KartTrackSegment[],
  config: KartRacingGameConfig,
  dtSeconds: number,
  effects: KartPhysicsEffects = {},
): KartState {
  const safeDt = clamp(Number.isFinite(dtSeconds) ? dtSeconds : 0, 0, config.maxFrameDeltaMs / 1_000)
  if (safeDt === 0) return { ...state }
  const steering = applyKartNeutralThreshold(input.x, config.steeringNeutralThreshold)
  const boostFactor = Math.max(1, effects.boostFactor ?? 1)
  const slowdownFactor = clamp(effects.slowdownFactor ?? 1, 0.1, 1)
  const targetSpeed = kartTargetSpeed(input.y, config, boostFactor) * slowdownFactor
  const speedResponseMs = targetSpeed < state.speed ? config.brakingResponseMs : config.accelerationResponseMs
  const speedResponse = exponentialResponse(safeDt, speedResponseMs)
  let speed = state.speed + (targetSpeed - state.speed) * speedResponse
  speed = clamp(speed, config.minSpeed * slowdownFactor, config.maxSpeed * boostFactor)

  const speedRatio = clamp((speed - config.minSpeed) / Math.max(0.001, config.maxSpeed - config.minSpeed), 0, 1)
  const steeringScale = 1 - speedRatio * (1 - config.highSpeedSteeringMinFactor)
  const targetLateralVelocity = steering * config.maxLateralSpeed * steeringScale
  const steeringResponse = exponentialResponse(safeDt, config.steeringResponseMs)
  let lateralVelocity = state.lateralVelocity + (targetLateralVelocity - state.lateralVelocity) * steeringResponse
  if (steering === 0) {
    const stepRatio = safeDt / Math.max(0.001, config.fixedStepMs / 1_000)
    lateralVelocity *= Math.pow(clamp(config.lateralCenterDamping, 0, 1), stepRatio)
  }

  const segment = getKartTrackSegment(track, state.distance)
  const curveShift = -segment.curvature * speed * config.curveDriftFactor * safeDt
  let lateral = clamp(state.lateral + lateralVelocity * safeDt + curveShift, -config.lateralLimit, config.lateralLimit)
  if ((lateral === -config.lateralLimit && lateralVelocity < 0) || (lateral === config.lateralLimit && lateralVelocity > 0)) {
    lateralVelocity = 0
  }
  if (!Number.isFinite(lateral)) lateral = 0
  return { lateral, lateralVelocity, speed, distance: Math.max(0, state.distance + speed * safeDt) }
}

function exponentialResponse(dtSeconds: number, responseMs: number): number {
  return 1 - Math.exp(-dtSeconds / Math.max(0.001, responseMs / 1_000))
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
