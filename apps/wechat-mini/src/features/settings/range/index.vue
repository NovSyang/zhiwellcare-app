<script setup lang="ts">
import { ref, shallowRef, watch } from 'vue'
import Taro, { useDidHide, useLoad, useUnload } from '@tarojs/taro'
import { createDefaultMotionProfile, profileFromMeasuredRange, RomCalibrationFlow } from '@/shared/core'
import { initializeMiniServices, motionProfileService, readyForTraining, sensorService } from '../../../app/MiniServices'

defineOptions({ name: 'ActivityRangePage' })
const directionName = { left: '左', right: '右', forward: '前', backward: '后' }
const profile = shallowRef(createDefaultMotionProfile())
let flow = new RomCalibrationFlow()
const snapshot = shallowRef(flow.getSnapshot(Date.now()))
const error = ref('')
const saving = ref(false)
let timer: ReturnType<typeof setInterval> | undefined
let lastSampleAt = 0
let unsubscribe: (() => void) | undefined

// 采样时间与 BLE 帧统一使用 Epoch 毫秒，流程按共享 ROM 状态机运行。
useLoad(async () => {
  try {
    await initializeMiniServices()
    profile.value = motionProfileService.getCurrent()
  } catch (failure) { error.value = message(failure) }
})
useDidHide(stopCurrentAttempt)
useUnload(stopCurrentAttempt)
watch(readyForTraining, (ready) => { if (!ready) stopCurrentAttempt() })

function begin() {
  if (!readyForTraining.value || !flow.beginCountdown()) return
  refresh()
  timer = setInterval(() => {
    if (flow.advanceCountdown(Date.now())) {
      stopTimer()
      beginCapture()
    }
    refresh()
  }, 1_000)
}

function beginCapture() {
  lastSampleAt = 0
  unsubscribe = sensorService.onSnapshot(({ frame, gameInput }) => {
    if (!frame || !gameInput.connected || !gameInput.calibrated || frame.timestamp <= lastSampleAt) return
    lastSampleAt = frame.timestamp
    flow.addSample(sensorService.motion.getRelativeMotion(frame), frame.timestamp)
  })
  timer = setInterval(() => {
    if (flow.complete(Date.now())) {
      stopTimer()
      unsubscribe?.()
      unsubscribe = undefined
    }
    refresh()
  }, 100)
}

function stopTimer() { if (timer !== undefined) clearInterval(timer); timer = undefined }
function refresh() { snapshot.value = flow.getSnapshot(Date.now()) }
function stopCurrentAttempt() {
  stopTimer()
  unsubscribe?.()
  unsubscribe = undefined
  flow.abortCurrentAttempt()
  refresh()
}

function accept() { flow.accept(); refresh() }
function retry() { flow.retry(); refresh() }

async function save() {
  const range = flow.finish()
  if (!range || saving.value) return
  saving.value = true
  error.value = ''
  try {
    await motionProfileService.save(profileFromMeasuredRange(range, profile.value))
    profile.value = motionProfileService.getCurrent()
    flow = new RomCalibrationFlow()
    refresh()
  } catch (failure) { error.value = message(failure) }
  finally { saving.value = false }
}

async function reset() {
  if (saving.value) return
  saving.value = true
  error.value = ''
  try {
    const result = await Taro.showModal({ title: '恢复默认范围', content: '当前个人活动范围将恢复为默认配置。' })
    if (result.confirm) profile.value = await motionProfileService.reset()
  } catch (failure) { error.value = message(failure) }
  finally { saving.value = false }
}

function message(failure: unknown): string {
  return failure instanceof Error ? failure.message : '活动范围操作失败，请重试。'
}
</script>

<template>
  <view class="mini-page">
    <text class="mini-heading">个人活动范围</text>
    <view class="mini-card">
      <text class="mini-card-title">当前训练范围</text>
      <text class="mini-description">前 {{ profile.activeRange.forwardMax.toFixed(1) }}° · 后 {{ profile.activeRange.backwardMax.toFixed(1) }}°</text>
      <text class="mini-description">左 {{ profile.activeRange.leftMax.toFixed(1) }}° · 右 {{ profile.activeRange.rightMax.toFixed(1) }}°</text>
      <button :disabled="saving || snapshot.phase !== 'guide'" @tap="reset">恢复默认范围</button>
    </view>
    <view class="mini-card">
      <text class="mini-card-title">测量活动范围</text>
      <text v-if="!readyForTraining && snapshot.phase !== 'summary'" class="mini-description">请在设备页连接并完成中心校准。</text>
      <template v-if="snapshot.phase === 'guide'">
        <text class="mini-description">第 {{ snapshot.currentDirectionIndex + 1 }}/{{ snapshot.totalDirections }} 项 · 向{{ directionName[snapshot.currentDirection] }}缓慢移动到舒适位置。</text>
        <button class="mini-primary" :disabled="!readyForTraining" @tap="begin">开始测量</button>
      </template>
      <text v-else-if="snapshot.phase === 'countdown'" class="mini-description">{{ snapshot.countdown }} 秒后开始</text>
      <text v-else-if="snapshot.phase === 'measuring'" class="mini-description">正在采样 · {{ snapshot.calibration.sampleCount }} 个样本</text>
      <template v-else-if="snapshot.phase === 'review'">
        <text class="mini-description">{{ snapshot.calibration.result?.valid ? `本方向 ${snapshot.calibration.result.measuredRom.toFixed(1)}°` : snapshot.calibration.result?.message }}</text>
        <button v-if="snapshot.calibration.result?.valid" class="mini-primary" @tap="accept">接受本方向结果</button>
        <button @tap="retry">重新测量</button>
      </template>
      <button v-else class="mini-primary" :disabled="saving" @tap="save">保存个人活动范围</button>
      <text v-if="error" class="mini-error">{{ error }}</text>
    </view>
  </view>
</template>
