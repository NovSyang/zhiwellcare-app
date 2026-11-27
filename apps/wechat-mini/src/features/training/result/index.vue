<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
import Taro, { useLoad, useUnload } from '@tarojs/taro'
import type { TrainingRecord } from '@/shared/core'
import { getTrainingRepository } from '../../../app/MiniServices'
import { navigateMini, useMiniSafePage } from '../../../app/MiniPageSafety'
import { presentSavedTraining } from '../../../app/TrainingRecordPresentation'
import { formatDateTime, formatDuration } from '../../../utils/DateTimeFormatter'

defineOptions({ name: 'TrainingResultPage' })

const record = shallowRef<TrainingRecord | null>(null)
const details = computed(() => record.value ? presentSavedTraining(record.value) : null)
const loading = ref(true)
const error = ref('')
const navigationError = ref('')
useMiniSafePage('features/training/result/index', computed(() => !loading.value && Boolean(record.value)))
let unloaded = false
useUnload(() => { unloaded = true })

// 页面只读取已保存的记录，跳转、刷新和返回时都不会重复保存。
useLoad(async (options) => {
  try {
    const id = options.id ?? ''
    if (!id.trim()) throw new Error('缺少训练记录编号。')
    const stored = await getTrainingRepository().getById(id)
    if (!stored) throw new Error('找不到这条训练记录，可返回训练大厅。')
    if (!unloaded) record.value = stored
  } catch (failure) {
    if (!unloaded) error.value = failure instanceof Error ? failure.message : '读取训练结果失败。'
  } finally {
    if (!unloaded) loading.value = false
  }
})

async function openReplay() {
  const id = record.value?.id
  if (!id) return
  navigationError.value = ''
  try {
    await navigateMini(() => Taro.navigateTo({ url: `/features/history/detail/index?id=${encodeURIComponent(id)}` }))
  } catch { navigationError.value = '暂时无法打开训练回放，请重试。' }
}

async function backToTraining() {
  try { await navigateMini(() => Taro.switchTab({ url: '/pages/training/index' })) }
  catch { navigationError.value = '暂时无法返回训练大厅，请重试。' }
}
</script>

<template>
  <view class="mini-page">
    <text class="mini-heading">{{ record?.gameName || '训练结果' }}</text>
    <text v-if="loading" class="mini-description">正在读取训练结果…</text>
    <text v-if="error" class="mini-error">{{ error }}</text>
    <template v-if="record">
      <view class="mini-card">
        <text class="mini-card-title">已保存到本机</text>
        <text class="mini-description">{{ formatDateTime(record.completedAt) }}</text>
        <text class="mini-description">有效时长 {{ formatDuration(record.result.durationMs) }}</text>
        <text v-if="record.device" class="mini-description">{{ record.device.modelName }}</text>
        <text v-for="metric in details?.metrics ?? []" :key="metric.label" class="mini-description">{{ metric.label }} · {{ metric.value }}</text>
        <text v-if="!details" class="mini-description">这条记录暂无完整的分项结果。</text>
      </view>
      <view v-for="section in details?.sections ?? []" :key="section.title" class="mini-card">
        <text class="mini-card-title">{{ section.title }}</text>
        <text v-for="item in section.items" :key="item.label" class="mini-description">{{ item.label }} · {{ item.value }} {{ item.detail }}</text>
      </view>
      <button v-if="record.replay" class="mini-primary" @tap="openReplay">查看训练回放</button>
      <text v-else class="mini-description">这条记录的回放不可用。</text>
    </template>
    <text v-if="navigationError" class="mini-error">{{ navigationError }}</text>
    <button @tap="backToTraining">返回训练大厅</button>
  </view>
</template>
