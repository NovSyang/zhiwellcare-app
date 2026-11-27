<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import Taro, { useDidHide, useDidShow, useLoad, useReady, useUnload } from '@tarojs/taro'
import type { GameHudMetric, GameInput, TrainingRecord, TrainingSessionState } from '@/shared/core'
import { TARGET_REACH_GAME_ID } from '@/shared/target-config'
import {
  cancelTrainingCalibration, connectionSnapshot, deviceBusy, deviceState, foreground, getTrainingRepository,
  interactionsBlocked, invalidateTrainingCalibration, motionProfileService, readyForTraining,
  reconnectTrainingDevice, sensorService, sensorSnapshot, startTrainingCalibration,
} from '../../../app/MiniServices'
import { navigateMini, useMiniPageLock, withMiniOperationLock } from '../../../app/MiniPageSafety'
import MiniCompactDeviceStatus from '../../../components/app/MiniCompactDeviceStatus.vue'
import { isMiniTrainingGameId, miniTrainingGames, type MiniTrainingGameId } from '../../../app/TrainingGames'
import { getTrainingOffers } from '../../../app/TrainingOffers'
import { createTrainingClock } from '../../../platform/TrainingClock'
import { waitForCanvasSurface, type CanvasSurface } from '../../../platform/canvas/WeChatCanvasSurface'
import { readImmersiveGeometry, setTrainingScreenOn } from '../../../platform/ImmersiveLayout'
import { formatDuration } from '../../../utils/DateTimeFormatter'
import { createTrainingRun, type TrainingCanvasOptions } from './createTrainingRun'
import type { TrainingPauseReason } from './MiniTrainingRun'
import type { RuntimeTrajectoryMode } from './RuntimeTrajectory'

defineOptions({ name: 'TrainingSessionPage' })

const gameId = ref<MiniTrainingGameId | null>(TARGET_REACH_GAME_ID)
const game = computed(() => gameId.value ? miniTrainingGames[gameId.value] : null)
const state = ref<TrainingSessionState>('idle')
const elapsed = ref(0)
const layout = shallowRef(readTrainingLayout())
const metrics = shallowRef<GameHudMetric[]>([])
const canResume = ref(false)
const reason = ref<TrainingPauseReason | null>(null)
const canvasReady = ref(false)
const busy = ref(false)
const saving = ref(false)
const saved = ref(false)
const error = ref('')
const saveError = ref('')
const finished = shallowRef<TrainingRecord | null>(null)
const openingResult = ref(false)
const resultError = ref('')
const trajectoryMode = ref<RuntimeTrajectoryMode>('tail')
const trajectoryLabel = computed(() => trajectoryMode.value === 'tail' ? '动态尾迹' : '完整轨迹')
const trajectoryAction = computed(() => trajectoryMode.value === 'tail' ? '动态尾迹，点击切换完整轨迹' : '完整轨迹，点击切换动态尾迹')
const connected = computed(() => sensorSnapshot.value?.state === 'connected')
const calibrating = computed(() => deviceState.value.calibrating)
const pauseText: Record<TrainingPauseReason, string> = {
  manual: '可在准备好后继续训练。',
  background: '回到前台后请确认连接，并重新校准中心。',
  disconnect: '设备已断开，请重连并重新校准中心。',
  calibration: '请完成中心校准后继续。',
  signal: '姿态数据暂时中断，请等待设备恢复发送。',
}

const clock = createTrainingClock()
let training: ReturnType<typeof createTrainingRun> | null = null
let surface: CanvasSurface | null = null
let drawFrame: (() => void) | null = null
let animation: number | null = null
let paintRevision = 0
let timer: ReturnType<typeof setInterval> | undefined
let latestInput: GameInput | null = null
let originalDeviceId: string | null = null
let pageVisible = true
let active = foreground.value
let mounted = false
let disposed = false
let canvasRevision = 0
let unsubscribe: (() => void) | undefined

