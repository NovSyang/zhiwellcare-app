<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
import Taro, { useDidShow, useLoad, useUnload } from '@tarojs/taro'
import { navigateMini } from '../../../app/MiniPageSafety'
import { buildTrainingHistoryGroups, type TrainingHistoryGroup } from '@/shared/core'
import { getTrainingRepository } from '../../../app/MiniServices'
import TrainingGameHistoryCard from '../../../components/history/TrainingGameHistoryCard.vue'
import TrainingRecordCard from '../../../components/history/TrainingRecordCard.vue'

defineOptions({ name: 'TrainingHistoryListPage' })

const PAGE_SIZE = 20
const group = shallowRef<TrainingHistoryGroup>()
const visibleCount = ref(PAGE_SIZE)
const visible = computed(() => group.value?.records.slice(0, visibleCount.value) ?? [])
const loading = ref(true)
const error = ref('')
let gameId = ''
let revision = 0

useLoad((options) => { gameId = options.gameId ?? '' })
useDidShow(() => { void refresh() })
useUnload(() => { revision += 1 })

/** 删除后回到此页时重读摘要，排序和统计沿用共享分组规则。 */
async function refresh() {
  const request = ++revision
  if (!gameId.trim()) {
    error.value = '缺少游戏信息，请从训练历史进入。'
    loading.value = false
    return
  }
  loading.value = true
  error.value = ''
  try {
    const records = await getTrainingRepository().getAll()
    if (request === revision) group.value = buildTrainingHistoryGroups(records.filter((record) => record.gameId === gameId))[0]
  } catch (failure) {
    if (request === revision) {
      group.value = undefined
      error.value = failure instanceof Error ? failure.message : '读取训练记录失败。'
    }
  } finally {
    if (request === revision) loading.value = false
  }
}

async function openRecord(id: string) {
  try { await navigateMini(() => Taro.navigateTo({ url: `/features/history/detail/index?id=${encodeURIComponent(id)}` })) }
  catch { error.value = '无法打开训练详情，请重试。' }
}
</script>

<template>
  <view class="mini-page">
    <text class="mini-heading">训练记录</text>
    <text v-if="loading" class="mini-description">正在读取训练记录…</text>
    <text v-if="error" class="mini-error">{{ error }}</text>
    <template v-if="group && !loading">
      <TrainingGameHistoryCard :group="group" />
      <TrainingRecordCard v-for="record in visible" :key="record.id" :record="record" @select="openRecord" />
      <button v-if="visible.length < group.records.length" @tap="visibleCount += PAGE_SIZE">加载更多</button>
    </template>
    <text v-else-if="!loading && !error" class="mini-description">此游戏暂无训练记录。</text>
  </view>
</template>
