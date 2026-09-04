<script setup lang="ts">
import { computed } from 'vue'
import { presentTrainingRecord } from '../../games/TrainingRecordPresentation'
import type { TrainingRecord } from '../../core/training/TrainingRecord'

const props = defineProps<{ record: TrainingRecord }>()
const presentation = computed(() => presentTrainingRecord(props.record))
const profile = computed(() => props.record.motionProfile)
function duration(value: number): string { return `${(value / 1_000).toFixed(1)} s` }
function range(value: number | undefined): string { return value === undefined ? '--' : `${value.toFixed(1)}°` }
</script>

<template>
  <section class="history-summary">
    <div class="summary-metrics"><div><span>有效训练时长</span><strong>{{ duration(record.result.durationMs) }}</strong></div><div v-for="metric in presentation?.metrics ?? []" :key="metric.label"><span>{{ metric.label }}</span><strong>{{ metric.value }}</strong></div></div>
    <p v-if="!presentation" class="muted">当前版本无法解析该游戏的详细结果。</p>
    <div class="summary-columns"><div v-for="section in presentation?.sections ?? []" :key="section.title"><h3>{{ section.title }}</h3><p v-for="item in section.items" :key="item.label">{{ item.label }}：{{ item.value }}<span v-if="item.detail" class="muted small"> · {{ item.detail }}</span></p></div><div><h3>当时活动范围</h3><p>实测范围：左 {{ range(profile.measuredRange?.leftMax) }} / 右 {{ range(profile.measuredRange?.rightMax) }} / 前 {{ range(profile.measuredRange?.forwardMax) }} / 后 {{ range(profile.measuredRange?.backwardMax) }}</p><p>训练范围：左 {{ range(profile.activeRange.leftMax) }} / 右 {{ range(profile.activeRange.rightMax) }} / 前 {{ range(profile.activeRange.forwardMax) }} / 后 {{ range(profile.activeRange.backwardMax) }}</p><p>训练比例 {{ (profile.trainingRatio * 100).toFixed(0) }}% · 死区 {{ profile.horizontalDeadZone }}° / {{ profile.verticalDeadZone }}°</p></div></div>
  </section>
</template>
