<script setup lang="ts">
import { computed } from 'vue'
import type { TrainingRecord } from '@/shared/core'
import { presentSavedTraining } from '../../app/TrainingRecordPresentation'
import { formatDateTime, formatDuration } from '../../utils/DateTimeFormatter'

const props = defineProps<{ record: TrainingRecord }>()
const emit = defineEmits<{ select: [id: string] }>()
// 预览展示前两个主要指标，详情页提供完整结果。
const metrics = computed(() => presentSavedTraining(props.record)?.metrics.slice(0, 2) ?? [])
</script>

<template>
  <view class="mini-card">
    <text class="mini-card-title">{{ formatDateTime(record.completedAt) }}</text>
    <text class="mini-description">有效时长 {{ formatDuration(record.result.durationMs) }}</text>
    <text v-for="metric in metrics" :key="metric.label" class="mini-description">{{ metric.label }} · {{ metric.value }}</text>
    <button @tap="emit('select', record.id)">查看详情</button>
  </view>
</template>
