import Taro from '@tarojs/taro'

/** 同时读取窗口、安全区和胶囊，训练页据此判断能否并排放置工具栏。 */
export function readImmersiveGeometry() {
  const { windowWidth, windowHeight, screenWidth, screenHeight, safeArea } = Taro.getWindowInfo()
  const margin = 12
  let left = 0, right = 0, top = 0, bottom = 0
  if (safeArea) {
    if (windowWidth > windowHeight && safeArea.right < windowWidth * 0.75) {
      // 部分设备仍返回竖屏安全区，横屏两端都预留原顶部和底部的较大值。
      left = right = Math.max(safeArea.top, Math.max(screenWidth, screenHeight) - safeArea.bottom, 0)
      left = right = Math.min(left, 48)
    } else if (safeArea.left >= 0 && safeArea.right <= windowWidth + 1 && safeArea.top >= 0 && safeArea.bottom <= windowHeight + 1) {
      left = safeArea.left
      right = Math.max(0, windowWidth - safeArea.right)
      top = safeArea.top
      bottom = Math.max(0, windowHeight - safeArea.bottom)
    }
  }
  const capsule = Taro.getMenuButtonBoundingClientRect?.()
  const capsuleBottom = capsule && capsule.width > 0 && capsule.left > windowWidth / 2
    && capsule.right <= windowWidth + 1 && capsule.bottom > 0 && capsule.bottom < windowHeight / 3 ? capsule.bottom : 0
  return {
    windowWidth,
    left: left + margin,
    right: right + margin,
    safeTop: top,
    capsule: capsuleBottom ? capsule : undefined,
    insets: {
      '--safe-left': `${left + margin}px`,
      '--safe-right': `${right + margin}px`,
      '--safe-bottom': `${bottom + margin}px`,
      '--safe-top': `${Math.max(top, capsuleBottom) + (capsuleBottom ? 6 : margin)}px`,
    },
  }
}

/** 暂停面板与回放继续使用胶囊下方的原有安全边距。 */
export function readImmersiveLayout() {
  return readImmersiveGeometry().insets
}

let keepScreenTask = Promise.resolve()

/** 串行开关常亮，避免退出时较早的开启请求覆盖关闭。 */
export function setTrainingScreenOn(keepScreenOn: boolean, requireSuccess = false): Promise<void> {
  const task = keepScreenTask.then(async () => {
    try { await Taro.setKeepScreenOn({ keepScreenOn }) }
    catch (failure) {
      // 安装更新前需要确认关闭；普通训练操作仍可在旧微信环境继续。
      if (requireSuccess) throw failure
      console.warn('微信屏幕常亮设置暂不可用。')
    }
  })
  keepScreenTask = task.catch(() => undefined)
  return task
}