// 保留旧入口默认训练，同时拒绝没有接入微信画布的游戏 ID。
useLoad(({ game }) => { if (game) gameId.value = isMiniTrainingGameId(game) ? game : null })
useReady(() => {
  if (!game.value) return
  mounted = true
  subscribeToPageInput()
  void mountCanvas()
})
useDidShow(() => {
  pageVisible = true
  applyVisibility()
})
useDidHide(() => { pageVisible = false; applyVisibility() })
useUnload(() => {
  disposed = true
  canvasRevision += 1
  stopLoops()
  training?.run.abort()
  unsubscribeFromPageInput()
  Taro.disableAlertBeforeUnload?.()
})
// 先停止判定和绘制，再等待常亮关闭，最后允许更新。
useMiniPageLock('横屏训练', () => setTrainingScreenOn(false))
watch(foreground, applyVisibility, { flush: 'sync' })

/** 保持唯一的页面姿态订阅，退后台时连同窗口事件一起解绑。 */
function subscribeToPageInput() {
  if (unsubscribe || !active || !mounted || disposed) return
  unsubscribe = sensorService.onSnapshot(({ gameInput }) => {
    latestInput = gameInput
    if (!training) return
    const sameDevice = originalDeviceId === connectionSnapshot.value.binding?.deviceId
    training.run.receive(sameDevice ? gameInput : { ...gameInput, connected: false, calibrated: false, x: 0, y: 0 })
    syncRun()
  })
  Taro.onWindowResize?.(resize)
}

function unsubscribeFromPageInput() {
  if (!unsubscribe) return
  unsubscribe()
  unsubscribe = undefined
  Taro.offWindowResize?.(resize)
}

/** 小程序进后台时立即暂停，停掉绘制和判定，并清掉旧中心。 */
function applyVisibility() {
  const visible = pageVisible && foreground.value
  if (visible === active) return
  active = visible
  training?.run.setForeground(active)
  if (!active) {
    canvasRevision += 1
    stopLoops()
    unsubscribeFromPageInput()
    if (training && !finished.value) invalidateTrainingCalibration()
    void setTrainingScreenOn(false)
  } else {
    subscribeToPageInput()
    if (training && !finished.value) void setTrainingScreenOn(true)
    if (mounted && !finished.value) resize()
    if (saved.value && !resultError.value) void openResult()
  }
  syncRun()
}

/** 优先在胶囊左侧对齐按钮，横向空间不足时才把整条工具栏下移。 */
function readTrainingLayout() {
  const { windowWidth, left, right, safeTop, capsule, insets } = readImmersiveGeometry()
  let availableWidth = windowWidth - left - right
  let toolbar = {}
  if (capsule && Number.isFinite(capsule.top) && capsule.top >= 0 && capsule.top < capsule.bottom && capsule.left < capsule.right) {
    const buttonHeight = 32
    const actionsWidth = 204 // 88 + 52 + 52，再加两处 6px 间距。
    const capsuleRightInset = Math.max(right, windowWidth - capsule.left + 8)
    const roomBeforeCapsule = windowWidth - left - capsuleRightInset
    if (roomBeforeCapsule >= actionsWidth) {
      const top = Math.max(safeTop + 4, (capsule.top + capsule.bottom - buttonHeight) / 2)
      const stackStatus = roomBeforeCapsule < 440
      availableWidth = roomBeforeCapsule
      toolbar = {
        '--training-hud-top': `${top}px`,
        '--training-hud-right': `${stackStatus ? right : capsuleRightInset}px`,
        '--training-hud-actions-inset': `${stackStatus ? capsuleRightInset - right : 0}px`,
        '--training-hud-row-gap': `${Math.max(4, capsule.bottom - top - buttonHeight + 4)}px`,
      }
    }
  }
  const density = availableWidth >= 650 ? 'regular' : availableWidth >= 500 ? 'compact'
    : availableWidth >= 440 ? 'narrow' : 'stacked'
  return { insets, density, toolbar }
}

function resize() {
  if (active && !finished.value) void mountCanvas()
  else layout.value = readTrainingLayout()
}

