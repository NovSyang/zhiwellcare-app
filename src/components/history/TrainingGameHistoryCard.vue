<script setup lang="ts">
import type { TrainingHistoryGroup } from '../../core/history/TrainingHistoryGroup'

const props = defineProps<{ group: TrainingHistoryGroup }>()
const emit = defineEmits<{ select: [gameId: string] }>()

/** 完整日期避免跨年份历史只显示月日时产生歧义。 */
function formatDate(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '--'
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

function formatTotalDuration(value: number): string {
  if (value < 60_000) return `${trimDecimal(value / 1_000)} 秒`
  return `${trimDecimal(value / 60_000)} 分钟`
}

function trimDecimal(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '')
}
</script>

<template>
  <button
    type="button"
    class="history-game-card"
    :aria-label="`查看${group.gameName}的${group.trainingCount}条训练记录`"
    @click="emit('select', props.group.gameId)"
  >
    <span class="history-card-title">{{ group.gameName }}</span>
    <span class="history-card-stats">
      <span><small>训练次数</small><strong>{{ group.trainingCount }} 次</strong></span>
      <span><small>最近训练</small><strong>{{ formatDate(group.latestCompletedAt) }}</strong></span>
      <span><small>累计训练</small><strong>{{ formatTotalDuration(group.totalDurationMs) }}</strong></span>
    </span>
    <span class="history-card-link">查看记录 <span aria-hidden="true">→</span></span>
  </button>
</template>
