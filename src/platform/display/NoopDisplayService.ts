import type { IDisplayService, TrainingDisplayState } from './IDisplayService'

/** Windows 与浏览器保持现有窗口行为，不执行移动端方向和常亮操作。 */
export class NoopDisplayService implements IDisplayService {
  async enterTrainingMode(): Promise<TrainingDisplayState> { return { native: false, orientationLocked: true } }
  async leaveTrainingMode(): Promise<void> {}
}
