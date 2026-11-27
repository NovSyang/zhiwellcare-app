<script setup lang="ts">
defineProps<{ percent: number | null; fill: number; low: boolean }>()
</script>

<template>
  <view class="mini-device-battery" :class="{ 'mini-battery-low': low }" :aria-label="percent === null ? '电量读取中' : '电量 ' + percent + '%'">
    <view class="mini-battery-shell"><view class="mini-battery-fill" :style="{ width: fill + '%' }" /></view>
    <text>{{ percent ?? '--' }}%</text>
  </view>
</template>

<style>
/* 电量图形和数字使用同一色调，0% 仍保留外框和数字。 */
.mini-device-battery { display: inline-flex; align-items: center; gap: 7rpx; white-space: nowrap; }
.mini-battery-shell { position: relative; width: 30rpx; height: 16rpx; border: 1PX solid currentColor; padding: 1PX; border-radius: 3PX; }
.mini-battery-shell::after { position: absolute; content: ''; top: 25%; right: -3PX; width: 2PX; height: 50%; border-radius: 1PX; background: currentColor; }
.mini-battery-fill { height: 100%; background: #80f0bf; }
.mini-battery-low { color: #ffd3d4; }
.mini-battery-low .mini-battery-fill { background: #ff848e; }
</style>
