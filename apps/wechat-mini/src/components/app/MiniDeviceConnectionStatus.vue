<script setup lang="ts">
import Taro, { useDidHide, useUnload } from '@tarojs/taro'
import { computed, onUnmounted, ref, watch } from 'vue'
import { miniSafety, navigateMini } from '../../app/MiniPageSafety'
import { presentDeviceStatus } from '../../app/MiniDeviceStatusPresentation'
import {
  connectionSnapshot, deviceState, deviceBusy, foreground, interactionsBlocked, sensorSnapshot,
  confirmForgetTrainingDevice, reconnectTrainingDevice,
} from '../../app/MiniServices'
import MiniDeviceBattery from './MiniDeviceBattery.vue'
import MiniDeviceSwitchDialog from '../device/MiniDeviceSwitchDialog.vue'

defineProps<{ devicePage?: boolean }>()
const mode = ref<'closed' | 'menu' | 'dialog'>('closed')
const dialog = ref<InstanceType<typeof MiniDeviceSwitchDialog> | null>(null)
const status = computed(() => presentDeviceStatus({ ...deviceState.value, connection: connectionSnapshot.value, sensor: sensorSnapshot.value }))
const statusText = computed(() => status.value.label + (status.value.connected
  ? status.value.batteryPercent === null ? '，电量读取中' : `，电量 ${status.value.batteryPercent}%`
  : ''))
const binding = computed(() => connectionSnapshot.value.binding)
let release: (() => void) | undefined

function close() {
  dialog.value?.invalidate()
  mode.value = 'closed'
  release?.()
  release = undefined
}

function toggle() {
  if (mode.value === 'dialog') return
  if (mode.value === 'menu') { close(); return }
  if (interactionsBlocked.value || deviceBusy.value || deviceState.value.calibrating) return
  // 从菜单进入选择弹层时持续持有同一把锁，直到关闭或离开 Tab。
  release = miniSafety.acquire('设备菜单')
  mode.value = 'menu'
}

async function run(action: () => Promise<unknown>) {
  if (interactionsBlocked.value || deviceBusy.value || deviceState.value.calibrating) return
  try {
    const pending = action()
    close()
    await pending
  } catch (failure) {
    if (foreground.value) void Taro.showToast({ title: failure instanceof Error ? failure.message : '设备操作失败，请重试。', icon: 'none' })
  }
}

useDidHide(close)
useUnload(close)
onUnmounted(close)
watch(foreground, (active) => { if (!active) close() }, { flush: 'sync' })
</script>

<template>
  <view class="mini-device-status">
    <button class="mini-device-trigger" :disabled="interactionsBlocked || (mode === 'closed' && (deviceBusy || deviceState.calibrating))"
      :aria-label="statusText" :aria-expanded="mode === 'menu'" @tap="toggle">
      <text class="mini-device-dot" :class="'mini-device-' + status.tone" />
      <text>{{ status.label }}</text>
      <MiniDeviceBattery v-if="status.connected" :percent="status.batteryPercent" :fill="status.batteryFill" :low="status.batteryLow" />
      <text>{{ mode === 'menu' ? '▼' : '▲' }}</text>
    </button>
    <template v-if="mode === 'menu'">
      <view class="mini-device-menu-mask" @tap="close" />
      <view class="mini-device-menu">
        <text class="mini-card-title mini-device-name">{{ binding?.name || '未绑定设备' }}</text>
        <text class="mini-description">{{ status.label }}{{ status.calibrationLabel ? ' · ' + status.calibrationLabel : '' }}</text>
        <text v-if="status.connected" class="mini-description">电量 {{ status.batteryPercent == null ? '读取中' : status.batteryPercent + '%' }}</text>
        <text v-if="status.connected && deviceState.action === 'scanning'" class="mini-description">正在查找其他设备</text>
        <text v-if="deviceState.error || connectionSnapshot.message" class="mini-description">{{ deviceState.error || connectionSnapshot.message }}</text>
        <text v-if="deviceState.policyNeedsRepair" class="mini-description">请手动连接设备以恢复自动重连设置。</text>
        <button class="mini-menu-button" :disabled="!binding || deviceBusy" @tap="run(() => reconnectTrainingDevice())">重新连接{{ status.connected ? '（需重新校准）' : '' }}</button>
        <button class="mini-menu-button" :disabled="deviceBusy" @tap="mode = 'dialog'">{{ binding ? '更换设备' : '选择设备' }}</button>
        <button class="mini-menu-button" :disabled="deviceBusy" @tap="devicePage ? close() : run(() => navigateMini(() => Taro.switchTab({ url: '/pages/device/index' })))">设备管理</button>
        <button class="mini-menu-button mini-menu-danger" :disabled="!binding || deviceBusy" @tap="run(confirmForgetTrainingDevice)">忘记设备</button>
      </view>
    </template>
    <MiniDeviceSwitchDialog v-if="mode === 'dialog'" ref="dialog" @close="close" />
  </view>
</template>
