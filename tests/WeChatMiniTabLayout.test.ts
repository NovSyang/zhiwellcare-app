import { afterEach, describe, expect, it, vi } from 'vitest'
import { calculateMiniTabLayout } from '../apps/wechat-mini/src/app/MiniTabLayoutMetrics'
import {
  createMiniTabLayoutMeasurement, type MiniTabLayoutSnapshot, type MiniWindowSize,
} from '../apps/wechat-mini/src/app/MiniTabLayoutMeasurement'

describe('微信 Tab 正文高度', () => {
  it.each([
    [650, 70, 580], [650, 70.5, 579], [568, 80, 488],
  ])('使用窗口 %d 和实际页头 %d 直接计算逻辑像素', (window, header, scroll) => {
    expect(calculateMiniTabLayout(window, header)).toEqual({ windowHeight: window, headerHeight: header, scrollHeight: scroll })
  })

  it.each([
    [0, 70], [NaN, 70], [650, 0], [650, 650], [650, 700], [650, Infinity], [650, 649.8],
  ])('拒绝无法形成有效滚动区的尺寸 %s / %s', (window, header) => {
    expect(calculateMiniTabLayout(window, header)).toBeNull()
  })
})

/** 测试中可手动交回微信节点查询结果，模拟快速切页和旋转。 */
function fixture() {
  let size: MiniWindowSize | undefined = { width: 375, height: 650 }
  let current = true
  const callbacks: Array<(height?: number) => void> = []
  const publish = vi.fn<(snapshot: MiniTabLayoutSnapshot) => void>()
  const afterRender = vi.fn((callback: () => void) => callback())
  const readHeader = vi.fn((callback: (height?: number) => void) => { callbacks.push(callback) })
  const layout = createMiniTabLayoutMeasurement({
    isCurrentPage: () => current,
    readWindow: () => size,
    afterRender,
    readHeader,
    publish,
  })
  return {
    layout, readHeader, afterRender, publish, callbacks,
    setSize: (next?: MiniWindowSize) => { size = next },
    switchAway: () => { current = false },
    mount() { layout.show(); layout.ready(); vi.advanceTimersByTime(0) },
  }
}

