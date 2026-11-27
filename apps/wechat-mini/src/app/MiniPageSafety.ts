import Taro, { useDidHide, useDidShow, useLoad, useReady, useResize, useUnload } from '@tarojs/taro'
import { shallowRef, watch, type Ref } from 'vue'
import { MiniOperationSafety } from './MiniOperationSafety'

export const miniSafety = new MiniOperationSafety(() => {
  const pages = Taro.getCurrentPages()
  return (pages[pages.length - 1]?.route ?? '').replace(/^\//, '')
})
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

/** 微信窗口高度已排除原生导航和 Tab 栏，横屏返回后重新读取。 */
export function useMiniTabPage(route: string) {
  const viewport = shallowRef<{ height: string }>()
  const refresh = () => {
    try {
      const height = Taro.getWindowInfo?.()?.windowHeight
      viewport.value = height && height > 0 ? { height: `${height}px` } : undefined
    } catch { viewport.value = undefined }
  }
  useDidShow(refresh)
  useResize(refresh)
  useMiniSafePage(route)
  return viewport
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
