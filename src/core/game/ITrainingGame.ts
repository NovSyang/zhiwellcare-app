import type { BaseTrainingResult } from '../training/BaseTrainingResult'
import type { IZhiWellCare } from './IZhiWellCare'

/** 正式训练游戏在最小生命周期外，还要公开排除暂停后的有效时间。 */
export interface ITrainingGame<TResult extends BaseTrainingResult = BaseTrainingResult> extends IZhiWellCare {
  /** 仅用于 TypeScript 关联游戏与结果类型，不需要运行时实现。 */
  readonly resultType?: TResult
  getTrainingElapsedMs(now?: number): number
}
