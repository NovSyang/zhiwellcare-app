<script setup lang="ts">
import type { TrainingRecord } from '../../core/training/TrainingRecord'
import { presentTrainingRecord } from '../../games/TrainingRecordPresentation'

defineProps<{ records: TrainingRecord[] }>()
const emit = defineEmits<{
  detail: [record: TrainingRecord]
  delete: [record: TrainingRecord]
}>()

function formatDate(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '--'
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

function formatDuration(value: number): string {
  return Number.isFinite(value) && value >= 0 ? `${(value / 1_000).toFixed(1)} s` : '--'
}

/** 主要结果完全由游戏 Presenter 决定，表格不识别具体游戏字段。 */
function primaryMetric(record: TrainingRecord): string {
  const metric = presentTrainingRecord(record)?.metrics[0]
  return metric ? `${metric.label} ${metric.value}` : '详细指标不可解析'
}
</script>

<template>
  <div class="history-table-scroll">
    <table class="history-record-table">
      <thead><tr><th scope="col">训练时间</th><th scope="col">训练时长</th><th scope="col">主要结果</th><th scope="col">操作</th></tr></thead>
      <tbody><tr v-for="record in records" :key="record.id"><td>{{ formatDate(record.completedAt) }}</td><td>{{ formatDuration(record.result.durationMs) }}</td><td><strong>{{ primaryMetric(record) }}</strong></td><td><div class="history-table-actions"><button class="button" @click="emit('detail', record)">详情</button><button class="button danger" @click="emit('delete', record)">删除</button></div></td></tr></tbody>
    </table>
  </div>
</template>
