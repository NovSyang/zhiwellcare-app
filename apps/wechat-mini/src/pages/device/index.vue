<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useDidHide, useUnload } from '@tarojs/taro'
import type { SensorConnectionState, SensorDevice } from '@/shared/core'
import {
  connectionSnapshot, deviceBusy, deviceState, foreground, interactionsBlocked, miniDeviceCoordinator,
  readyForTraining, reconnectTrainingDevice, scanTrainingDevices, selectTrainingDevice,
  sensorSnapshot, startTrainingCalibration, cancelTrainingCalibration, disconnectTrainingDevice, confirmForgetTrainingDevice,
} from '../../app/MiniServices'
import { useMiniTabPage } from '../../app/MiniPageSafety'
import MiniPageHeader from '../../components/app/MiniPageHeader.vue'
import MiniTabScrollBody from '../../components/app/MiniTabScrollBody.vue'

defineOptions({ name: 'DevicePage' })
const { viewport, scrollStyle, fallbackPageScroll } = useMiniTabPage('pages/device/index')

const labels: Record<SensorConnectionState, string> = {
  idle: '未连接', scanning: '正在扫描', connecting: '正在连接', discovering: '正在发现服务',
  subscribing: '正在订阅通知', configuring: '正在校验 50Hz 输出', connected: '设备已连接',
  disconnected: '已断开', error: '连接异常',
}
const candidates = ref<SensorDevice[]>([])
const busy = ref(false)
const error = ref('')
const scanned = ref(false)
const binding = computed(() => connectionSnapshot.value.binding)
const state = computed(() => sensorSnapshot.value?.state ?? 'idle')
const disabled = computed(() => busy.value || interactionsBlocked.value || deviceBusy.value || deviceState.value.calibrating)
const owner = Symbol('设备页连接')
let revision = 0

// Tab 隐藏后丢弃旧扫描结果，并取消尚未提交的设备选择。
function leave() {
  revision += 1
  busy.value = false
  candidates.value = []
  scanned.value = false
  miniDeviceCoordinator.cancelSelection(owner)
}
useDidHide(leave)
useUnload(leave)
watch(foreground, (visible) => { if (!visible) leave() }, { flush: 'sync' })

async function run(action: (current: () => boolean) => unknown, canInterrupt = false) {
  if (canInterrupt ? interactionsBlocked.value : disabled.value) return
  const request = ++revision
  const current = () => request === revision
  busy.value = true
  error.value = ''
  try { await action(current) } catch (failure) {
    if (current()) error.value = failure instanceof Error ? failure.message : '操作失败，请重试。'
  } finally { if (current()) busy.value = false }
}

function scan() {
  void run(async (current) => {
    scanned.value = false
    const list = await scanTrainingDevices()
    if (!current()) return
    candidates.value = list
    scanned.value = true
  })
}

function connect(device: SensorDevice) {
  void run(async (current) => {
    await selectTrainingDevice(device, owner)
    if (!current()) return
    candidates.value = []
    scanned.value = false
  })
}

</script>

<template>
  <view class="mini-tab-page" :class="{ 'mini-tab-page--fallback': fallbackPageScroll }" :style="viewport">
    <view id="mini-tab-header" class="mini-tab-header">
      <MiniPageHeader title="设备" device-page />
    </view>
    <MiniTabScrollBody :fallback="fallbackPageScroll" :scroll-style="scrollStyle">
        <view class="mini-card">
          <text class="mini-card-title">{{ binding?.name ?? '腕部训练设备' }}</text>
          <text class="mini-description">{{ readyForTraining ? '已完成中心校准，可开始训练' : labels[state] }}</text>
          <text v-if="state === 'connected'" class="mini-description">
            数据 {{ sensorSnapshot?.rateHz ?? 0 }} Hz · 电量 {{ sensorSnapshot?.battery.percent == null ? '读取中' : sensorSnapshot.battery.percent + '%' }}
          </text>
          <text v-if="connectionSnapshot.message" class="mini-description">{{ connectionSnapshot.message }}</text>
          <text v-if="error || deviceState.error" class="mini-error">{{ error || deviceState.error }}</text>
          <text v-if="deviceState.policyNeedsRepair" class="mini-description">请手动连接设备以恢复自动重连设置。</text>
          <button v-if="state === 'connected'" class="mini-primary" :disabled="disabled" @tap="run(startTrainingCalibration)">
            {{ deviceState.calibrating ? '正在校准，请保持静止' : readyForTraining ? '重新校准中心' : '校准中心' }}
          </button>
          <button v-if="deviceState.calibrating" :disabled="interactionsBlocked" @tap="run(cancelTrainingCalibration, true)">取消校准</button>
          <text v-if="state === 'connected'" class="mini-description">校准时将设备放在自然中心位置并保持静止。</text>
          <button v-if="binding && state !== 'connected'" :disabled="disabled" @tap="run(() => reconnectTrainingDevice())">重连已绑定设备</button>
          <button v-if="state === 'connected' || (binding && deviceBusy)" :disabled="interactionsBlocked || deviceState.action === 'disconnecting' || deviceState.action === 'forgetting'" @tap="run(disconnectTrainingDevice, true)">断开设备</button>
          <button v-if="binding" :disabled="disabled" @tap="run(confirmForgetTrainingDevice)">忘记设备</button>
        </view>

        <view class="mini-card">
          <text class="mini-card-title">查找设备</text>
          <text class="mini-description">扫描附近的 BS-BT91，通过蓝牙接收腕部姿态用于训练和校准。</text>
          <button class="mini-primary" :disabled="disabled" @tap="scan">{{ state === 'connected' ? '查找其他设备' : '扫描蓝牙设备' }}</button>
          <text v-if="scanned && !candidates.length" class="mini-description">暂未发现训练设备。请确认设备已开机并靠近手机。</text>
          <button v-for="device in candidates" :key="device.id" :disabled="disabled" @tap="connect(device)">
            {{ device.name }} · {{ device.id.slice(-8) }}
          </button>
        </view>
    </MiniTabScrollBody>
  </view>
</template>
