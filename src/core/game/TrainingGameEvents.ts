import type { ReplayEvent } from '../replay/TrainingReplay'
import type { BaseTrainingResult } from '../training/BaseTrainingResult'
import type { TrainingSessionState } from '../training/TrainingSessionState'

/** 训练页可直接渲染的一项游戏指标。 */
export interface GameHudMetric {
  label: string
  value: string
}

/** 游戏把自己的业务状态转换成通用 HUD，训练页无需识别结果字段。 */
export interface GameHudSnapshot {
  title: string
  subtitle?: string
  metrics: GameHudMetric[]
}

/** 正式游戏向通用训练宿主发布的事件集合。 */
export interface TrainingGameEvents<TResult extends BaseTrainingResult = BaseTrainingResult> {
  onSessionStateChanged?: (state: TrainingSessionState) => void
  onHudChanged?: (hud: GameHudSnapshot) => void
  onReplayEvent?: (event: ReplayEvent) => void
  onCompleted?: (result: TResult) => void
}
