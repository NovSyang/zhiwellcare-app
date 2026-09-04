export interface TrainingDisplayState {
  native: boolean
  orientationLocked: boolean
}

/** 训练页只表达显示意图，不直接依赖 Android 插件。 */
export interface IDisplayService {
  enterTrainingMode(): Promise<TrainingDisplayState>
  leaveTrainingMode(): Promise<void>
}
