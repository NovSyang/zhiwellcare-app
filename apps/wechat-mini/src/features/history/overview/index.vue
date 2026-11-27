<script setup lang="ts">
import { ref, shallowRef } from 'vue'
import Taro, { useDidShow, useUnload } from '@tarojs/taro'
import { buildTrainingHistoryGroups, type TrainingHistoryGroup } from '@/shared/core'
import { getTrainingRepository } from '../../../app/MiniServices'
import { navigateMini } from '../../../app/MiniPageSafety'
import TrainingGameHistoryCard from '../../../components/history/TrainingGameHistoryCard.vue'

defineOptions({ name: 'TrainingHistoryOverviewPage' })

const groups = shallowRef<TrainingHistoryGroup[]>([])
const loading = ref(true)
const readError = ref('')
const navigationError = ref('')
let revision = 0
let navigating = false

// 每次返回都重新读取仓储，单次删除和删除最后一条记录都会刷新汇总。
async function refresh() {
  const current = ++revision
  loading.value = true
  readError.value = ''
  navigationError.value = ''
  try {
    const records = await getTrainingRepository().getAll()
    if (current === revision) groups.value = buildTrainingHistoryGroups(records)
  } catch (failure) {
    if (current === revision) readError.value = failure instanceof Error ? failure.message : '读取训练历史失败。'
  } finally { if (current === revision) loading.value = false }
}
useDidShow(refresh)
useUnload(() => { revision += 1 })

async function openRecords(gameId: string) {
  if (navigating) return
  navigating = true
  navigationError.value = ''
  try { await navigateMini(() => Taro.navigateTo({ url: `/features/history/list/index?gameId=${encodeURIComponent(gameId)}` })) }
  catch { navigationError.value = '暂时无法打开训练记录，请重试。' }
  finally { navigating = false }
}
</script>

<template>
  <view class="mini-page">
    <text v-if="loading" class="mini-description">正在读取训练记录…</text>
    <view v-else-if="readError" class="mini-card">
      <text class="mini-error">{{ readError }}</text>
      <button @tap="refresh">重新读取</button>
    </view>
    <view v-else-if="!groups.length" class="mini-card">
      <text class="mini-card-title">暂无训练记录</text>
      <text class="mini-description">完成并保存训练后，可在这里查看成绩及回放。</text>
    </view>
    <template v-else>
      <text v-if="navigationError" class="mini-error">{{ navigationError }}</text>
      <TrainingGameHistoryCard v-for="group in groups" :key="group.gameId" :group="group" selectable @select="openRecords" />
    </template>
  </view>
</template>
