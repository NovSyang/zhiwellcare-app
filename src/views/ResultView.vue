<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { latestTrainingRecord } from '../app/AppServices'
import { presentTrainingRecord } from '../games/TrainingRecordPresentation'

const router = useRouter()
const record = computed(() => latestTrainingRecord.value)
const presentation = computed(() => record.value ? presentTrainingRecord(record.value) : null)
function duration(value: number): string { return `${(value / 1_000).toFixed(1)} s` }
</script>

<template>
  <main class="result-shell"><section class="result-card"><p class="eyebrow">训练完成</p><h1>{{ record?.gameName ?? '训练结果' }}</h1>
    <template v-if="record"><div class="result-metrics"><div><span>有效训练时长</span><strong>{{ duration(record.result.durationMs) }}</strong></div><div v-for="metric in presentation?.metrics ?? []" :key="metric.label"><span>{{ metric.label }}</span><strong>{{ metric.value }}</strong></div></div><p v-if="record.device?.modelName" class="muted small">设备：{{ record.device.modelName }}</p><template v-if="presentation"><section v-for="section in presentation.sections" :key="section.title"><h2>{{ section.title }}</h2><div class="direction-grid"><div v-for="item in section.items" :key="item.label"><span>{{ item.label }}</span><strong>{{ item.value }}</strong><small v-if="item.detail">{{ item.detail }}</small></div></div></section></template><p v-else class="muted">当前版本无法解析该游戏的详细结果。</p></template>
    <p v-else class="muted">当前会话没有可展示的结果，请从历史记录查看已保存训练。</p>
    <div class="row"><button class="button primary" @click="router.push('/games')">返回训练选择</button><button class="button" @click="router.push('/mine/history')">查看历史</button></div>
  </section></main>
</template>
