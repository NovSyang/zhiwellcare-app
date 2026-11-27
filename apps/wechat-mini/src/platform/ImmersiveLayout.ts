import Taro from '@tarojs/taro'

/** 读取当前窗口的安全边距和胶囊位置，控件放在胶囊下方。 */
export function readImmersiveLayout() {
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
    '--safe-left': `${left + margin}px`,
    '--safe-right': `${right + margin}px`,
    '--safe-bottom': `${bottom + margin}px`,
    '--safe-top': `${Math.max(top, capsuleBottom) + (capsuleBottom ? 6 : margin)}px`,
  }
}

let keepScreenTask = Promise.resolve()

/** 串行开关常亮，避免退出时较早的开启请求覆盖关闭。 */
export function setTrainingScreenOn(keepScreenOn: boolean): Promise<void> {
  keepScreenTask = keepScreenTask.then(async () => {
    try { await Taro.setKeepScreenOn({ keepScreenOn }) }
    catch { console.warn('微信屏幕常亮设置暂不可用。') }
  })
  return keepScreenTask
}
