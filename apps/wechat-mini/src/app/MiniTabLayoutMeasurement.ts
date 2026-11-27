import { calculateMiniTabLayout, type MiniTabLayoutMetrics } from './MiniTabLayoutMetrics'

export interface MiniWindowSize { width: number; height: number }

export interface MiniTabLayoutSnapshot {
  metrics?: MiniTabLayoutMetrics
  fallbackPageScroll: boolean
}

interface LayoutPort {
  isCurrentPage: () => boolean
  readWindow: () => MiniWindowSize | undefined
  afterRender: (callback: () => void) => void
  readHeader: (callback: (height?: number) => void) => void
  publish: (snapshot: MiniTabLayoutSnapshot) => void
}

const retryDelays = [40, 100, 200] as const
const queryTimeoutMs = 250

function sameWindow(a: MiniWindowSize | undefined, b: MiniWindowSize | undefined): boolean {
  return !!a && !!b && a.width === b.width && a.height === b.height
}

/** 每个 Tab 单独测量。隐藏、卸载或新的窗口变化会使旧查询失效。 */
export function createMiniTabLayoutMeasurement(port: LayoutPort) {
  let visible = false
  let rendered = false
  let disposed = false
  let revision = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastGood: { window: MiniWindowSize; metrics: MiniTabLayoutMetrics } | undefined
  let snapshot: MiniTabLayoutSnapshot = { fallbackPageScroll: false }

  function publish(next: MiniTabLayoutSnapshot) {
    if (snapshot.metrics === next.metrics && snapshot.fallbackPageScroll === next.fallbackPageScroll) return
    snapshot = next
    port.publish(next)
  }

  function cancelTimer() {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }

  function isCurrent(token: number) {
    return visible && !disposed && revision === token && port.isCurrentPage()
  }

  function measure(token: number, attempt: number) {
    if (!isCurrent(token)) return
    let settled = false
    const isPending = () => !settled && isCurrent(token)
    const retry = () => {
      if (!isPending()) return
      settled = true
      cancelTimer()
      if (attempt < retryDelays.length) {
        timer = setTimeout(() => measure(token, attempt + 1), retryDelays[attempt])
      } else if (lastGood && sameWindow(lastGood.window, port.readWindow())) {
        publish({ metrics: lastGood.metrics, fallbackPageScroll: false })
      } else {
        publish({ fallbackPageScroll: true })
      }
    }

    // 把平台渲染回调和节点查询都纳入超时，迟到结果不能覆盖重试。
    timer = setTimeout(retry, queryTimeoutMs)
    port.afterRender(() => {
      if (!isPending()) return
      const window = port.readWindow()
      if (!window) { retry(); return }

      // 从横屏返回时给系统几帧提交竖屏尺寸，稳定的宽屏也能在有限次数后使用。
      const previousWindow = lastGood?.window
      if (window.width > window.height && !sameWindow(previousWindow, window) && attempt < retryDelays.length) {
        retry()
        return
      }

      // 竖屏窗口变化后先用上次量到的页头高度，查询成功时再原子替换尺寸。
      if (lastGood && !snapshot.fallbackPageScroll && !sameWindow(previousWindow, window)) {
        const provisional = calculateMiniTabLayout(window.height, lastGood.metrics.headerHeight)
        if (provisional) publish({ metrics: provisional, fallbackPageScroll: false })
      }

      port.readHeader((height) => {
        if (!isPending()) return
        const metrics = height === undefined ? null : calculateMiniTabLayout(window.height, height)
        if (!metrics || !sameWindow(window, port.readWindow())) { retry(); return }
        settled = true
        cancelTimer()
        lastGood = { window, metrics }
        publish({ metrics, fallbackPageScroll: false })
      })
    })
  }

  function refresh() {
    if (!visible || !rendered || disposed) return
    const token = ++revision
    cancelTimer()
    // 同一帧的 show、ready、resize 合并成一次测量。
    timer = setTimeout(() => measure(token, 0), 0)
  }

  function hide() {
    visible = false
    revision += 1
    cancelTimer()
  }

  return {
    show() { visible = true; refresh() },
    ready() { rendered = true; refresh() },
    resize: refresh,
    hide,
    dispose() { disposed = true; hide() },
  }
}
