<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../api/http'

interface DashboardStats {
  deviceModels: number
  games: number
  users: number
  trainingRecords: number
  todayRecords: number
}

const stats = ref<DashboardStats | null>(null)
const loading = ref(true)
const error = ref('')

onMounted(() => { void load() })

async function load(): Promise<void> {
  loading.value = true
  try {
    stats.value = await api.get<DashboardStats>('/admin/stats/dashboard')
    error.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

const cards = [
  { key: 'deviceModels' as const, label: '设备型号', icon: '⌚' },
  { key: 'games' as const, label: '上架游戏', icon: '🎯' },
  { key: 'users' as const, label: '注册用户', icon: '👥' },
  { key: 'trainingRecords' as const, label: '训练记录', icon: '📈' },
  { key: 'todayRecords' as const, label: '今日训练', icon: '🔥' },
]
</script>

<template>
  <div>
    <el-row :gutter="14">
      <el-col v-for="card in cards" :key="card.key" :xs="12" :sm="8" :md="6" style="margin-bottom: 14px">
        <el-card shadow="hover">
          <div class="stat">
            <span class="stat-ic">{{ card.icon }}</span>
            <div>
              <strong v-loading="loading">{{ stats ? stats[card.key] : '--' }}</strong>
              <span>{{ card.label }}</span>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-card>
      <template #header>运营提示</template>
      <ul class="tips">
        <li>目录新增设备 / 游戏无需发版：设备在「设备型号」建档并打能力标签，游戏在「游戏目录」声明所需标签，用户端自动按“设备能力标签 ⊇ 游戏所需标签”过滤。</li>
        <li>下架或灰度（grayRatio 0-1）即时对用户端生效（用户端需切 VITE_CATALOG_MODE=http）。</li>
        <li>合规红线：所有设备/游戏均须为消费版主动发力训练口径，禁止医疗表述；固件仅消费版。</li>
      </ul>
      <el-alert v-if="error" :title="error" type="error" :closable="false" style="margin-top: 10px" />
    </el-card>
  </div>
</template>

<style scoped>
.stat { display: flex; align-items: center; gap: 12px; }
.stat-ic { font-size: 30px; }
.stat strong { display: block; font-size: 26px; line-height: 1.2; color: #0436a7; }
.stat span { color: #8593a8; font-size: 13px; }
.tips { margin: 0; padding-left: 18px; color: #55637b; font-size: 13px; line-height: 2; }
</style>
