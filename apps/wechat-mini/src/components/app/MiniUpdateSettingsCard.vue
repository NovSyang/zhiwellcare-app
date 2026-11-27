<script setup lang="ts">
import { computed } from 'vue'
import { miniUpdateService, updateState, version } from '../../app/MiniServices'
import { miniUpdateStatusText } from '../../app/MiniUpdatePresentation'

// 微信只提供检查、就绪和失败事件，因此页面显示阶段而不估算进度。
const detail = computed(() => miniUpdateStatusText(updateState.value))
</script>

<template>
  <view class="mini-card">
    <text class="mini-card-title">版本与更新状态</text>
    <text class="mini-description">当前版本 {{ version.displayLabel }}</text>
    <text class="mini-description">{{ detail }}</text>
    <text v-if="updateState.error" class="mini-error">{{ updateState.error }}</text>
    <button v-if="updateState.state === 'ready'" class="mini-primary" :disabled="!updateState.canRequest" @tap="miniUpdateService.request(true)">立即更新</button>
    <text class="mini-description">重新打开小程序时，由微信检查并下载可用的新版本。</text>
  </view>
</template>