function canvasOptions(): TrainingCanvasOptions {
  return {
    trajectoryMode: () => trajectoryMode.value,
    safeLeft: Number.parseFloat(layout.value.insets['--safe-left']),
    safeBottom: Number.parseFloat(layout.value.insets['--safe-bottom']),
  }
}

async function mountCanvas() {
  if (!active || disposed) return
  const revision = ++canvasRevision
  const isCurrent = () => active && !disposed && revision === canvasRevision && !finished.value
  layout.value = readTrainingLayout()
  stopPainting()
  surface = null
  drawFrame = null
  canvasReady.value = false
  try {
    // 旋转后重读节点宽高，只重建绘制闭包，保留当前训练实例。
    await nextTick()
    const current = await waitForCanvasSurface('#training-canvas', isCurrent, 'landscape')
    if (!current) return
    // 横屏画布就绪后，用当前窗口的胶囊位置覆盖旋转过渡期间的读数。
    layout.value = readTrainingLayout()
    const draw = training?.mount(current, canvasOptions())
    draw?.()
    surface = current
    drawFrame = draw ?? null
    canvasReady.value = true
    error.value = ''
    syncRun()
  } catch (failure) {
    if (!isCurrent()) return
    training?.run.pause()
    syncRun()
    error.value = errorText(failure, '训练画布初始化失败，请重试。')
  }
}

function syncRun() {
  if (!training || disposed) return
  const { run } = training
  const frame = run.getFrame()
  const status = run.getStatus()
  const previousState = state.value
  state.value = frame.session.state
  elapsed.value = Math.floor(frame.session.playingElapsedMs / 1000) * 1000
  const nextMetrics = training.metrics()
  if (nextMetrics.length !== metrics.value.length || nextMetrics.some((metric, index) => metric.value !== metrics.value[index]?.value)) {
    metrics.value = nextMetrics
  }
  canResume.value = status.ready
  reason.value = status.reason
  const record = run.getRecord()
  if (record && !finished.value) {
    finished.value = record
    stopLoops()
    void setTrainingScreenOn(false)
    void saveRecord()
    return
  }
  if (active && (state.value === 'playing' || state.value === 'countdown')) {
    // Canvas 刷新与 50Hz 业务定时器各自运行，低帧率不改变判定规则。
    timer ??= setInterval(() => { run.tick(); syncRun() }, 20)
    schedulePainting()
  } else if (previousState !== state.value) {
    stopLoops()
    schedulePainting()
  }
}

/** 即使由设备回调触发状态切换，实际绘制也只在 Canvas 帧内执行。 */
function schedulePainting() {
  if (!active || !canvasReady.value || animation !== null || !surface || !drawFrame || finished.value) return
  const { node } = surface
  const draw = drawFrame
  const revision = paintRevision
  animation = node.requestAnimationFrame(() => {
    // 已取消的旧帧即使迟到，也不能清除新画布的帧句柄。
    if (revision !== paintRevision) return
    animation = null
    if (!active || disposed || finished.value || drawFrame !== draw) return
    try {
      draw()
      if (state.value === 'playing' || state.value === 'countdown') schedulePainting()
    } catch (failure) {
      // 主体画布故障时仍保留原有暂停与重试入口。
      canvasReady.value = false
      training?.run.pause()
      error.value = errorText(failure, '训练画布绘制失败，请重试。')
      syncRun()
    }
  })
}

function toggleTrajectory() {
  trajectoryMode.value = trajectoryMode.value === 'tail' ? 'full' : 'tail'
  // 暂停页可切换显示，但只补画一帧，业务时钟和录制保持冻结。
  schedulePainting()
}

function stopLoops() {
  if (timer !== undefined) clearInterval(timer)
  timer = undefined
  stopPainting()
}

function stopPainting() {
  paintRevision += 1
  if (animation !== null) surface?.node.cancelAnimationFrame(animation)
  animation = null
}

