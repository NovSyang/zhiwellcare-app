import type { ReplayEvent } from '../../../core/replay/TrainingReplay'
import type { TrajectoryReferenceSample } from '../TrajectoryFollowMath'

/** 保存训练当时的参考路径，回放时不重新运行未来版本的轨迹公式。 */
export type TrajectoryFollowReplayEvent = ReplayEvent & {
  type: 'reference-path'
  payload: { samples: TrajectoryReferenceSample[] }
}
