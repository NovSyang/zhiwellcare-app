<script setup lang="ts">
import type { TrainingRecord } from '../../core/training/TrainingRecord'
import { presentTrainingRecord } from '../../games/TrainingRecordPresentation'

defineProps<{ records: TrainingRecord[] }>()
const emit = defineEmits<{ detail: [record: TrainingRecord]; delete: [record: TrainingRecord] }>()

function formatDate(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '--'
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

function formatDuration(value: number): string {
  return Number.isFinite(value) && value >= 0 ? `${(value / 1_000).toFixed(1)} s` : '--'
}

/** 手机卡片与桌面表格读取同一个 Presenter，确保主要结果不会因布局不同而变化。 */
function primaryMetric(record: TrainingRecord): string {
  const metric = presentTrainingRecord(record)?.metrics[0]
  return metric ? `${metric.label} ${metric.value}` : '详细指标不可解析'
}
</script>

<template>
  <div class="history-record-cards">
    <article v-for="record in records" :key="record.id" class="card history-record-card">
      <div><span class="muted small">训练时间</span><strong>{{ formatDate(record.completedAt) }}</strong></div>
      <div class="history-record-card-metrics"><span><small>有效时长</small><strong>{{ formatDuration(record.result.durationMs) }}</strong></span><span><small>主要结果</small><strong>{{ primaryMetric(record) }}</strong></span></div>
      <div class="row"><button class="button primary" @click="emit('detail', record)">查看详情</button><button class="button danger" @click="emit('delete', record)">删除</button></div>
    </article>
  </div>
</template>
