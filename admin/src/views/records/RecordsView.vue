<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../../api/http'
import { tagLabel } from '../../constants/catalog'

interface TrainingRecord {
  id: number
  recordId: string
  userId?: string | null
  gameId: string
  gameName: string
  deviceModelId: string
  deviceModelName: string
  capabilityTags?: string[] | null
  statistics: unknown
  clientVersion: string
  completedAt: string
  uploadedAt: string
}

interface RecordPage {
  items: TrainingRecord[]
  total: number
}

const rows = ref<TrainingRecord[]>([])
const total = ref(0)
const loading = ref(false)

const gameId = ref('')
const modelId = ref('')
const page = ref(1)
const pageSize = ref(20)

const detailVisible = ref(false)
const current = ref<TrainingRecord | null>(null)

onMounted(() => { void load() })

async function load(): Promise<void> {
  loading.value = true
  try {
    const params = new URLSearchParams()
    params.set('page', String(page.value))
    params.set('pageSize', String(pageSize.value))
    if (gameId.value.trim()) params.set('gameId', gameId.value.trim())
    if (modelId.value.trim()) params.set('modelId', modelId.value.trim())
    const data = await api.get<RecordPage>(`/admin/training-records?${params.toString()}`)
    rows.value = data.items
    total.value = data.total
  } catch (e) {
    // 401/403 会带 message，统一用其提示
    ElMessage.error(e instanceof Error ? e.message : '加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}

function search(): void {
  page.value = 1
  void load()
}

function reset(): void {
  gameId.value = ''
  modelId.value = ''
  page.value = 1
  void load()
}

function onPageChange(p: number): void {
  page.value = p
  void load()
}

function onSizeChange(size: number): void {
  pageSize.value = size
  page.value = 1
  void load()
}

function openDetail(row: TrainingRecord): void {
  current.value = row
  detailVisible.value = true
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function formatDateTime(value?: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** userId/recordId 超长截断展示 */
function shortId(value: string | null | undefined, len: number): string {
  if (value == null || value === '') return '—'
  return value.length > len ? `${value.slice(0, len)}…` : value
}

/**
 * statistics 可能是后端原始 JSON 对象，也可能是 JSON 字符串：
 * 字符串先 parse，再格式化缩进展示；解析失败则原样返回文本。
 */
function formatStatistics(raw: unknown): string {
  if (raw == null) return ''
  if (typeof raw === 'string') {
    try {
      return JSON.stringify(JSON.parse(raw) as unknown, null, 2)
    } catch {
      return raw
    }
  }
  try {
    return JSON.stringify(raw, null, 2)
  } catch {
    return String(raw)
  }
}
</script>

<template>
  <div>
    <p class="form-tip page-note">此处为训练摘要（高频采样原始文件后续存 S3 回放链路，暂不在本列表）。</p>

    <el-card class="page-card" shadow="never">
      <div class="table-toolbar">
        <div class="toolbar-filters">
          <el-input
            v-model="gameId"
            placeholder="按 gameId 过滤"
            clearable
            class="filter-input"
            @keyup.enter="search"
          />
          <el-input
            v-model="modelId"
            placeholder="按设备型号过滤"
            clearable
            class="filter-input"
            @keyup.enter="search"
          />
        </div>
        <div class="toolbar-actions">
          <el-button type="primary" @click="search">查询</el-button>
          <el-button @click="reset">重置</el-button>
        </div>
      </div>

      <el-table :data="rows" v-loading="loading" row-key="id">
        <el-table-column label="完成时间" min-width="150">
          <template #default="{ row }">{{ formatDateTime(row.completedAt) }}</template>
        </el-table-column>
        <el-table-column label="游戏" min-width="180">
          <template #default="{ row }">
            <div class="cell-main">{{ row.gameName || '—' }}</div>
            <div class="cell-sub mono">{{ row.gameId }}</div>
          </template>
        </el-table-column>
        <el-table-column label="设备" min-width="180">
          <template #default="{ row }">
            <div class="cell-main">{{ row.deviceModelName || '—' }}</div>
            <div class="cell-sub mono">{{ row.deviceModelId }}</div>
          </template>
        </el-table-column>
        <el-table-column label="能力标签" min-width="170">
          <template #default="{ row }">
            <el-tag
              v-for="tag in row.capabilityTags ?? []"
              :key="tag"
              size="small"
              type="info"
              effect="plain"
              class="chip"
            >
              {{ tagLabel(tag) }}
            </el-tag>
            <span v-if="!(row.capabilityTags ?? []).length" class="cell-sub">—</span>
          </template>
        </el-table-column>
        <el-table-column label="用户ID" min-width="120">
          <template #default="{ row }">
            <el-tooltip :content="row.userId || ''" placement="top" :disabled="!row.userId || row.userId.length <= 8">
              <span class="mono">{{ shortId(row.userId, 8) }}</span>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column label="recordId" min-width="170">
          <template #default="{ row }">
            <el-tooltip :content="row.recordId" placement="top" :disabled="row.recordId.length <= 18">
              <span class="mono">{{ shortId(row.recordId, 18) }}</span>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="80" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDetail(row)">详情</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无训练记录" :image-size="90" />
        </template>
      </el-table>

      <div v-if="total > 0" class="pager">
        <el-pagination
          background
          layout="total, sizes, prev, pager, next, jumper"
          :total="total"
          :current-page="page"
          :page-size="pageSize"
          :page-sizes="[10, 20, 50]"
          @current-change="onPageChange"
          @size-change="onSizeChange"
        />
      </div>
    </el-card>

    <el-dialog v-model="detailVisible" title="训练记录详情" width="min(760px, 94vw)" top="5vh">
      <template v-if="current">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="recordId" :span="2">
            <span class="mono">{{ current.recordId }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="完成时间">{{ formatDateTime(current.completedAt) }}</el-descriptions-item>
          <el-descriptions-item label="上传时间">{{ formatDateTime(current.uploadedAt) }}</el-descriptions-item>
          <el-descriptions-item label="游戏">{{ current.gameName || '—' }}（{{ current.gameId }}）</el-descriptions-item>
          <el-descriptions-item label="设备">{{ current.deviceModelName || '—' }}（{{ current.deviceModelId }}）</el-descriptions-item>
          <el-descriptions-item label="用户ID">
            <span class="mono">{{ current.userId || '—' }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="客户端版本">
            <span class="mono">{{ current.clientVersion || '—' }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="能力标签" :span="2">
            {{ (current.capabilityTags ?? []).map((tag) => tagLabel(tag)).join('、') || '—' }}
          </el-descriptions-item>
        </el-descriptions>
        <h4 class="stats-title">统计明细 statistics（格式化 JSON）</h4>
        <pre class="json-pre">{{ formatStatistics(current.statistics) }}</pre>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page-note {
  margin: 0 0 12px;
}
.toolbar-filters,
.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.filter-input {
  width: 220px;
}
.cell-main {
  font-size: 13px;
  color: #1f2d3d;
  line-height: 1.5;
}
.cell-sub {
  font-size: 12px;
  color: #8593a8;
  line-height: 1.5;
}
.mono {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 12px;
}
.chip {
  margin: 2px 6px 2px 0;
}
.stats-title {
  margin: 16px 0 8px;
  font-size: 13px;
  font-weight: 600;
}
.json-pre {
  margin: 0;
  padding: 12px;
  background: #f6f8fb;
  border: 1px solid #e4eaf2;
  border-radius: 8px;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 12px;
  line-height: 1.6;
  color: #1f2d3d;
  max-height: 55vh;
  overflow: auto;
  white-space: pre;
  word-break: normal;
}
</style>
