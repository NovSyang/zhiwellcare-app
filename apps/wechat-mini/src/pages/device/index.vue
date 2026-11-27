<script setup lang="ts">
import { computed, ref } from 'vue'
import type { SensorConnectionState, SensorDevice } from '@/shared/core'
import {
  connectionManager, connectionSnapshot, foreground, initializeMiniServices, lifecycleError,
  readyForTraining, reconnectTrainingDevice, scanTrainingDevices, selectTrainingDevice,
  sensorService, sensorSnapshot,
} from '../../app/MiniServices'

defineOptions({ name: 'DevicePage' })

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
const calibration = computed(() => sensorService.motion.getCalibrationSnapshot(sensorSnapshot.value?.frame?.timestamp))
const disabled = computed(() => busy.value || !foreground.value || connectionSnapshot.value.operation !== 'idle')

// 同一设备动作结束后才开放后续操作，错误在原页面可见、可重试。
async function run(action: () => Promise<void>) {
  if (disabled.value) return
  busy.value = true
  error.value = ''
  lifecycleError.value = null
  try { await action() } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '操作失败，请重试。'
  } finally { busy.value = false }
}

function scan() {
  void run(async () => {
    scanned.value = false
    candidates.value = await scanTrainingDevices()
    scanned.value = true
  })
}

function connect(device: SensorDevice) {
  void run(async () => {
    await selectTrainingDevice(device)
    candidates.value = []
    scanned.value = false
  })
}

void initializeMiniServices().catch((failure: unknown) => {
  error.value = failure instanceof Error ? failure.message : '加载本地设备设置失败。'
})
</script>

<template>
  <view class="mini-page">
    <text class="mini-hero">设备</text>
    <view class="mini-card">
      <text class="mini-card-title">{{ binding?.name ?? '腕部训练设备' }}</text>
      <text class="mini-description">{{ readyForTraining ? '已完成中心校准，可开始训练' : labels[state] }}</text>
      <text v-if="state === 'connected'" class="mini-description">
        数据 {{ sensorSnapshot?.rateHz ?? 0 }} Hz · 电量 {{ sensorSnapshot?.battery.percent == null ? '读取中' : sensorSnapshot.battery.percent + '%' }}
      </text>
      <text v-if="connectionSnapshot.message" class="mini-description">{{ connectionSnapshot.message }}</text>
      <text v-if="error || lifecycleError" class="mini-error">{{ error || lifecycleError }}</text>
      <button v-if="state === 'connected'" class="mini-primary" :disabled="disabled || calibration.active" @tap="sensorService.startCalibration()">
        {{ calibration.active ? '正在校准，请保持静止' : readyForTraining ? '重新校准中心' : '校准中心' }}
      </button>
      <text v-if="state === 'connected'" class="mini-description">校准时将设备放在自然中心位置并保持静止。</text>
      <button v-if="binding && state !== 'connected'" :disabled="disabled" @tap="run(reconnectTrainingDevice)">重连已绑定设备</button>
      <button v-if="state === 'connected'" :disabled="disabled" @tap="run(() => connectionManager.disconnectManually())">断开设备</button>
      <button v-if="binding" :disabled="disabled" @tap="run(() => connectionManager.forgetCurrentDevice())">忘记设备</button>
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
  </view>
</template>
