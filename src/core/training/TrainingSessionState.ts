/** 一次训练从准备到结束的生命周期状态。 */
export type TrainingSessionState =
  | 'idle'
  | 'countdown'
  | 'playing'
  | 'paused'
  | 'completed'
  | 'aborted'
