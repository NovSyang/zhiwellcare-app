<script setup lang="ts">
import MiniDeviceConnectionStatus from './MiniDeviceConnectionStatus.vue'

// 原生导航与 Tab 保留，标题和状态固定在 Tab 内容区顶部。
defineProps<{ title: string; devicePage?: boolean }>()
</script>

<template>
  <view class="mini-page-header">
    <text class="mini-page-title">{{ title }}</text>
    <MiniDeviceConnectionStatus :device-page="devicePage" />
  </view>
</template>
