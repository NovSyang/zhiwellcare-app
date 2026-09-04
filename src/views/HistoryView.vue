<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { trainingRepository } from '../app/AppServices'
import TrainingGameHistoryCard from '../components/history/TrainingGameHistoryCard.vue'
import TrainingHistoryDialog from '../components/history/TrainingHistoryDialog.vue'
import TrainingRecordTable from '../components/history/TrainingRecordTable.vue'
import TrainingRecordCardList from '../components/history/TrainingRecordCardList.vue'
import { buildTrainingHistoryGroups } from '../core/history/TrainingHistoryGroup'
import type { TrainingRecord } from '../core/training/TrainingRecord'
import { getGameModule } from '../games/GameRegistry'

const records = ref<TrainingRecord[]>([])
const selectedRecord = ref<TrainingRecord | null>(null)
const selectedGameId = ref<string | null>(null)
const errorMessage = ref('')
const groups = computed(() => buildTrainingHistoryGroups(records.value, (gameId) => getGameModule(gameId)?.definition.name))
const selectedGroup = computed(() => selectedGameId.value ? groups.value.find((group) => group.gameId === selectedGameId.value) ?? null : null)

onMounted(() => { void load() })
// 数据发生变化且当前分类消失时，自动返回游戏卡片层。
watch(groups, () => { if (selectedGameId.value && !selectedGroup.value) selectedGameId.value = null })

async function load(): Promise<void> {
  try {
    records.value = await trainingRepository.getAll()
    errorMessage.value = ''
  } catch (error) { errorMessage.value = formatError(error) }
}

function selectGame(gameId: string): void {
  selectedRecord.value = null
  selectedGameId.value = gameId
}

function showAllGames(): void {
  selectedRecord.value = null
  selectedGameId.value = null
}

async function remove(record: TrainingRecord): Promise<void> {
  const gameName = selectedGroup.value?.gameName || getGameModule(record.gameId)?.definition.name || record.gameName || record.gameId
  if (!window.confirm(`确认删除“${gameName}”\n${formatDate(record.completedAt)} 的训练记录吗？`)) return
  try {
    await trainingRepository.delete(record.id)
    // 先同步本地状态，后续重新读取失败时页面也不会保留已删除记录。
    records.value = records.value.filter((item) => item.id !== record.id)
    if (selectedRecord.value?.id === record.id) selectedRecord.value = null
    if (selectedGameId.value && !selectedGroup.value) selectedGameId.value = null
    await load()
  } catch (error) { errorMessage.value = `删除训练记录失败：${formatError(error)}` }
}

function formatDate(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '--'
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

function formatTotalDuration(value: number): string {
  const amount = value < 60_000 ? value / 1_000 : value / 60_000
  return `${amount.toFixed(1).replace(/\.0$/, '')} ${value < 60_000 ? '秒' : '分钟'}`
}

function formatError(error: unknown): string { return error instanceof Error ? error.message : String(error) }
</script>

<template>
  <main class="content-page history-page">
    <p class="eyebrow">Training History</p>
    <template v-if="selectedGroup">
      <h1>训练历史 <span class="history-breadcrumb-separator">/</span> {{ selectedGroup.gameName }}</h1>
      <button class="button history-back-button" @click="showAllGames">← 返回全部游戏</button>
      <div class="history-group-summary"><span>训练次数 <strong>{{ selectedGroup.trainingCount }}</strong></span><span>累计训练 <strong>{{ formatTotalDuration(selectedGroup.totalDurationMs) }}</strong></span></div>
    </template>
    <template v-else><h1>训练历史</h1><p class="muted">按游戏查看已完成的训练记录、详细结果和轨迹回放。</p></template>

    <p v-if="errorMessage" class="error history-page-error">{{ errorMessage }}</p>
    <p v-if="!records.length" class="muted history-empty">暂无已保存训练记录。</p>
    <div v-else-if="!selectedGroup" class="history-game-grid"><TrainingGameHistoryCard v-for="group in groups" :key="group.gameId" :group="group" @select="selectGame" /></div>
    <template v-else><TrainingRecordTable class="history-desktop-records" :records="selectedGroup.records" @detail="selectedRecord = $event" @delete="remove" /><TrainingRecordCardList class="history-mobile-records" :records="selectedGroup.records" @detail="selectedRecord = $event" @delete="remove" /></template>

    <TrainingHistoryDialog v-if="selectedRecord" :record="selectedRecord" @close="selectedRecord = null" />
  </main>
</template>
