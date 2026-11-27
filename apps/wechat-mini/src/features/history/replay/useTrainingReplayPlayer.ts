import { nextTick, ref, watch } from 'vue'
import Taro, { useDidHide, useDidShow, useReady, useUnload } from '@tarojs/taro'
import type { TrainingRecord } from '@/shared/core'
import { foreground } from '../../../app/MiniServices'
import { waitForCanvasSurface } from '../../../platform/canvas/WeChatCanvasSurface'
import { createReplayCanvas, supportsReplay } from './ReplayCanvasFactory'
import type { ReplayPosition } from './ReplayReturn'

/** 页面各自持有一个播放器，后台、旋转和卸载都停掉当前 RAF。 */
export function useTrainingReplayPlayer(selector: string, updateLayout?: () => void) {
  const elapsed = ref(0)
  const duration = ref(0)
  const trajectory = ref(false)
  const ready = ref(false)
  const playing = ref(false)
  const error = ref('')
  let record: TrainingRecord | null = null
  let canvas: ReturnType<typeof createReplayCanvas> = null
  let frame: number | null = null
  let revision = 0
  let playback = 0
  let pageVisible = true
  let mounted = false
  let disposed = false
  const active = () => mounted && pageVisible && foreground.value && !disposed

  useReady(() => {
    mounted = true
    Taro.onWindowResize?.(refresh)
    refresh()
  })
  useDidShow(() => { pageVisible = true; refresh() })
  useDidHide(() => { pageVisible = false; detach() })
  useUnload(() => { disposed = true; detach(); Taro.offWindowResize?.(refresh) })
  watch(foreground, (visible) => { if (visible) refresh(); else detach() }, { flush: 'sync' })

  function refresh() {
    if (active()) {
      updateLayout?.()
      void mountCanvas()
    }
  }

  function setRecord(value: TrainingRecord, initial?: ReplayPosition) {
    record = value
    duration.value = Math.max(0, value.replay?.durationMs ?? 0)
    setPosition(initial ?? { elapsed: 0, trajectory: false })
    refresh()
  }

  async function mountCanvas() {
    const current = record
    if (!active() || !current || !supportsReplay(current)) return
    detach()
    error.value = ''
    const request = revision
    const isCurrent = () => active() && revision === request
    try {
      await nextTick()
      const surface = await waitForCanvasSurface(selector, isCurrent, updateLayout ? 'landscape' : undefined)
      if (!surface) return
      canvas = createReplayCanvas(current, surface)
      draw()
      ready.value = canvas !== null
    } catch (failure) {
      if (isCurrent()) fail(failure)
    }
  }

  function detach() {
    revision += 1
    pause()
    canvas = null
    ready.value = false
  }

  function draw() { canvas?.draw(elapsed.value, trajectory.value) }

  function fail(failure: unknown) {
    detach()
    error.value = failure instanceof Error ? failure.message : '回放画布暂时无法显示。'
  }

  function pause() {
    playback += 1
    playing.value = false
    if (frame !== null) canvas?.node.cancelAnimationFrame(frame)
    frame = null
  }

  function togglePlay() {
    if (playing.value) { pause(); return }
    const current = canvas
    if (!active() || !ready.value || !current || !duration.value) return
    if (elapsed.value >= duration.value) elapsed.value = 0
    trajectory.value = false
    playing.value = true
    const run = ++playback
    let last: number | null = null
    const tick = (stamp?: number) => {
      if (run !== playback || !active()) return
      frame = null
      const now = typeof stamp === 'number' && Number.isFinite(stamp) ? stamp : Date.now()
      if (last !== null) elapsed.value = Math.min(duration.value, elapsed.value + Math.min(100, Math.max(0, now - last)))
      last = now
      try {
        draw()
        if (elapsed.value >= duration.value) pause()
        else frame = current.node.requestAnimationFrame(tick)
      } catch (failure) { fail(failure) }
    }
    try { frame = current.node.requestAnimationFrame(tick) }
    catch (failure) { fail(failure) }
  }

  function setPosition(value: ReplayPosition) {
    pause()
    elapsed.value = Number.isFinite(value.elapsed) ? Math.min(duration.value, Math.max(0, value.elapsed)) : 0
    trajectory.value = value.trajectory === true
    try { draw() } catch (failure) { fail(failure) }
  }

  function seek(event: { detail: { value: number } }) {
    setPosition({ elapsed: event.detail.value, trajectory: trajectory.value })
  }

  function switchMode() { setPosition({ elapsed: elapsed.value, trajectory: !trajectory.value }) }
  function getPosition(): ReplayPosition { return { elapsed: Math.round(elapsed.value), trajectory: trajectory.value } }

  return { elapsed, duration, trajectory, ready, playing, error, setRecord, refresh, pause, togglePlay, seek, switchMode, getPosition, setPosition }
}
