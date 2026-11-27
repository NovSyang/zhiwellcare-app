<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import Taro, { useDidHide, useDidShow, useUnload } from '@tarojs/taro'
import { profileFromMeasuredRange, ROM_DIRECTION_ORDER, type MotionProfile } from '@/shared/core'
import {
  cancelTrainingCalibration, connectionSnapshot, deviceBusy, foreground, initializeMiniServices,
  interactionsBlocked, invalidateTrainingCalibration, motionProfileService, reconnectTrainingDevice,
  sensorService, sensorSnapshot, startTrainingCalibration,
} from '../../../app/MiniServices'
import { navigateMini, useMiniPageLock, withMiniOperationLock } from '../../../app/MiniPageSafety'
import MiniRangeValues from '../../../components/calibration/MiniRangeValues.vue'
import { MiniRangeSession } from './MiniRangeSession'
import { rangeDirections } from '../../../components/calibration/RangeDirections'

defineOptions({ name: 'ActivityRangePage' })

const profile = shallowRef<MotionProfile>()
const loading = ref(true)
const saving = ref(false)
const saved = ref(false)
const leaving = ref(false)
const reconnecting = ref(false)
const error = ref('')
const bindingId = computed(() => connectionSnapshot.value.binding?.deviceId ?? null)
const connected = computed(() => foreground.value && sensorSnapshot.value?.state === 'connected' && sensorSnapshot.value.gameInput.connected)
const calibrated = computed(() => sensorSnapshot.value?.gameInput.calibrated === true)
let pageVisible = false
let unloaded = false

const session = new MiniRangeSession({
  getDevice: () => ({ id: bindingId.value, connected: connected.value, calibrated: calibrated.value, busy: deviceBusy.value }),
  startCenter: startTrainingCalibration,
  cancelCenter: cancelTrainingCalibration,
  invalidateCenter: invalidateTrainingCalibration,
  // 界面只用低频状态，测量阶段直接消费真实传感器帧。
  subscribeSamples: (receive) => sensorService.onSnapshot(({ state, frame, gameInput }) => {
    if (state !== 'connected' || !frame || !gameInput.connected || !gameInput.calibrated) return
    receive(frame.timestamp, sensorService.motion.getRelativeMotion(frame))
  }),
  publish: () => { snapshot.value = session.getSnapshot() },
})
const snapshot = shallowRef(session.getSnapshot())
const flow = computed(() => snapshot.value.flow)
const current = computed(() => rangeDirections[flow.value.currentDirection])
const result = computed(() => flow.value.calibration.result)
const summary = computed(() => flow.value.summary && profile.value ? profileFromMeasuredRange(flow.value.summary, profile.value) : null)
const progress = computed(() => Math.min(100, Math.round(flow.value.calibration.elapsedMs / flow.value.measurementDurationMs * 100)))
const centerProgress = computed(() => Math.round(100 * sensorService.motion.getCalibrationSnapshot(sensorSnapshot.value?.frame?.timestamp).progress))
const blocked = computed(() => interactionsBlocked.value || saving.value || leaving.value || reconnecting.value)

async function loadProfile() {
  loading.value = true
  error.value = ''
  try {
    await initializeMiniServices()
    if (!unloaded) profile.value = motionProfileService.getCurrent()
  } catch (failure) { if (!unloaded) error.value = message(failure, '读取个人活动范围失败。') }
  finally { if (!unloaded) loading.value = false }
}

function syncVisibility() { session.setVisible(pageVisible && foreground.value) }
function stopCurrentAttempt() { pageVisible = false; syncVisibility() }
useDidShow(() => {
  pageVisible = true
  syncVisibility()
  if (!profile.value) void loadProfile()
})
useDidHide(stopCurrentAttempt)
useUnload(() => { unloaded = true; stopCurrentAttempt() })
useMiniPageLock('个人活动范围')
watch(foreground, syncVisibility, { flush: 'sync' })
watch([bindingId, connected, calibrated], () => session.observeDevice(), { flush: 'sync' })

