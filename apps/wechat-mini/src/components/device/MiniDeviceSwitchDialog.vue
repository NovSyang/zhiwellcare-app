<script setup lang="ts">
import { onUnmounted, ref } from 'vue'
import type { SensorDevice } from '@/shared/core'
import { connectionSnapshot, deviceBusy, miniDeviceCoordinator, scanTrainingDevices, selectTrainingDevice } from '../../app/MiniServices'

const emit = defineEmits<{ close: [] }>()
const candidates = ref<SensorDevice[]>([])
const scanned = ref(false)
const scanning = ref(false)
const selecting = ref(false)
const error = ref('')
const owner = Symbol('设备选择')
let alive = true

// 忽略关闭后的扫描结果；连接尚未提交时通知全局协调器取消。
function invalidate() {
  if (!alive) return
  alive = false
  miniDeviceCoordinator.cancelSelection(owner)
}
defineExpose({ invalidate })
onUnmounted(invalidate)

async function scan() {
  if (deviceBusy.value) return
  scanning.value = true
  error.value = ''
  scanned.value = false
  candidates.value = []
  try {
    const list = await scanTrainingDevices()
    if (alive) { candidates.value = list; scanned.value = true }
  } catch (failure) {
    if (alive) error.value = failure instanceof Error ? failure.message : '扫描失败，请重试。'
  } finally { if (alive) scanning.value = false }
}

async function select(candidate: SensorDevice) {
  if (deviceBusy.value) return
  selecting.value = true
  error.value = ''
  try {
    await selectTrainingDevice(candidate, owner)
    if (alive) emit('close')
  } catch (failure) {
    if (alive) error.value = failure instanceof Error ? failure.message : '连接失败，请重试。'
  } finally { if (alive) selecting.value = false }
}

function close() { if (!selecting.value) emit('close') }
</script>

<template>
  <view class="mini-device-dialog-mask" @tap="close">
    <view class="mini-device-dialog" role="dialog" aria-label="更换训练设备" @tap.stop>
      <text class="mini-card-title">更换训练设备</text>
      <text class="mini-description">当前绑定 {{ connectionSnapshot.binding?.name || '未绑定' }}</text>
      <text class="mini-description">请打开设备并靠近手机。蓝牙姿态数据用于腕部训练和中心校准。</text>
      <button class="mini-menu-button" :disabled="deviceBusy" @tap="scan">{{ scanning ? '正在扫描…' : scanned ? '重新扫描' : '扫描蓝牙设备' }}</button>
      <text v-if="selecting" class="mini-description">正在连接，请等待完成。</text>
      <text v-if="error" class="mini-error">{{ error }}</text>
      <text v-if="scanned && !candidates.length" class="mini-description">未找到设备，请确认设备开机后重试。</text>
      <scroll-view v-if="candidates.length" scroll-y class="mini-device-candidates">
        <button v-for="candidate in candidates" :key="candidate.id" class="mini-menu-button" :disabled="deviceBusy" @tap="select(candidate)">
          {{ candidate.name }} · {{ candidate.id.slice(-8) }} {{ candidate.id === connectionSnapshot.binding?.deviceId ? '（已绑定）' : '' }}
        </button>
      </scroll-view>
      <button class="mini-menu-button" :disabled="selecting" @tap="close">关闭</button>
    </view>
  </view>
</template>