async function begin() {
  const binding = connectionSnapshot.value.binding
  const id = gameId.value
  if (busy.value || !active || !surface || !id || !binding || !readyForTraining.value || deviceBusy.value || interactionsBlocked.value) return
  busy.value = true
  error.value = ''
  try {
    const offers = await getTrainingOffers({ id: binding.deviceId, name: binding.name, address: binding.address })
    if (disposed || !active || !surface || !readyForTraining.value || deviceBusy.value || interactionsBlocked.value) return
    const offer = offers.find(({ game }) => game.gameId === id)
    if (!offer?.device || binding.deviceId !== connectionSnapshot.value.binding?.deviceId || !latestInput) {
      throw new Error('当前设备未匹配此训练，请检查连接。')
    }
    const session = createTrainingRun(id, { clock, profile: motionProfileService.getCurrent(), device: offer.device })
    const draw = session.mount(surface, canvasOptions())
    session.run.receive(latestInput)
    session.run.start()
    originalDeviceId = binding.deviceId
    drawFrame = draw
    training = session
    void setTrainingScreenOn(true)
    syncRun()
    Taro.enableAlertBeforeUnload?.({ message: '本次训练尚未保存，退出会结束当前训练。' })
  } catch (failure) {
    error.value = errorText(failure, '无法开始训练，请检查设备。')
  } finally { busy.value = false }
}

function pause() { training?.run.pause(); syncRun() }

function resume() {
  error.value = ''
  if (!active || !canvasReady.value || !canResume.value || deviceBusy.value || interactionsBlocked.value) return
  try { training?.run.resume(); syncRun() } catch (failure) {
    error.value = errorText(failure, '暂时无法继续训练。')
  }
}

async function reconnect() {
  if (busy.value || !active || deviceBusy.value || interactionsBlocked.value) return
  busy.value = true
  error.value = ''
  try { await reconnectTrainingDevice(originalDeviceId ?? undefined) } catch (failure) {
    error.value = errorText(failure, '重连失败，请检查训练设备。')
  } finally { busy.value = false }
}

// 恢复同一台设备后重新校准，训练仍由用户手动继续。
function calibrate() {
  error.value = ''
  try { startTrainingCalibration() } catch (failure) {
    error.value = errorText(failure, '无法开始中心校准，请重试。')
  }
}

async function saveRecord() {
  const record = finished.value
  if (!record || saving.value || saved.value) return
  saving.value = true
  saveError.value = ''
  try {
    await withMiniOperationLock('保存训练及回放', () => getTrainingRepository().save(record))
    saved.value = true
  } catch (failure) { saveError.value = errorText(failure, '本次训练保存失败，请重试。') }
  finally { saving.value = false }
  if (saved.value) await openResult()
}

async function exitTraining() {
  pause()
  if (saving.value || openingResult.value) return
  try {
    if (training && !saved.value) {
      const decision = await Taro.showModal({ title: '离开本次训练', content: '离开后，本次未保存的训练将丢失。' })
      if (!decision.confirm) return
    }
    await clearExitAlert()
    if (Taro.getCurrentPages().length > 1) await navigateMini(() => Taro.navigateBack())
    else await navigateMini(() => Taro.switchTab({ url: '/pages/training/index' }))
  } catch (failure) {
    if (training && !saved.value) Taro.enableAlertBeforeUnload?.({ message: '本次训练尚未保存，退出会结束当前训练。' })
    error.value = errorText(failure, '退出训练失败，请重试。')
  }
}

/** 保存与跳转各自重试，跳转失败时同一条记录已经留在本机。 */
async function openResult() {
  const record = finished.value
  if (!record || !saved.value || !active || disposed || openingResult.value) return
  openingResult.value = true
  resultError.value = ''
  try {
    await setTrainingScreenOn(false)
    if (!active || disposed) return
    await clearExitAlert()
    if (!active || disposed) return
    await navigateMini(() => Taro.redirectTo({ url: `/features/training/result/index?id=${encodeURIComponent(record.id)}` }))
  } catch {
    if (!disposed) resultError.value = '训练已保存，暂时无法打开结果页。'
  } finally { openingResult.value = false }
}