async function returnToSettings() {
  const pages = Taro.getCurrentPages()
  const previous = pages[pages.length - 2]?.route?.replace(/^\//, '')
  const settings = 'features/profile/settings/index'
  await navigateMini(() => previous === settings ? Taro.navigateBack() : Taro.redirectTo({ url: `/${settings}` }))
}

async function recoverDevice() {
  if (blocked.value || deviceBusy.value) return
  reconnecting.value = true
  error.value = ''
  try {
    if (bindingId.value) await reconnectTrainingDevice(bindingId.value)
    else await navigateMini(() => Taro.switchTab({ url: '/pages/device/index' }))
  } catch (failure) { error.value = message(failure, '无法连接训练设备，请重试。') }
  finally { reconnecting.value = false }
}

function confirmCenter() {
  if (blocked.value || !profile.value) return
  error.value = ''
  session.startCenter()
}

async function save() {
  if (blocked.value || !profile.value || !pageVisible) return
  const range = session.getCompletedRange()
  if (!saved.value && !range) return
  saving.value = true
  error.value = ''
  try {
    if (range && !saved.value) {
      // 先落盘、后应用。失败时保留共享流程的汇总，允许重试同一结果。
      const next = profileFromMeasuredRange(range, profile.value)
      await withMiniOperationLock('保存个人活动范围', () => motionProfileService.save(next))
      saved.value = true
      session.cancel()
    }
    if (!unloaded && pageVisible && foreground.value) await returnToSettings()
  } catch (failure) {
    if (!unloaded) error.value = saved.value ? '范围已保存，暂时无法返回训练设置。' : message(failure, '保存失败，请重试。')
  } finally { saving.value = false }
}

async function cancel() {
  if (blocked.value || !pageVisible) return
  leaving.value = true
  error.value = ''
  try {
    await withMiniOperationLock('退出活动范围测量', async () => {
      const answer = await Taro.showModal({
        title: '取消本轮测量', content: '本轮尚未保存的测量结果将丢弃，原有个人活动范围会保留。',
        confirmText: '退出测量', cancelText: '继续测量',
      })
      if (!answer.confirm || unloaded || !pageVisible || !foreground.value) return
      session.cancel()
      await returnToSettings()
    })
  } catch { error.value = '暂时无法返回训练设置，请重试。' }
  finally { leaving.value = false }
}

function message(failure: unknown, fallback: string) {
  return failure instanceof Error ? failure.message : fallback
}
</script>

<template>
  <view class="mini-page">
    <view v-if="saved" class="mini-card">
      <text class="mini-card-title">个人活动范围已保存</text>
      <button class="mini-primary" :disabled="blocked" @tap="save">返回训练设置</button>
    </view>
    <view v-else-if="loading || !profile" class="mini-card">
      <text v-if="loading" class="mini-description">正在读取个人活动范围…</text>
      <button v-else @tap="loadProfile">重新读取</button>
    </view>
    <template v-else>
      <view class="mini-rom-steps" aria-label="四方向测量顺序">
        <view v-for="(direction, index) in ROM_DIRECTION_ORDER" :key="direction" class="mini-rom-step"
          :class="{ 'mini-rom-step-done': flow.phase === 'summary' || index < flow.currentDirectionIndex,
            'mini-rom-step-current': flow.phase !== 'summary' && index === flow.currentDirectionIndex }">
          <text class="mini-rom-step-mark">{{ flow.phase === 'summary' || index < flow.currentDirectionIndex ? '✓' : rangeDirections[direction].arrow }}</text>
          <text>{{ rangeDirections[direction].label }}</text>
        </view>
      </view>
      <view v-if="snapshot.center !== 'confirmed'" class="mini-card">
        <text class="mini-card-title">确认自然中心位置</text>
        <text class="mini-description">将手部自然放置，调整到舒适的中心位置。开始后请保持不动约 1 秒。</text>
        <template v-if="!connected || !bindingId">
          <text class="mini-description">连接训练设备后即可确认自然中心位置。</text>
          <button class="mini-primary" :disabled="blocked || deviceBusy" @tap="recoverDevice">
            {{ reconnecting ? '正在连接…' : bindingId ? '重新连接训练设备' : '前往设备管理' }}
          </button>
        </template>
        <template v-else-if="snapshot.center === 'confirming'">
          <text class="mini-description">正在确认，请保持当前位置 · {{ centerProgress }}%</text>
          <view class="mini-rom-progress"><view class="mini-rom-progress-fill" :style="{ width: centerProgress + '%' }" /></view>
        </template>
        <button v-else class="mini-primary" :disabled="blocked || deviceBusy" @tap="confirmCenter">
          {{ snapshot.error ? '重新确认' : '开始确认' }}
        </button>
      </view>
      <view v-else-if="flow.phase === 'summary' && summary" class="mini-card">
        <text class="mini-card-title">四方向测量汇总</text>
        <text class="mini-description">实测范围</text>
        <MiniRangeValues :range="summary.measuredRange" />
        <text class="mini-description">新训练范围 · 训练比例 {{ Math.round(summary.trainingRatio * 1000) / 10 }}%</text>
        <MiniRangeValues :range="summary.activeRange" />
        <button class="mini-primary" :disabled="blocked" @tap="save">{{ saving ? '正在保存…' : '完成并保存' }}</button>
      </view>
      <view v-else class="mini-card mini-rom-panel">
        <text class="mini-description">第 {{ flow.currentDirectionIndex + 1 }} / {{ flow.totalDirections }} 项</text>
        <text class="mini-rom-arrow" :class="{ 'mini-rom-arrow-active': flow.phase === 'measuring' }">{{ current.arrow }}</text>
        <text class="mini-card-title">向{{ current.label }}</text>
        <template v-if="flow.phase === 'guide'">
          <text class="mini-description">{{ current.guide }}</text>
          <text class="mini-description">请保持设备连接。动作要平稳，避免用力超过舒适范围，感觉不适时立即停止。</text>
          <button class="mini-primary" :disabled="blocked || deviceBusy" @tap="session.begin()">我准备好了</button>
        </template>
        <template v-else-if="flow.phase === 'countdown'">
          <text class="mini-rom-number">{{ flow.countdown }}</text>
          <text class="mini-description">请回到自然中心，倒计时结束后再开始移动。</text>
        </template>
        <template v-else-if="flow.phase === 'measuring'">
          <text class="mini-description">正在测量 · {{ progress }}%</text>
          <view class="mini-rom-progress"><view class="mini-rom-progress-fill" :style="{ width: progress + '%' }" /></view>
          <text class="mini-description">缓慢移动到舒适位置并保持，直到测量结束。</text>
        </template>
        <template v-else-if="flow.phase === 'review' && result">
          <template v-if="result.valid">
            <text class="mini-rom-number">{{ result.measuredRom.toFixed(1) }}°</text>
            <text class="mini-description">测量有效</text>
            <button class="mini-primary" :disabled="blocked" @tap="session.accept()">使用本次结果</button>
          </template>
          <text v-else class="mini-error">{{ result.message }}</text>
          <button :disabled="blocked" @tap="session.retry()">重新测量</button>
        </template>
      </view>
    </template>
    <text v-if="error || snapshot.error" class="mini-error">{{ error || snapshot.error }}</text>
    <button v-if="!saved" :disabled="blocked" @tap="cancel">取消测量</button>
  </view>
