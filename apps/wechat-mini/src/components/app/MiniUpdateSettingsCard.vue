<script setup lang="ts">
import { computed, ref } from 'vue'
import { miniUpdateService, updateState, version } from '../../app/MiniServices'

// 微信只提供检查、就绪和失败事件，因此页面显示阶段而不估算进度。
const labels = {
  'waiting-check': '等待微信检查更新',
  'up-to-date': '本次检查未发现新版本',
  downloading: '微信正在下载新版本',
  ready: '新版本已下载',
  failed: '下载失败，请检查网络并稍后重新打开小程序',
  applying: '正在应用更新',
  unsupported: '当前环境不支持自动更新',
}
const detail = computed(() => updateState.value.applying ? labels.applying
  : updateState.value.state === 'ready' && !updateState.value.safe ? '新版本已下载，将在安全时机提示'
    : labels[updateState.value.state])
const showHelp = ref(false)
</script>

<template>
  <view class="mini-card">
    <text class="mini-card-title">关于与更新</text>
    <text class="mini-description">当前版本 {{ version.displayLabel }}</text>
    <text class="mini-description">{{ detail }}</text>
    <text v-if="updateState.error" class="mini-error">{{ updateState.error }}</text>
    <button v-if="updateState.state === 'ready'" class="mini-primary" :disabled="!updateState.canRequest" @tap="miniUpdateService.request(true)">立即更新</button>
    <button v-else :disabled="updateState.applying || updateState.promptOpen" @tap="showHelp = !showHelp">{{ showHelp ? '收起更新说明' : '查看更新状态' }}</button>
    <text v-if="showHelp" class="mini-description">重新打开小程序时，由微信检查并下载可用的新版本。</text>
  </view>
</template>
