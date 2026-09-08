import type { GameInput } from '../../core/game-input/GameInput'
import type { RiverDriftGameConfig } from './RiverDriftGameConfig'

export interface RiverDriftBoatState {
  x: number
  y: number
  velocityX: number
  velocityY: number
}

export interface RiverDriftBoatBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/** 小输入先归零，再平滑拉伸剩余范围，避免跨过死区时突然跳变。 */
export function applyRiverDriftNeutralThreshold(value: number, threshold: number): number {
  const safeValue = clamp(Number.isFinite(value) ? value : 0, -1, 1)
  const safeThreshold = clamp(Number.isFinite(threshold) ? threshold : 0, 0, 0.95)
  if (Math.abs(safeValue) <= safeThreshold) return 0
  return Math.sign(safeValue) * (Math.abs(safeValue) - safeThreshold) / (1 - safeThreshold)
}

/** 固定时间步更新船体；输入决定目标速度，而不是直接决定绝对位置。 */
export function stepRiverDriftBoat(
  state: RiverDriftBoatState,
  input: Pick<GameInput, 'x' | 'y'>,
  bounds: RiverDriftBoatBounds,
  config: RiverDriftGameConfig,
  dtSeconds: number,
): RiverDriftBoatState {
  const safeDt = clamp(Number.isFinite(dtSeconds) ? dtSeconds : 0, 0, config.maxFrameDeltaMs / 1_000)
  if (safeDt === 0) return { ...state }
  const stepRatio = safeDt / (config.fixedStepMs / 1_000)
  const response = 1 - Math.pow(1 - clamp(config.steeringResponsiveness, 0, 1), stepRatio)
  const damping = Math.pow(clamp(config.velocityDamping, 0, 1), stepRatio)
  const normalizedX = applyRiverDriftNeutralThreshold(input.x, config.neutralThreshold)
  const normalizedY = applyRiverDriftNeutralThreshold(input.y, config.neutralThreshold)
  const targetX = normalizedX * config.maxHorizontalSpeed
  // 归一化输入向前为正，而屏幕坐标向上为负，因此这里反转 Y。
  const targetY = -normalizedY * config.maxVerticalSpeed
  let velocityX = state.velocityX + (targetX - state.velocityX) * response
  let velocityY = state.velocityY + (targetY - state.velocityY) * response
  if (normalizedX === 0) velocityX *= damping
  if (normalizedY === 0) velocityY *= damping

  velocityX = softenOutwardVelocity(state.x, velocityX, bounds.minX, bounds.maxX)
  velocityY = softenOutwardVelocity(state.y, velocityY, bounds.minY, bounds.maxY)
  const x = clamp(state.x + velocityX * safeDt, bounds.minX, bounds.maxX)
  const y = clamp(state.y + velocityY * safeDt, bounds.minY, bounds.maxY)
  if ((x === bounds.minX && velocityX < 0) || (x === bounds.maxX && velocityX > 0)) velocityX = 0
  if ((y === bounds.minY && velocityY < 0) || (y === bounds.maxY && velocityY > 0)) velocityY = 0
  return { x, y, velocityX, velocityY }
}

/** 最后 20% 活动空间逐渐削弱继续向外的速度。 */
function softenOutwardVelocity(value: number, velocity: number, min: number, max: number): number {
  const center = (min + max) / 2
  const half = Math.max(0.0001, (max - min) / 2)
  const ratio = Math.abs(value - center) / half
  const movingOutward = (value < center && velocity < 0) || (value > center && velocity > 0)
  if (!movingOutward || ratio <= 0.8) return velocity
  return velocity * clamp((1 - ratio) / 0.2, 0, 1)
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
