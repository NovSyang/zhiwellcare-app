<script setup lang="ts">
import type { TrainingHistoryGroup } from '@/shared/core'
import { formatDateTime, formatDuration } from '../../utils/DateTimeFormatter'

// 卡片只展示汇总，路由和数据读取由父页面处理。
defineProps<{ group: TrainingHistoryGroup; selectable?: boolean }>()
const emit = defineEmits<{ select: [gameId: string] }>()
</script>

<template>
  <view class="mini-card">
    <text class="mini-card-title">{{ group.gameName }}</text>
    <text class="mini-description">{{ group.trainingCount }} 次 · 累计 {{ formatDuration(group.totalDurationMs) }}</text>
    <text class="mini-description">最近训练 {{ formatDateTime(group.latestCompletedAt) }}</text>
    <button v-if="selectable" @tap="emit('select', group.gameId)">查看记录</button>
  </view>
</template>