</template>

<style>
/* 四格等宽，视觉状态同时使用勾选符号、方向及底色。 */
.mini-rom-steps { display: flex; gap: 12px; margin-bottom: 24px; }
.mini-rom-step {
  flex: 1 1 0;
  min-width: 0;
  padding: 14px 6px;
  border-radius: 18px;
  background: var(--c-bg-3);
  color: var(--c-ink-2);
  text-align: center;
  font-size: 26px;
}
.mini-rom-step-mark { display: block; font-size: 34px; font-weight: 700; }
.mini-rom-step-current { background: var(--c-primary); color: #fff; }
.mini-rom-step-done { background: #e6f6ed; color: #19694a; }
.mini-rom-panel { text-align: center; }
.mini-rom-arrow {
  display: block;
  width: 136px;
  margin: 24px auto;
  border-radius: 32px;
  background: var(--c-primary-soft);
  color: var(--c-primary);
  font-size: 90px;
  line-height: 136px;
  font-weight: 700;
}
.mini-rom-arrow-active { animation: mini-rom-pulse 1.2s ease-in-out infinite alternate; }
@keyframes mini-rom-pulse { from { opacity: 0.65; } to { opacity: 1; } }
.mini-rom-number { display: block; margin-top: 16px; color: var(--c-primary); font-size: 62px; font-weight: 700; }
.mini-rom-progress { height: 16px; margin-top: 18px; overflow: hidden; border-radius: 10px; background: var(--c-bg-3); }
.mini-rom-progress-fill { height: 100%; border-radius: inherit; background: var(--grad-button); }
</style>
