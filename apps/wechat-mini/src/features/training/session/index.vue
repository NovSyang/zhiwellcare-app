<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import Taro, { useDidHide, useDidShow, useLoad, useReady, useUnload } from '@tarojs/taro'
import type { GameHudMetric, GameInput, GameResultPresentation, TrainingRecord, TrainingSessionState } from '@/shared/core'
import { TARGET_REACH_GAME_ID } from '@/shared/target-config'
import {
  connectionSnapshot, foreground, getTrainingRepository, motionProfileService, readyForTraining,
  reconnectTrainingDevice, sensorService, sensorSnapshot,
} from '../../../app/MiniServices'
import { isMiniTrainingGameId, miniTrainingGames, type MiniTrainingGameId } from '../../../app/TrainingGames'
import { getTrainingOffers } from '../../../app/TrainingOffers'
import { createTrainingClock } from '../../../platform/TrainingClock'
import { queryCanvasSurface, type CanvasSurface } from '../../../platform/canvas/WeChatCanvasSurface'
import { createTrainingRun } from './createTrainingRun'
import type { TrainingPauseReason } from './MiniTrainingRun'

defineOptions({ name: 'TrainingSessionPage' })

const gameId = ref<MiniTrainingGameId | null>(TARGET_REACH_GAME_ID)
const game = computed(() => gameId.value ? miniTrainingGames[gameId.value] : null)
const state = ref<TrainingSessionState>('idle')
const seconds = ref(0)
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
const result = shallowRef<GameResultPresentation | null>(null)
const connected = computed(() => sensorSnapshot.value?.state === 'connected')
const calibrating = computed(() => {
  const current = sensorSnapshot.value
  return current?.state === 'connected' && sensorService.motion.getCalibrationSnapshot().active
})
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
  unsubscribe = sensorService.onSnapshot(({ gameInput }) => {
    latestInput = gameInput
    if (!training) return
    const sameDevice = originalDeviceId === connectionSnapshot.value.binding?.deviceId
    training.run.receive(sameDevice ? gameInput : { ...gameInput, connected: false, calibrated: false, x: 0, y: 0 })
    syncRun()
  })
  void mountCanvas()
  Taro.onWindowResize?.(resize)
})
useDidShow(() => {
  pageVisible = true
  applyVisibility()
  if (mounted && !finished.value) void mountCanvas()
})
useDidHide(() => { pageVisible = false; applyVisibility() })
useUnload(() => {
  disposed = true
  canvasRevision += 1
  stopLoops()
  training?.run.abort()
  unsubscribe?.()
  Taro.offWindowResize?.(resize)
  Taro.disableAlertBeforeUnload?.()
})
watch(foreground, applyVisibility, { flush: 'sync' })

/** 小程序进后台时立即暂停，停掉绘制和判定，并清掉旧中心。 */
function applyVisibility() {
  const visible = pageVisible && foreground.value
  if (visible === active) return
  active = visible
  training?.run.setForeground(active)
  if (!active && training && !finished.value) sensorService.resetCalibration()
  syncRun()
}

function resize() { if (active && !finished.value) void mountCanvas() }

