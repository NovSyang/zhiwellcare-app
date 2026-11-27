import Taro, { useDidHide, useDidShow, useLoad, useReady, useResize, useUnload } from '@tarojs/taro'
import { computed, shallowRef, watch, type Ref } from 'vue'
import { MiniOperationSafety } from './MiniOperationSafety'
import {
  createMiniTabLayoutMeasurement, type MiniTabLayoutSnapshot, type MiniWindowSize,
} from './MiniTabLayoutMeasurement'

function currentMiniRoute() {
  const pages = Taro.getCurrentPages()
  return (pages[pages.length - 1]?.route ?? '').replace(/^\//, '')
}

export const miniSafety = new MiniOperationSafety(currentMiniRoute)
export const miniUpdateGuard = miniSafety.guard

/** 旧页面的 hide 只能清除属于自己的可见标记。 */
export function useMiniSafePage(route: string, dataReady?: Readonly<Ref<boolean>>) {
  const owner = Symbol(route)
  let visible = false
  let mounted = false
  const sync = () => {
    if (visible && mounted && (dataReady?.value ?? true)) miniSafety.show(owner, route)
    else miniSafety.hide(owner)
  }
  useDidShow(() => { visible = true; sync() })
  useReady(() => { mounted = true; sync() })
  useDidHide(() => { visible = false; sync() })
  useUnload(() => { visible = false; sync() })
  if (dataReady) watch(dataReady, sync, { flush: 'sync' })
}

function readMiniWindow(): MiniWindowSize | undefined {
  const read = (get: () => { windowWidth: number; windowHeight: number } | undefined) => {
    try {
      const size = get()
      if (!size || !Number.isFinite(size.windowWidth) || size.windowWidth <= 0
        || !Number.isFinite(size.windowHeight) || size.windowHeight <= 0) return undefined
      return { width: size.windowWidth, height: size.windowHeight }
    } catch { return undefined }
  }
  // 兼容旧基础库，始终读取页面可用窗口，不替换成屏幕总高度。
  return read(() => Taro.getWindowInfo?.()) ?? read(() => Taro.getSystemInfoSync?.())
}

/** 只测量页级包装层，微信原生导航与 Tab 栏已计入窗口边界。 */
export function useMiniTabPage(route: string) {
  const layout = shallowRef<MiniTabLayoutSnapshot>({ fallbackPageScroll: false })
  const measurement = createMiniTabLayoutMeasurement({
    isCurrentPage: () => currentMiniRoute() === route,
    readWindow: readMiniWindow,
    afterRender: (callback) => Taro.nextTick(callback),
    readHeader: (callback) => {
      try {
        Taro.createSelectorQuery().select('#mini-tab-header').boundingClientRect((rect) => {
          // Taro 的节点类型同时覆盖单选和多选，取第一个实际盒子。
          const header = Array.isArray(rect) ? rect[0] : rect
          callback(header?.height)
        }).exec()
      } catch { callback() }
    },
    publish: (snapshot) => { layout.value = snapshot },
  })
  useDidShow(measurement.show)
  useReady(measurement.ready)
  useResize(measurement.resize)
  useDidHide(measurement.hide)
  useUnload(measurement.dispose)
  useMiniSafePage(route)

  const pxHeight = (height?: number) => height === undefined ? undefined : { height: `${height}px` }
  return {
    viewport: computed(() => pxHeight(layout.value.metrics?.windowHeight)),
    scrollStyle: computed(() => pxHeight(layout.value.metrics?.scrollHeight)),
    fallbackPageScroll: computed(() => layout.value.fallbackPageScroll),
  }
}

/** 页面锁随卸载释放，尚未完成的保存由独立写入锁继续保护。 */
export function useMiniPageLock(reason: string, cleanup?: () => void | Promise<void>) {
  let release: (() => void) | undefined
  useLoad(() => { release = miniSafety.acquire(reason) })
  useUnload(async () => {
    try { await cleanup?.() } finally { release?.() }
  })
}

export function withMiniOperationLock<T>(reason: string, action: () => Promise<T>): Promise<T> {
  return miniSafety.withLock(reason, action)
}

/** 导航过程也挡住更新；以目标页面的 show 和页面栈判断后续可见性。 */
export function navigateMini<T>(action: () => Promise<T>): Promise<T> {
  return withMiniOperationLock('页面切换', async () => {
    const result = await action()
    await new Promise<void>((resolve) => Taro.nextTick(resolve))
    return result
  })
}