describe('微信 Tab 布局测量生命周期', () => {
  afterEach(() => vi.useRealTimers())

  it.each(['show', 'ready'] as const)('首次 %s 先发生时均等待另一个生命周期', (first) => {
    vi.useFakeTimers()
    const f = fixture()
    f.layout[first]()
    vi.advanceTimersByTime(0)
    expect(f.readHeader).not.toHaveBeenCalled()
    f.layout[first === 'show' ? 'ready' : 'show']()
    vi.advanceTimersByTime(0)
    f.callbacks[0](70)
    expect(f.publish).toHaveBeenCalledExactlyOnceWith({
      metrics: { windowHeight: 650, headerHeight: 70, scrollHeight: 580 }, fallbackPageScroll: false,
    })
  })

  it('合并同一帧 resize 并丢弃先前查询', () => {
    vi.useFakeTimers()
    const f = fixture()
    f.mount()
    f.layout.resize()
    f.layout.resize()
    f.layout.resize()
    f.callbacks[0](90)
    expect(f.publish).not.toHaveBeenCalled()
    vi.advanceTimersByTime(0)
    expect(f.readHeader).toHaveBeenCalledTimes(2)
    f.callbacks[1](70)
    expect(f.publish).toHaveBeenCalledOnce()
  })

  it.each(['hide', 'dispose', 'stack'] as const)('切页或卸载后忽略迟到的结果和重试（%s）', (mode) => {
    vi.useFakeTimers()
    const f = fixture()
    f.mount()
    if (mode === 'stack') f.switchAway()
    else f.layout[mode]()
    f.callbacks[0](70)
    vi.runAllTimers()
    expect(f.readHeader).toHaveBeenCalledOnce()
    expect(f.publish).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('查询无效时最多重试三次并恢复原生滚动，下次展示可回到实测布局', () => {
    vi.useFakeTimers()
    const f = fixture()
    f.readHeader.mockImplementation((done) => done())
    f.mount()
    vi.runAllTimers()
    expect(f.readHeader).toHaveBeenCalledTimes(4)
    expect(f.publish).toHaveBeenCalledExactlyOnceWith({ fallbackPageScroll: true })
    expect(vi.getTimerCount()).toBe(0)
    f.layout.hide()
    f.readHeader.mockImplementation((done) => done(70))
    f.layout.show()
    vi.runAllTimers()
    expect(f.publish).toHaveBeenLastCalledWith({
      metrics: { windowHeight: 650, headerHeight: 70, scrollHeight: 580 }, fallbackPageScroll: false,
    })
  })

  it('同一窗口曾实测成功时保留可滚动高度，变化后无有效尺寸则降级', () => {
    vi.useFakeTimers()
    const f = fixture()
    f.mount()
    f.callbacks[0](70)
    f.readHeader.mockImplementation((done) => done(900))
    f.layout.resize()
    vi.runAllTimers()
    expect(f.publish).toHaveBeenCalledOnce()
    f.setSize({ width: 320, height: 560 })
    f.layout.resize()
    vi.runAllTimers()
    expect(f.publish).toHaveBeenLastCalledWith({ fallbackPageScroll: true })
  })

  it('渲染或查询超时可恢复，迟到的回调无法覆盖新的高度', () => {
    vi.useFakeTimers()
    const f = fixture()
    let lateRender: (() => void) | undefined
    f.afterRender.mockImplementationOnce((done) => { lateRender = done })
    f.mount()
    vi.advanceTimersByTime(290)
    lateRender?.()
    expect(f.readHeader).toHaveBeenCalledOnce()
    // 第二次请求中的节点回调也不返回，第三次请求正常。
    vi.advanceTimersByTime(350)
    f.callbacks[1](70)
    f.callbacks[0](100)
    expect(f.publish).toHaveBeenCalledExactlyOnceWith({
      metrics: { windowHeight: 650, headerHeight: 70, scrollHeight: 580 }, fallbackPageScroll: false,
    })
  })

  it('横屏返回时重新读取窗口，并丢弃测量过程中已变化的窗口结果', () => {
    vi.useFakeTimers()
    const f = fixture()
    f.setSize({ width: 650, height: 375 })
    f.mount()
    expect(f.readHeader).not.toHaveBeenCalled()
    f.setSize({ width: 375, height: 650 })
    vi.advanceTimersByTime(40)
    f.setSize({ width: 393, height: 700 })
    f.callbacks[0](75)
    expect(f.publish).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    f.callbacks[1](72)
    expect(f.publish).toHaveBeenCalledExactlyOnceWith({
      metrics: { windowHeight: 700, headerHeight: 72, scrollHeight: 628 }, fallbackPageScroll: false,
    })
  })

  it('合法宽屏经过有限等待后仍然具备可用滚动区', () => {
    vi.useFakeTimers()
    const f = fixture()
    f.setSize({ width: 1000, height: 675 })
    f.readHeader.mockImplementation((done) => done(80))
    f.mount()
    vi.runAllTimers()
    expect(f.readHeader).toHaveBeenCalledOnce()
    expect(f.publish).toHaveBeenCalledExactlyOnceWith({
      metrics: { windowHeight: 675, headerHeight: 80, scrollHeight: 595 }, fallbackPageScroll: false,
    })
  })

  it('窗口接口暂不可用时仍有可恢复的自然滚动路径', () => {
    vi.useFakeTimers()
    const f = fixture()
    f.setSize()
    f.mount()
    vi.runAllTimers()
    expect(f.readHeader).not.toHaveBeenCalled()
    expect(f.publish).toHaveBeenLastCalledWith({ fallbackPageScroll: true })
    f.setSize({ width: 375, height: 650 })
    f.readHeader.mockImplementation((done) => done(70))
    f.layout.resize()
    vi.runAllTimers()
    expect(f.publish).toHaveBeenLastCalledWith(expect.objectContaining({ fallbackPageScroll: false }))
  })
})
