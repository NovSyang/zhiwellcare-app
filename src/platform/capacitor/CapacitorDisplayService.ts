import { KeepAwake } from '@capacitor-community/keep-awake'
import { ScreenOrientation } from '@capacitor/screen-orientation'
import { SystemBars } from '@capacitor/core'
import type { IDisplayService, TrainingDisplayState } from '../display/IDisplayService'

/** Android 训练期间锁定横屏、隐藏系统栏并保持亮屏，单项失败不会阻止训练。 */
export class CapacitorDisplayService implements IDisplayService {
  async enterTrainingMode(): Promise<TrainingDisplayState> {
    const [orientationLocked, systemBarsHidden] = await Promise.all([
      succeeds(() => ScreenOrientation.lock({ orientation: 'landscape' })),
      succeeds(() => SystemBars.hide()),
      succeeds(() => KeepAwake.keepAwake()),
    ])
    return { native: true, orientationLocked, systemBarsHidden }
  }

  async refreshTrainingMode(): Promise<void> {
    // 回前台时重新应用显示状态，但不等待某一项失败后再执行其他项。
    await Promise.allSettled([
      ScreenOrientation.lock({ orientation: 'landscape' }),
      SystemBars.hide(),
      KeepAwake.keepAwake(),
    ])
  }

  async leaveTrainingMode(): Promise<void> {
    // 三项清理互不阻塞，确保其中一个失败时其他恢复操作仍会执行。
    await Promise.allSettled([SystemBars.show(), KeepAwake.allowSleep(), ScreenOrientation.unlock()])
  }
}

/** 将原生能力失败转换为状态值，避免异常中断训练。 */
async function succeeds(action: () => Promise<void>): Promise<boolean> {
  try {
    await action()
    return true
  } catch {
    return false
  }
}