async function mountCanvas() {
  const revision = ++canvasRevision
  stopPainting()
  surface = null
  drawFrame = null
  canvasReady.value = false
  try {
    const current = await queryCanvasSurface('#training-canvas')
    if (disposed || revision !== canvasRevision || finished.value) return
    const draw = training?.mount(current)
    draw?.()
    surface = current
    drawFrame = draw ?? null
    canvasReady.value = true
    error.value = ''
    syncRun()
  } catch (failure) {
    if (disposed || revision !== canvasRevision) return
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
  seconds.value = Math.floor(frame.session.playingElapsedMs / 1000)
  const nextMetrics = training.metrics()
  if (nextMetrics.length !== metrics.value.length || nextMetrics.some((metric, index) => metric.value !== metrics.value[index]?.value)) {
    metrics.value = nextMetrics
  }
  canResume.value = status.ready
  reason.value = status.reason
  const record = run.getRecord()
  if (record && !finished.value) {
    finished.value = record
    result.value = training.present()
    stopLoops()
    void saveRecord()
    return
  }
  if (active && (state.value === 'playing' || state.value === 'countdown')) {
    // Canvas 刷新与 50Hz 业务定时器各自运行，低帧率不改变判定规则。
    timer ??= setInterval(() => { run.tick(); syncRun() }, 20)
    if (canvasReady.value && animation === null && surface && drawFrame) {
      const { node } = surface
      const draw = drawFrame
      const paint = () => {
        try {
          draw()
          animation = node.requestAnimationFrame(paint)
        } catch (failure) {
          // 画布故障时暂停本局，重新挂载后再由用户继续。
          animation = null
          canvasReady.value = false
          run.pause()
          error.value = errorText(failure, '训练画布绘制失败，请重试。')
          syncRun()
        }
      }
      paint()
    }
  } else {
    stopLoops()
    if (active && canvasReady.value && previousState !== state.value && !finished.value) drawFrame?.()
  }
}

function stopLoops() {
  if (timer !== undefined) clearInterval(timer)
  timer = undefined
  stopPainting()
}

function stopPainting() {
  if (animation !== null) surface?.node.cancelAnimationFrame(animation)
  animation = null
}

async function begin() {
  const binding = connectionSnapshot.value.binding
  const id = gameId.value
  if (busy.value || !active || !surface || !id || !binding || !readyForTraining.value) return
  busy.value = true
  error.value = ''
  try {
    const offers = await getTrainingOffers({ id: binding.deviceId, name: binding.name, address: binding.address })
    if (disposed || !active || !surface) return
    const offer = offers.find(({ game }) => game.gameId === id)
    if (!offer?.device || binding.deviceId !== connectionSnapshot.value.binding?.deviceId || !latestInput) {
      throw new Error('当前设备未匹配此训练，请检查连接。')
    }
    const session = createTrainingRun(id, { clock, profile: motionProfileService.getCurrent(), device: offer.device })
    const draw = session.mount(surface)
    session.run.receive(latestInput)
    session.run.start()
    originalDeviceId = binding.deviceId
    drawFrame = draw
    training = session
    syncRun()
    Taro.enableAlertBeforeUnload?.({ message: '本次训练尚未保存，退出会结束当前训练。' })
  } catch (failure) {
    error.value = errorText(failure, '无法开始训练，请检查设备。')
  } finally { busy.value = false }
}

function pause() { training?.run.pause(); syncRun() }

function resume() {
  error.value = ''
  if (!active || !canvasReady.value) return
  try { training?.run.resume(); syncRun() } catch (failure) {
    error.value = errorText(failure, '暂时无法继续训练。')
  }
}

async function reconnect() {
  if (busy.value || !active) return
  busy.value = true
  error.value = ''
  try { await reconnectTrainingDevice() } catch (failure) {
    error.value = errorText(failure, '重连失败，请检查训练设备。')
  } finally { busy.value = false }
}

async function saveRecord() {
  const record = finished.value
  if (!record || saving.value || saved.value) return
  saving.value = true
  saveError.value = ''
  try {
    await getTrainingRepository().save(record)
    saved.value = true
    if (!disposed) Taro.disableAlertBeforeUnload?.()
  } catch (failure) { saveError.value = errorText(failure, '本次训练保存失败，请重试。') }
  finally { saving.value = false }
}

async function exitTraining() {
  pause()
  if (saving.value) return
  try {
    if (training && !saved.value) {
      const decision = await Taro.showModal({ title: '离开本次训练', content: '离开后，本次未保存的训练将丢失。' })
      if (!decision.confirm) return
    }
    Taro.disableAlertBeforeUnload?.()
    await Taro.navigateBack()
  } catch (failure) { error.value = errorText(failure, '退出训练失败，请重试。') }
}

function openReplay() {
  if (saved.value && finished.value) void Taro.navigateTo({
    url: `/features/history/detail/index?id=${encodeURIComponent(finished.value.id)}`,
  })
}

function errorText(failure: unknown, fallback: string) { return failure instanceof Error ? failure.message : fallback }
</script>

<template>
  <view class="mini-page">
    <view v-if="!game" class="mini-card">
      <text class="mini-description">当前版本没有这项训练。</text>
      <button @tap="exitTraining">返回训练大厅</button>
    </view>
    <template v-else-if="result">
      <text class="mini-heading">训练结果</text>
      <view class="mini-card">
        <text class="mini-card-title">{{ result.title }}</text>
        <text class="mini-description">有效训练 {{ seconds }} 秒</text>
        <text v-for="metric in result.metrics" :key="metric.label" class="mini-description">{{ metric.label }} · {{ metric.value }}</text>
      </view>
      <view v-for="section in result.sections" :key="section.title" class="mini-card">
        <text class="mini-card-title">{{ section.title }}</text>
        <text v-for="item in section.items" :key="item.label" class="mini-description">
          {{ item.label }} · {{ item.value }} {{ item.detail }}
        </text>
      </view>
      <view class="mini-card">
        <text v-if="saving" class="mini-description">正在保存训练与回放…</text>
        <text v-else-if="saved" class="mini-description">已保存到本机训练历史</text>
        <text v-if="saveError" class="mini-error">{{ saveError }}</text>
        <button v-if="saved" class="mini-primary" @tap="openReplay">查看训练回放</button>
        <button v-else-if="!saving" class="mini-primary" @tap="saveRecord">重试保存</button>
        <button :disabled="saving" @tap="exitTraining">返回训练大厅</button>
      </view>
    </template>
    <template v-else>
      <text class="mini-heading">{{ game.name }}</text>
      <view class="training-hud">
        <text v-for="metric in metrics" :key="metric.label">{{ metric.label }} {{ metric.value }}</text>
        <text>有效 {{ seconds }} 秒</text>
      </view>
      <canvas id="training-canvas" type="2d" class="training-canvas" />
      <view class="mini-card">
        <text v-if="error" class="mini-error">{{ error }}</text>
        <text v-if="!connected && connectionSnapshot.message" class="mini-description">{{ connectionSnapshot.message }}</text>
        <button v-if="!canvasReady && error" @tap="mountCanvas">重试画布</button>
        <template v-if="state === 'idle'">
          <text class="mini-description">{{ game.instructions }}</text>
          <button class="mini-primary" :disabled="busy || !canvasReady || !readyForTraining" @tap="begin">开始训练</button>
        </template>
        <button v-else-if="state === 'playing' || state === 'countdown'" @tap="pause">暂停训练</button>
        <template v-else-if="state === 'paused'">
          <text class="mini-description">{{ reason ? pauseText[reason] : '训练已暂停。' }}</text>
          <button class="mini-primary" :disabled="!canvasReady || !canResume" @tap="resume">继续训练</button>
        </template>
        <button v-if="!connected" :disabled="busy" @tap="reconnect">重连已绑定设备</button>
        <button v-else-if="!readyForTraining" :disabled="calibrating || busy" @tap="sensorService.startCalibration()">
          {{ calibrating ? '正在校准，请保持静止' : '校准中心' }}
        </button>
        <button @tap="exitTraining">{{ state === 'idle' ? '返回训练大厅' : '结束并离开' }}</button>
      </view>
    </template>
  </view>
</template>

<style>
/* 独立显示 HUD 和画布，目标区域在窄屏仍保留一致比例。 */
.training-hud {
  display: flex;
  justify-content: space-between;
  font-size: 26px;
  font-weight: 600;
  margin-bottom: 16px;
}

.training-canvas {
  display: block;
  width: 100%;
  height: 530px;
  background: var(--canvas-bg);
  outline: 1px solid var(--canvas-border);
  border-radius: 20px;
  margin-bottom: 22px;
}
</style>