/** 等待平台撤销退出提示，保存后的主动跳转不会抢在撤销操作前。 */
async function clearExitAlert() {
  try { await Taro.disableAlertBeforeUnload?.() }
  catch { globalThis.console?.warn('微信退出提示暂不可用。') }
}

function errorText(failure: unknown, fallback: string) { return failure instanceof Error ? failure.message : fallback }
</script>

<template>
  <view class="immersive-shell" :style="layout.insets">
    <canvas v-if="game" id="training-canvas" type="2d" class="immersive-canvas" />
    <!-- 训练数据和操作悬浮在画布上，横屏后画布使用整个窗口。 -->
    <view v-if="game && !finished && (state === 'playing' || state === 'countdown')"
      class="immersive-toolbar training-toolbar" :class="'training-toolbar--' + layout.density" :style="layout.toolbar">
      <view class="immersive-row training-hud-status">
        <view class="training-hud-primary">
          <text class="immersive-chip">有效 {{ formatDuration(elapsed) }}</text>
          <MiniCompactDeviceStatus />
        </view>
        <view v-if="metrics.length" class="training-hud-metrics">
          <text v-for="metric in metrics" :key="metric.label" class="immersive-chip">{{ metric.label }} {{ metric.value }}</text>
        </view>
      </view>
      <view class="immersive-row training-hud-actions">
        <button v-if="state === 'playing'" class="training-action training-action--trajectory"
          :class="{ 'training-action--selected': trajectoryMode === 'full' }" :aria-label="trajectoryAction"
          @tap="toggleTrajectory"><text class="training-action-label">{{ trajectoryLabel }}</text></button>
        <button class="training-action" @tap="pause"><text class="training-action-label">暂停</text></button>
        <button class="training-action" @tap="exitTraining"><text class="training-action-label">结束</text></button>
      </view>
    </view>
    <view v-else class="immersive-overlay">
      <view class="immersive-panel">
        <template v-if="finished">
          <text class="immersive-title">训练已完成</text>
          <text v-if="saving" class="immersive-note">正在保存训练与回放…</text>
          <text v-else-if="saved" class="immersive-note">已保存到本机训练历史</text>
          <text v-if="saveError || resultError" class="immersive-note immersive-error">{{ saveError || resultError }}</text>
          <view class="immersive-row">
            <button v-if="saved" size="mini" class="immersive-button immersive-primary" :disabled="openingResult" @tap="openResult">查看训练结果</button>
            <button v-else-if="!saving" size="mini" class="immersive-button immersive-primary" @tap="saveRecord">重试保存</button>
            <button size="mini" class="immersive-button" :disabled="saving || openingResult" @tap="exitTraining">返回训练大厅</button>
          </view>
        </template>
        <template v-else>
          <text class="immersive-title">{{ game?.name ?? '训练不可用' }}</text>
          <text v-if="!game" class="immersive-note">当前版本没有这项训练。</text>
          <template v-else>
            <text v-if="state === 'idle'" class="immersive-note">{{ game.instructions }}</text>
            <text v-else-if="state === 'paused'" class="immersive-note">{{ reason ? pauseText[reason] : '训练已暂停。' }}</text>
            <view class="immersive-row"><MiniCompactDeviceStatus /></view>
            <text v-if="!readyForTraining && connectionSnapshot.message" class="immersive-note">{{ connectionSnapshot.message }}</text>
          </template>
          <text v-if="error" class="immersive-note immersive-error">{{ error }}</text>
          <view class="immersive-row">
            <template v-if="game">
              <button v-if="state === 'idle'" size="mini" class="immersive-button immersive-primary" :disabled="busy || !canvasReady || !readyForTraining || deviceBusy || interactionsBlocked" @tap="begin">开始训练</button>
              <button v-else-if="state === 'paused'" size="mini" class="immersive-button immersive-primary" :disabled="!canvasReady || !canResume || deviceBusy || interactionsBlocked" @tap="resume">继续训练</button>
              <button v-if="state === 'paused'" class="training-action training-action--trajectory"
                :class="{ 'training-action--selected': trajectoryMode === 'full' }" :disabled="!canvasReady"
                :aria-label="trajectoryAction" @tap="toggleTrajectory"><text class="training-action-label">{{ trajectoryLabel }}</text></button>
              <button v-if="!canvasReady && error" size="mini" class="immersive-button" @tap="mountCanvas">重试画布</button>
              <button v-if="!connected && connectionSnapshot.binding" size="mini" class="immersive-button" :disabled="busy || deviceBusy || interactionsBlocked" @tap="reconnect">重连设备</button>
              <button v-else-if="connected && !readyForTraining" size="mini" class="immersive-button" :disabled="deviceBusy || busy || interactionsBlocked" @tap="calibrate">
                {{ calibrating ? '正在校准' : '校准中心' }}
              </button>
              <button v-if="calibrating" size="mini" class="immersive-button" :disabled="interactionsBlocked" @tap="cancelTrainingCalibration">取消校准</button>
            </template>
            <button size="mini" class="immersive-button" @tap="exitTraining">{{ state === 'idle' ? '返回训练大厅' : '结束并离开' }}</button>
          </view>
        </template>
      </view>
    </view>
  </view>
