<script setup lang="ts">
import { nextTick, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { api } from '../../api/http'
import { ALL_TAGS, PLAY_MODES, tagLabel } from '../../constants/catalog'

type GameStatus = 'on' | 'off'

interface GameItem {
  gameId: string
  name: string
  summary?: string
  requiredTags: string[]
  durationPresetsMin: number[]
  resourceVersion: string
  resourceUrl?: string
  status: GameStatus
  grayBatch?: number | null
  grayRatio?: number
  categoryLabel?: string
  playMode?: string
}

interface GameForm {
  gameId: string
  name: string
  summary: string
  requiredTags: string[]
  durationPresetsMin: number[]
  resourceVersion: string
  resourceUrl: string
  status: GameStatus
  grayBatch: number | undefined
  grayRatio: number
  categoryLabel: string
  playMode: string
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/
const CATEGORY_OPTIONS = ['腕部协调', '腕部控制', '上肢协调', '反应训练', '持久耐力']
const PRESET_CANDIDATES = [1, 3, 5, 10, 15, 20, 30, 45, 60]

const list = ref<GameItem[]>([])
const loading = ref(false)
const error = ref('')
const dialogVisible = ref(false)
const editing = ref(false)
const saving = ref(false)
const busyId = ref('')

const form = reactive<GameForm>(emptyGameForm())
const formRef = ref<FormInstance>()

const rules: FormRules = {
  gameId: [
    { required: true, message: '请输入游戏 ID', trigger: 'blur' },
    { pattern: ID_PATTERN, message: '以小写字母或数字开头，仅含小写字母/数字/连字符，共 2-64 位', trigger: 'blur' },
  ],
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
  requiredTags: [
    { required: true, type: 'array', min: 1, message: '请至少选择 1 个标签', trigger: 'change' },
  ],
}

onMounted(() => {
  void load()
})

function emptyGameForm(): GameForm {
  return {
    gameId: '',
    name: '',
    summary: '',
    requiredTags: [],
    durationPresetsMin: [1, 3, 5],
    resourceVersion: '1.0.0',
    resourceUrl: '',
    status: 'off',
    grayBatch: undefined,
    grayRatio: 0,
    categoryLabel: '',
    playMode: 'active-force',
  }
}

function pick(row: GameItem): GameForm {
  return {
    gameId: row.gameId,
    name: row.name || '',
    summary: row.summary || '',
    requiredTags: [...(row.requiredTags ?? [])],
    durationPresetsMin:
      row.durationPresetsMin && row.durationPresetsMin.length ? [...row.durationPresetsMin] : [1, 3, 5],
    resourceVersion: row.resourceVersion || '1.0.0',
    resourceUrl: row.resourceUrl || '',
    status: row.status === 'off' ? 'off' : 'on',
    grayBatch: row.grayBatch == null ? undefined : Number(row.grayBatch),
    grayRatio: Math.min(1, Math.max(0, row.grayRatio ?? 0)),
    categoryLabel: row.categoryLabel || '',
    playMode: row.playMode || 'active-force',
  }
}

async function load(): Promise<void> {
  loading.value = true
  try {
    list.value = await api.get<GameItem[]>('/admin/games')
    error.value = ''
  } catch (e) {
    error.value = errText(e)
  } finally {
    loading.value = false
  }
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

async function openAdd(): Promise<void> {
  editing.value = false
  Object.assign(form, emptyGameForm())
  dialogVisible.value = true
  await nextTick()
  formRef.value?.clearValidate()
}

async function openEdit(row: GameItem): Promise<void> {
  editing.value = true
  Object.assign(form, pick(row))
  dialogVisible.value = true
  await nextTick()
  formRef.value?.clearValidate()
}

function toggleTag(list: string[], value: string): void {
  const index = list.indexOf(value)
  if (index >= 0) list.splice(index, 1)
  else list.push(value)
}

function toggleRequiredTag(value: string): void {
  toggleTag(form.requiredTags, value)
  void formRef.value?.validateField('requiredTags')
}

function chipBind(active: boolean): { type: 'primary' | 'info'; effect: 'dark' | 'plain' } {
  return active ? { type: 'primary', effect: 'dark' } : { type: 'info', effect: 'plain' }
}

function addPreset(): void {
  const taken = new Set(form.durationPresetsMin)
  const candidate = PRESET_CANDIDATES.find((minute) => !taken.has(minute))
  if (candidate !== undefined) form.durationPresetsMin.push(candidate)
  else ElMessage.warning('时长档位已覆盖常用范围')
}

function removePreset(index: number): void {
  if (form.durationPresetsMin.length <= 1) return
  form.durationPresetsMin.splice(index, 1)
}

function statusType(status: string): 'success' | 'info' {
  return status === 'on' ? 'success' : 'info'
}

function statusLabel(status: string): string {
  return status === 'on' ? '已上架' : status === 'off' ? '已下架' : status
}

function presetsText(minutes: number[] | undefined): string {
  const presets = minutes ?? []
  return presets.length ? `${presets.join(' / ')} 分钟` : '—'
}

function grayPercent(ratio?: number): number {
  return Math.round((ratio ?? 0) * 100)
}

async function submit(): Promise<void> {
  if (!formRef.value) return
  const ok = await formRef.value.validate().catch(() => false)
  if (!ok) return
  saving.value = true
  try {
    const payload = {
      gameId: form.gameId,
      name: form.name,
      summary: form.summary,
      requiredTags: [...form.requiredTags],
      durationPresetsMin: [...form.durationPresetsMin],
      resourceVersion: form.resourceVersion,
      resourceUrl: form.resourceUrl,
      status: form.status,
      grayBatch: form.grayBatch ?? null,
      grayRatio: Math.round(form.grayRatio * 100) / 100,
      categoryLabel: form.categoryLabel,
      playMode: form.playMode,
    }
    if (editing.value) await api.put(`/admin/games/${payload.gameId}`, payload)
    else await api.post('/admin/games', payload)
    ElMessage.success(editing.value ? '游戏已更新' : '游戏已创建')
    dialogVisible.value = false
    await load()
  } catch (e) {
    ElMessage.error(errText(e))
  } finally {
    saving.value = false
  }
}

async function toggleStatus(row: GameItem): Promise<void> {
  const target: GameStatus = row.status === 'on' ? 'off' : 'on'
  if (target === 'off') {
    try {
      await ElMessageBox.confirm(`确认下架游戏「${row.name}」？下架后用户端将不再展示该游戏。`, '下架确认', {
        type: 'warning',
        confirmButtonText: '下架',
        cancelButtonText: '取消',
      })
    } catch {
      return
    }
  }
  busyId.value = row.gameId
  try {
    await api.patch(`/admin/games/${row.gameId}/status`, { status: target })
    ElMessage.success(target === 'on' ? '游戏已上架' : '游戏已下架')
    await load()
  } catch (e) {
    ElMessage.error(errText(e))
  } finally {
    busyId.value = ''
  }
}

async function remove(row: GameItem): Promise<void> {
  try {
    await ElMessageBox.confirm(`删除后不可恢复。确认删除游戏「${row.name}」（${row.gameId}）？`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    await api.delete(`/admin/games/${row.gameId}`)
    ElMessage.success('游戏已删除')
    await load()
  } catch (e) {
    ElMessage.error(errText(e))
  }
}
</script>

<template>
  <div>
    <el-card shadow="never" class="page-card preview-card">
      <div class="preview-head">
        <span class="preview-ic">👁</span>
        <strong>上架预览</strong>
      </div>
      <p class="preview-text">
        用户端按「设备能力标签 ⊇ 游戏所需标签」过滤可玩游戏。发布或修改游戏前，请先确认已建档设备已打上本游戏所需的能力 / 手柄标签，否则对应设备将匹配不到该游戏。
      </p>
    </el-card>

    <div class="page-card">
      <el-card shadow="never">
        <div class="table-toolbar">
          <div class="toolbar-info">
            <strong>共 {{ list.length }} 个游戏</strong>
            <span class="form-tip">目录为消费版主动训练口径；下架与灰度（grayRatio &gt; 0）即时对用户端生效。</span>
          </div>
          <el-button type="primary" @click="openAdd">＋ 新增游戏</el-button>
        </div>
        <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon style="margin-bottom: 12px" />
        <div class="table-scroll">
          <el-table v-loading="loading" :data="list" style="width: 100%">
            <el-table-column label="游戏 ID" width="170">
              <template #default="{ row }">
                <span class="id-text">{{ row.gameId }}</span>
              </template>
            </el-table-column>
            <el-table-column label="游戏" min-width="240">
              <template #default="{ row }">
                <div class="game-cell">
                  <div class="game-name">{{ row.name }}</div>
                  <div v-if="row.summary" class="game-summary">{{ row.summary }}</div>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="所需标签" min-width="220">
              <template #default="{ row }">
                <div v-if="row.requiredTags && row.requiredTags.length" class="tags-wrap">
                  <el-tag v-for="tag in row.requiredTags" :key="tag" size="small" type="primary" effect="plain" class="tag-item">
                    {{ tagLabel(tag) }}
                  </el-tag>
                </div>
                <span v-else class="muted">—</span>
              </template>
            </el-table-column>
            <el-table-column label="时长档位" width="140">
              <template #default="{ row }">
                {{ presetsText(row.durationPresetsMin) }}
              </template>
            </el-table-column>
            <el-table-column label="资源版本" width="110">
              <template #default="{ row }">
                {{ row.resourceVersion || '—' }}
              </template>
            </el-table-column>
            <el-table-column label="灰度" width="130" align="center">
              <template #default="{ row }">
                <div class="gray-cell">
                  <span>{{ grayPercent(row.grayRatio) }}%</span>
                  <el-tag v-if="(row.grayRatio ?? 0) > 0" type="warning" size="small" effect="plain">灰度中</el-tag>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="90" align="center">
              <template #default="{ row }">
                <el-tag :type="statusType(row.status)" size="small" :effect="row.status === 'on' ? 'dark' : 'plain'">
                  {{ statusLabel(row.status) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="176" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
                <el-button link type="primary" :loading="busyId === row.gameId" @click="toggleStatus(row)">
                  {{ row.status === 'on' ? '下架' : '上架' }}
                </el-button>
                <el-button link type="danger" @click="remove(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
        <el-empty
          v-if="!loading && !error && list.length === 0"
          description="暂无游戏，点击右上角「新增游戏」建档"
          :image-size="90"
        />
      </el-card>
    </div>

    <el-dialog
      v-model="dialogVisible"
      :title="editing ? '编辑游戏' : '新增游戏'"
      width="720px"
      append-to-body
      :close-on-click-modal="false"
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-position="top">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="游戏 ID" prop="gameId">
              <el-input
                v-model="form.gameId"
                :disabled="editing"
                placeholder="如 target-reach"
                :maxlength="64"
                clearable
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="名称" prop="name">
              <el-input v-model="form.name" placeholder="如 四方挥腕挑战" :maxlength="60" clearable />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="目录分类">
              <el-select
                v-model="form.categoryLabel"
                filterable
                allow-create
                default-first-option
                placeholder="选择或输入分类"
                style="width: 100%"
              >
                <el-option v-for="cat in CATEGORY_OPTIONS" :key="cat" :label="cat" :value="cat" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="玩法模式">
              <el-select v-model="form.playMode" disabled style="width: 100%">
                <el-option v-for="mode in PLAY_MODES" :key="mode.value" :label="mode.label" :value="mode.value" />
              </el-select>
              <p class="form-tip">当前版本仅支持「纯主动发力」玩法（消费版口径），后续可按需扩展。</p>
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="简介">
          <el-input
            v-model="form.summary"
            type="textarea"
            :rows="2"
            placeholder="面向用户展示的一句话玩法介绍"
            :maxlength="200"
            show-word-limit
          />
        </el-form-item>
        <el-form-item label="所需标签（至少 1 个）" prop="requiredTags">
          <div class="chip-list">
            <el-tag
              v-for="opt in ALL_TAGS"
              :key="opt.value"
              v-bind="chipBind(form.requiredTags.includes(opt.value))"
              class="chip"
              @click="toggleRequiredTag(opt.value)"
            >
              {{ opt.label }}
            </el-tag>
          </div>
          <p class="form-tip">用户端匹配依据：设备能力标签需覆盖本游戏全部所需标签，请与已建档设备保持口径一致。</p>
        </el-form-item>
        <el-form-item label="时长档位（分钟，1-60 正整数）">
          <div class="preset-list">
            <div v-for="(_, index) in form.durationPresetsMin" :key="index" class="preset-row">
              <el-input-number
                v-model="form.durationPresetsMin[index]"
                :min="1"
                :max="60"
                :step="1"
                :precision="0"
                controls-position="right"
                style="width: 150px"
              />
              <span class="preset-unit">分钟</span>
              <el-button link type="danger" :disabled="form.durationPresetsMin.length <= 1" @click="removePreset(index)">
                移除
              </el-button>
            </div>
          </div>
          <el-button size="small" @click="addPreset">＋ 添加时长档位</el-button>
        </el-form-item>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="资源版本">
              <el-input v-model="form.resourceVersion" placeholder="如 1.0.0" :maxlength="20" clearable />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="资源地址（选填）">
              <el-input v-model="form.resourceUrl" placeholder="https://…" clearable />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="灰度批次（选填）">
              <el-input-number
                v-model="form.grayBatch"
                :min="0"
                :max="1000000"
                :step="1"
                :precision="0"
                controls-position="right"
                placeholder="批次号"
                style="width: 100%"
              />
              <p class="form-tip">留空表示不区分批次；配合下方灰度比例使用。</p>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="灰度比例">
              <div class="ratio-line">
                <el-slider v-model="form.grayRatio" :min="0" :max="1" :step="0.05" />
                <span class="ratio-text">{{ Math.round(form.grayRatio * 100) }}%</span>
              </div>
              <p class="form-tip">大于 0 时该游戏按比例灰度放出到用户端，列表会标记「灰度中」。</p>
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="状态">
          <el-radio-group v-model="form.status">
            <el-radio value="on">上架（用户端可见）</el-radio>
            <el-radio value="off">下架（暂不展示）</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submit">
          {{ editing ? '保存修改' : '确认新增' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.preview-card :deep(.el-card__body) {
  padding: 12px 16px;
}

.preview-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
}

.preview-ic {
  font-size: 15px;
}

.preview-text {
  margin: 6px 0 0;
  color: #55637b;
  font-size: 13px;
  line-height: 1.7;
}

.toolbar-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.table-scroll {
  overflow-x: auto;
}

.id-text {
  font-family: Consolas, 'Courier New', monospace;
  font-size: 13px;
}

.game-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.game-name {
  font-weight: 600;
}

.game-summary {
  color: #8593a8;
  font-size: 12px;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

.tags-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.muted {
  color: #b6c0cf;
}

.gray-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.gray-cell > span {
  font-size: 13px;
}

.chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chip {
  cursor: pointer;
  user-select: none;
}

.preset-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  margin-bottom: 8px;
}

.preset-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.preset-unit {
  color: #55637b;
  font-size: 13px;
}

.ratio-line {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.ratio-line .el-slider {
  flex: 1;
}

.ratio-text {
  color: #0436a7;
  font-weight: 600;
  font-size: 14px;
  min-width: 46px;
  text-align: right;
}
</style>
