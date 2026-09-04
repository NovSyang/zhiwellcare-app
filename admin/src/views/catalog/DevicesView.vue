<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { api } from '../../api/http'
import { DEVICE_CATEGORIES, DEVICE_TAGS, HANDLE_TAGS, tagLabel } from '../../constants/catalog'

type DeviceStatus = 'on' | 'off'

interface DeviceModel {
  modelId: string
  name: string
  manufacturer: string
  category: string
  description: string
  capabilityTags: string[]
  supportedHandleTags: string[]
  namePatterns: string[]
  protocol: string
  minAppVersion: string
  firmwareUpdatable: boolean
  icon: string
  status: DeviceStatus
  updatedAt?: string
}

interface DeviceForm {
  modelId: string
  name: string
  manufacturer: string
  category: string
  description: string
  capabilityTags: string[]
  supportedHandleTags: string[]
  namePatterns: string[]
  protocol: string
  minAppVersion: string
  firmwareUpdatable: boolean
  icon: string
  status: DeviceStatus
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/

const list = ref<DeviceModel[]>([])
const loading = ref(false)
const error = ref('')
const dialogVisible = ref(false)
const editing = ref(false)
const saving = ref(false)
const busyId = ref('')

const form = reactive<DeviceForm>(emptyDeviceForm())
const formRef = ref<FormInstance>()

const rules: FormRules = {
  modelId: [
    { required: true, message: '请输入型号 ID', trigger: 'blur' },
    { pattern: ID_PATTERN, message: '以小写字母或数字开头，仅含小写字母/数字/连字符，共 2-64 位', trigger: 'blur' },
  ],
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
  category: [{ required: true, message: '请选择分类', trigger: 'change' }],
}

onMounted(() => {
  void load()
})

function emptyDeviceForm(): DeviceForm {
  return {
    modelId: '',
    name: '',
    manufacturer: '智为康乐',
    category: '',
    description: '',
    capabilityTags: [],
    supportedHandleTags: [],
    namePatterns: [],
    protocol: '',
    minAppVersion: '0.1.0',
    firmwareUpdatable: true,
    icon: '',
    status: 'on',
  }
}

function pick(row: DeviceModel): DeviceForm {
  return {
    modelId: row.modelId,
    name: row.name || '',
    manufacturer: row.manufacturer || '智为康乐',
    category: row.category || '',
    description: row.description || '',
    capabilityTags: [...(row.capabilityTags ?? [])],
    supportedHandleTags: [...(row.supportedHandleTags ?? [])],
    namePatterns: [...(row.namePatterns ?? [])],
    protocol: row.protocol || '',
    minAppVersion: row.minAppVersion || '0.1.0',
    firmwareUpdatable: row.firmwareUpdatable ?? true,
    icon: row.icon || '',
    status: row.status === 'off' ? 'off' : 'on',
  }
}

/** 下拉建议：收集所有型号已录入的 BLE 名称片段，便于复用。 */
const namePatternSuggestions = computed<string[]>(() => {
  const values = new Set<string>()
  list.value.forEach((row) => (row.namePatterns ?? []).forEach((p) => values.add(p)))
  return [...values]
})

async function load(): Promise<void> {
  loading.value = true
  try {
    list.value = await api.get<DeviceModel[]>('/admin/devices')
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
  Object.assign(form, emptyDeviceForm())
  dialogVisible.value = true
  await nextTick()
  formRef.value?.clearValidate()
}

async function openEdit(row: DeviceModel): Promise<void> {
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

function chipBind(active: boolean): { type: 'primary' | 'info'; effect: 'dark' | 'plain' } {
  return active ? { type: 'primary', effect: 'dark' } : { type: 'info', effect: 'plain' }
}

function categoryText(value: string): string {
  return DEVICE_CATEGORIES.find((item) => item.value === value)?.label ?? value
}

function statusType(status: string): 'success' | 'info' {
  return status === 'on' ? 'success' : 'info'
}

function statusLabel(status: string): string {
  return status === 'on' ? '已上架' : status === 'off' ? '已下架' : status
}

function formatTime(value?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function submit(): Promise<void> {
  if (!formRef.value) return
  const ok = await formRef.value.validate().catch(() => false)
  if (!ok) return
  saving.value = true
  try {
    const payload: DeviceForm = { ...form }
    if (editing.value) await api.put(`/admin/devices/${payload.modelId}`, payload)
    else await api.post('/admin/devices', payload)
    ElMessage.success(editing.value ? '型号已更新' : '型号已创建')
    dialogVisible.value = false
    await load()
  } catch (e) {
    ElMessage.error(errText(e))
  } finally {
    saving.value = false
  }
}

async function toggleStatus(row: DeviceModel): Promise<void> {
  const target: DeviceStatus = row.status === 'on' ? 'off' : 'on'
  if (target === 'off') {
    try {
      await ElMessageBox.confirm(`确认下架型号「${row.name}」？下架后用户端将不再展示该型号。`, '下架确认', {
        type: 'warning',
        confirmButtonText: '下架',
        cancelButtonText: '取消',
      })
    } catch {
      return
    }
  }
  busyId.value = row.modelId
  try {
    await api.patch(`/admin/devices/${row.modelId}/status`, { status: target })
    ElMessage.success(target === 'on' ? '型号已上架' : '型号已下架')
    await load()
  } catch (e) {
    ElMessage.error(errText(e))
  } finally {
    busyId.value = ''
  }
}

async function remove(row: DeviceModel): Promise<void> {
  try {
    await ElMessageBox.confirm(`删除后不可恢复。确认删除型号「${row.name}」（${row.modelId}）？`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    await api.delete(`/admin/devices/${row.modelId}`)
    ElMessage.success('型号已删除')
    await load()
  } catch (e) {
    ElMessage.error(errText(e))
  }
}
</script>

<template>
  <div>
    <div class="page-card">
      <el-card shadow="never">
        <div class="table-toolbar">
          <div class="toolbar-info">
            <strong>共 {{ list.length }} 个型号</strong>
            <span class="form-tip">用户端按设备能力标签自动匹配可玩游戏，请为已建档设备准确打标。</span>
          </div>
          <el-button type="primary" @click="openAdd">＋ 新增型号</el-button>
        </div>
        <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon style="margin-bottom: 12px" />
        <div class="table-scroll">
          <el-table v-loading="loading" :data="list" style="width: 100%">
            <el-table-column label="图标" width="64" align="center">
              <template #default="{ row }">
                <span class="icon-text">{{ row.icon || '—' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="名称" min-width="220">
              <template #default="{ row }">
                <div class="name-cell">
                  <span class="name-line">{{ row.name }}</span>
                  <span class="sub-line">{{ row.modelId }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="分类" width="110">
              <template #default="{ row }">
                {{ categoryText(row.category) }}
              </template>
            </el-table-column>
            <el-table-column label="能力标签" min-width="220">
              <template #default="{ row }">
                <div v-if="row.capabilityTags && row.capabilityTags.length" class="tags-wrap">
                  <el-tag v-for="tag in row.capabilityTags" :key="tag" size="small" effect="plain" class="tag-item">
                    {{ tagLabel(tag) }}
                  </el-tag>
                </div>
                <span v-else class="muted">—</span>
              </template>
            </el-table-column>
            <el-table-column label="固件升级" width="100" align="center">
              <template #default="{ row }">
                <el-tag :type="row.firmwareUpdatable ? 'success' : 'info'" size="small">
                  {{ row.firmwareUpdatable ? '是' : '否' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="90" align="center">
              <template #default="{ row }">
                <el-tag :type="statusType(row.status)" size="small" :effect="row.status === 'on' ? 'dark' : 'plain'">
                  {{ statusLabel(row.status) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="更新时间" width="160">
              <template #default="{ row }">
                {{ formatTime(row.updatedAt) }}
              </template>
            </el-table-column>
            <el-table-column label="操作" width="176" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
                <el-button link type="primary" :loading="busyId === row.modelId" @click="toggleStatus(row)">
                  {{ row.status === 'on' ? '下架' : '上架' }}
                </el-button>
                <el-button link type="danger" @click="remove(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
        <el-empty
          v-if="!loading && !error && list.length === 0"
          description="暂无设备型号，点击右上角「新增型号」建档"
          :image-size="90"
        />
      </el-card>
    </div>

    <el-dialog
      v-model="dialogVisible"
      :title="editing ? '编辑设备型号' : '新增设备型号'"
      width="720px"
      append-to-body
      :close-on-click-modal="false"
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-position="top">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="型号 ID" prop="modelId">
              <el-input
                v-model="form.modelId"
                :disabled="editing"
                placeholder="如 wobble-wrist-band"
                :maxlength="64"
                clearable
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="名称" prop="name">
              <el-input v-model="form.name" placeholder="如 不倒翁挥腕环" :maxlength="60" clearable />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="8">
            <el-form-item label="厂商" prop="manufacturer">
              <el-input v-model="form.manufacturer" :maxlength="40" clearable />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="分类" prop="category">
              <el-select v-model="form.category" placeholder="请选择分类" style="width: 100%">
                <el-option v-for="cat in DEVICE_CATEGORIES" :key="cat.value" :label="cat.label" :value="cat.value" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="图标">
              <el-input v-model="form.icon" placeholder="如 ⌚（emoji）" :maxlength="8" clearable />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="连接协议">
              <el-input v-model="form.protocol" placeholder="如 bs-bt91" :maxlength="40" clearable />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="最低版本">
              <el-input v-model="form.minAppVersion" placeholder="如 0.1.0" :maxlength="20" clearable />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="简介">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="3"
            placeholder="面向用户展示的主动训练玩法 / 硬件说明（保持消费版主动发力训练口径）"
            :maxlength="300"
            show-word-limit
          />
        </el-form-item>
        <el-form-item label="能力标签（可复选）">
          <div class="chip-list">
            <el-tag
              v-for="opt in DEVICE_TAGS"
              :key="opt.value"
              v-bind="chipBind(form.capabilityTags.includes(opt.value))"
              class="chip"
              @click="toggleTag(form.capabilityTags, opt.value)"
            >
              {{ opt.label }}
            </el-tag>
          </div>
          <p class="form-tip">能力标签决定该设备在用户端可匹配的游戏范围（设备能力标签需 ⊇ 游戏所需标签）。</p>
        </el-form-item>
        <el-form-item label="配套手柄标签（可复选）">
          <div class="chip-list">
            <el-tag
              v-for="opt in HANDLE_TAGS"
              :key="opt.value"
              v-bind="chipBind(form.supportedHandleTags.includes(opt.value))"
              class="chip"
              @click="toggleTag(form.supportedHandleTags, opt.value)"
            >
              {{ opt.label }}
            </el-tag>
          </div>
          <p class="form-tip">该型号支持的配套手柄，用于展示与筛选辅助信息。</p>
        </el-form-item>
        <el-form-item label="BLE 名称片段">
          <el-select
            v-model="form.namePatterns"
            multiple
            filterable
            allow-create
            default-first-option
            placeholder="输入名称片段后回车创建，可多个"
            style="width: 100%"
          >
            <el-option v-for="p in namePatternSuggestions" :key="p" :label="p" :value="p" />
          </el-select>
          <p class="form-tip">用户端通过蓝牙扫描到的设备名包含这些片段即识别为对应型号。</p>
        </el-form-item>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="支持固件升级">
              <el-switch
                v-model="form.firmwareUpdatable"
                active-text="可升级"
                inactive-text="不可升级"
                inline-prompt
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="状态">
              <el-radio-group v-model="form.status">
                <el-radio value="on">上架（用户端可见）</el-radio>
                <el-radio value="off">下架（暂不展示）</el-radio>
              </el-radio-group>
            </el-form-item>
          </el-col>
        </el-row>
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
.toolbar-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.table-scroll {
  overflow-x: auto;
}

.icon-text {
  font-size: 22px;
  line-height: 1;
}

.name-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.name-line {
  font-weight: 600;
}

.sub-line {
  color: #8593a8;
  font-size: 12px;
  font-family: Consolas, 'Courier New', monospace;
}

.tags-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.muted {
  color: #b6c0cf;
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
</style>