</template>

<style>
/* 操作组优先占据顶部右侧，只有状态和指标可以分行。 */
.immersive-toolbar.training-toolbar {
  top: var(--training-hud-top, var(--safe-top, 12px));
  right: var(--training-hud-right, var(--safe-right, 12px));
  flex-wrap: nowrap;
  align-items: flex-start;
  gap: 6PX;
}
.training-toolbar .training-hud-status {
  flex: 1 1 0;
  min-width: 0;
  min-height: 32PX;
  gap: 4PX;
}
.training-toolbar .training-hud-primary,
.training-toolbar .training-hud-metrics {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  max-width: 100%;
  gap: 4PX;
}
.training-toolbar .training-hud-primary { min-height: 32PX; }
.training-toolbar .immersive-chip {
  flex: 0 0 auto;
  padding: 5PX 7PX;
  font-size: 13PX;
  white-space: nowrap;
}
.training-toolbar .training-hud-actions {
  flex: 0 0 auto;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: flex-end;
  gap: 6PX;
}

/* 窄屏降低状态区密度，时间、连接、电量及训练指标仍可完整显示。 */
.training-toolbar--compact .immersive-chip,
.training-toolbar--narrow .immersive-chip,
.training-toolbar--stacked .immersive-chip {
  padding: 4PX 6PX;
  font-size: 12PX;
}
.training-toolbar--narrow .training-hud-metrics { flex-basis: 100%; }
.immersive-toolbar.training-toolbar--stacked { flex-direction: column; gap: var(--training-hud-row-gap, 4px); }
.training-toolbar--stacked .training-hud-actions {
  order: -1;
  align-self: flex-end;
  margin-right: var(--training-hud-actions-inset, 0px);
}
.training-toolbar--stacked .training-hud-status { flex: 0 1 auto; width: 100%; min-height: 0; }
.training-toolbar--stacked .training-hud-primary { min-height: 0; }

/* 三个操作使用独立尺寸，避开原生 mini 按钮的默认行高和内边距。 */
.immersive-shell button.training-action {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 52PX;
  height: 32PX;
  min-height: 32PX;
  margin: 0;
  padding: 0;
  border: 1PX solid #6983ac;
  border-radius: 8PX;
  background: rgba(8, 22, 48, 0.90);
  color: #fff;
  font-size: 13PX;
  line-height: 1;
  text-align: center;
  white-space: nowrap;
  pointer-events: auto;
}
.immersive-shell button.training-action::after { border: 0; }
.immersive-shell button.training-action--trajectory { width: 88PX; }
.immersive-shell button.training-action--selected { background: #1647b2; border-color: #6e98ee; }
.training-action-label { display: block; line-height: 1; text-align: center; }
</style>
