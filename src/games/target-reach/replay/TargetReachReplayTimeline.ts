import type { ReplayEvent } from '../../../core/replay/TrainingReplay'
import { defaultTargetReachGameConfig, type TargetReachGameConfig } from '../TargetReachGameConfig'
import { createTargetReachViewport, getPlayerRadiusPx, type TargetReachViewport } from '../TargetReachViewportMapper'

export interface HistoricalTarget {
  index: number
  x: number
  y: number
  outcome: 'success' | 'failed' | null
}

// 回放没有训练 HUD，四边使用一致边距，但坐标比例与实时训练完全相同。
const REPLAY_VIEWPORT_INSETS = { top: 24, right: 24, bottom: 24, left: 24 } as const

/** TargetReach 回放在当前舞台中使用的统一视口与视觉半径。 */
export interface TargetReachReplayGeometry {
  viewport: TargetReachViewport
  playerRadiusPx: number
  targetRadiusPx: number
}

/** 旧记录或异常配置只覆盖有效正数，其余字段继续使用当前默认值。 */
export function resolveTargetReachGameConfig(value: unknown): TargetReachGameConfig {
  const resolved = { ...defaultTargetReachGameConfig, enabledDirections: [...defaultTargetReachGameConfig.enabledDirections] }
  if (!value || typeof value !== 'object') return resolved
  const candidate = value as Record<string, unknown>
  for (const key of ['targetDistance', 'targetRadius', 'playerRadius'] as const) {
    const next = candidate[key]
    if (typeof next === 'number' && Number.isFinite(next) && next > 0) resolved[key] = next
  }
  return resolved
}

/** 几何计算保持纯函数，便于验证不同尺寸下与正式训练使用相同半径规则。 */
export function createTargetReachReplayGeometry(
  width: number,
  height: number,
  config: TargetReachGameConfig,
): TargetReachReplayGeometry {
  const viewport = createTargetReachViewport(width, height, REPLAY_VIEWPORT_INSETS)
  return {
    viewport,
    playerRadiusPx: getPlayerRadiusPx(viewport.interactionScale, config.playerRadius),
    targetRadiusPx: config.targetRadius * viewport.interactionScale,
  }
}

/** 预先排序事实事件，供 APP 与微信按有效训练时间查找。 */
export class TargetReachReplayTimeline {
  private readonly events: ReplayEvent[]

  constructor(events: readonly ReplayEvent[]) {
    this.events = [...events].sort((a, b) => a.elapsedMs - b.elapsedMs)
  }

  targetAt(elapsedMs: number): HistoricalTarget | null {
    let current: HistoricalTarget | null = null
    for (const event of this.events) {
      if (event.elapsedMs > elapsedMs) break
      if (isTargetStart(event)) current = { index: event.payload.index, x: event.payload.targetX, y: event.payload.targetY, outcome: null }
      if (isTargetOutcome(event) && current?.index === event.payload.index) current = null
    }
    return current
  }

  currentTargetStartedAt(elapsedMs: number): number {
    let startedAt = 0
    for (const event of this.events) {
      if (event.elapsedMs > elapsedMs) break
      if (isTargetStart(event)) startedAt = event.elapsedMs
    }
    return startedAt
  }

  allTargets(): HistoricalTarget[] {
    const targets = new Map<number, HistoricalTarget>()
    for (const event of this.events) {
      if (isTargetStart(event)) targets.set(event.payload.index, { index: event.payload.index, x: event.payload.targetX, y: event.payload.targetY, outcome: null })
      if (isTargetOutcome(event)) {
        const target = targets.get(event.payload.index)
        if (target) target.outcome = event.type === 'target-success' ? 'success' : 'failed'
      }
    }
    return [...targets.values()]
  }
}

function isTargetStart(event: ReplayEvent): event is ReplayEvent & { type: 'target-start'; payload: { index: number; targetX: number; targetY: number } } {
  const payload = event.payload as Partial<{ index: number; targetX: number; targetY: number }> | undefined
  return event.type === 'target-start' && typeof payload?.index === 'number' && typeof payload.targetX === 'number' && typeof payload.targetY === 'number'
}

function isTargetOutcome(event: ReplayEvent): event is ReplayEvent & { type: 'target-success' | 'target-failed'; payload: { index: number } } {
  const payload = event.payload as Partial<{ index: number }> | undefined
  return (event.type === 'target-success' || event.type === 'target-failed') && typeof payload?.index === 'number'
}
