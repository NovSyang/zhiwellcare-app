import { downsampleForDisplay, sampleAtElapsed, type TrainingReplay } from '@/shared/core'
import { defaultTrajectoryFollowGameConfig, extractReferenceSamples } from '@/shared/trajectory'
import { TrajectoryFollowCanvas } from '../../../platform/canvas/TrajectoryFollowCanvas'
import type { CanvasSurface } from '../../../platform/canvas/WeChatCanvasSurface'

/** 用保存时的参考点和实际姿态回放，训练路径和评分无需重算。 */
export class TrajectoryFollowReplayCanvas {
  readonly node: CanvasSurface['node']
  private readonly canvas: TrajectoryFollowCanvas
  private readonly reference
  private readonly fullTrail
  private readonly trailWindowMs: number
  private readonly tolerance: number

  constructor(surface: CanvasSurface, private readonly replay: TrainingReplay, config: unknown) {
    this.reference = extractReferenceSamples(replay.events)
    if (!this.reference.length) throw new Error('轨迹回放缺少训练时保存的参考路径。')
    this.canvas = new TrajectoryFollowCanvas(surface)
    this.node = this.canvas.node
    this.fullTrail = downsampleForDisplay(replay.samples)
    const snapshot = config && typeof config === 'object'
      ? config as { trailWindowMs?: unknown; toleranceRadius?: unknown }
      : {}
    this.trailWindowMs = validPositive(snapshot.trailWindowMs, defaultTrajectoryFollowGameConfig.trailWindowMs)
    this.tolerance = validPositive(snapshot.toleranceRadius, defaultTrajectoryFollowGameConfig.toleranceRadius)
  }

  draw(elapsed: number, trajectory: boolean): void {
    const from = Math.max(0, elapsed - this.trailWindowMs)
    const trail = trajectory ? this.fullTrail : this.replay.samples.filter(({ elapsedMs }) => elapsedMs >= from && elapsedMs <= elapsed)
    this.canvas.draw({
      reference: this.reference,
      trail,
      player: trajectory ? null : sampleAtElapsed(this.replay.samples, elapsed),
      guide: trajectory ? null : sampleAtElapsed(this.reference, elapsed),
      tolerance: this.tolerance,
    })
  }
}

/** 旧记录缺少画布参数时使用默认值，已保存的运动点照常回放。 */
function validPositive(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}
