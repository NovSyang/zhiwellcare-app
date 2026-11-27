<script setup lang="ts">
import { computed } from 'vue'
import { connectionSnapshot, deviceState, sensorSnapshot } from '../../app/MiniServices'
import { presentDeviceStatus } from '../../app/MiniDeviceStatusPresentation'
import MiniDeviceBattery from './MiniDeviceBattery.vue'

// 游戏内仅显示状态和电量，设备操作仍由原训练流程提供。
const status = computed(() => presentDeviceStatus({ ...deviceState.value, connection: connectionSnapshot.value, sensor: sensorSnapshot.value }))
</script>

<template>
  <view class="immersive-chip mini-compact-device">
    <text class="mini-device-dot" :class="'mini-device-' + status.tone" />
    <text>{{ status.label }}</text>
    <MiniDeviceBattery v-if="status.connected" :percent="status.batteryPercent" :fill="status.batteryFill" :low="status.batteryLow" />
  </view>
</template>

<style>
/* 固定逻辑像素，横屏旋转时不占用额外画布高度。 */
.mini-compact-device { display: flex; align-items: center; gap: 6PX; }
.mini-compact-device .mini-battery-shell { width: 17PX; height: 8PX; }
</style>
