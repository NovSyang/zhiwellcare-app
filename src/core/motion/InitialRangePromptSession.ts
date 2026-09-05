import type { MotionProfile } from './MotionProfile'

/** 首次提示只需要关心路由是否属于校准页或沉浸页。 */
export interface InitialRangePromptRoute {
  path: string
  immersive: boolean
}

/** 首次个人活动范围提示的实时展示条件。 */
export interface InitialRangePromptContext {
  connected: boolean
  profile: Pick<MotionProfile, 'measuredRange'>
  route: InitialRangePromptRoute
  blockingOverlayVisible: boolean
}

/**
 * 仅记录当前 App 运行会话内是否已经处理过提示。
 * 实例不会持久化，重新启动后仍会依据 measuredRange 再次判断。
 */
export class InitialRangePromptSession {
  private handled = false

  shouldShow(context: InitialRangePromptContext): boolean {
    return !this.handled
      && context.connected
      && context.profile.measuredRange === null
      && context.route.path !== '/calibration'
      && !context.route.immersive
      && !context.blockingOverlayVisible
  }

  markHandled(): void {
    this.handled = true
  }

  isHandled(): boolean {
    return this.handled
  }
}
