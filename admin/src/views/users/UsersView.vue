<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../../api/http'

interface AdminUser {
  id: string
  phone: string
  nickname: string
  role: string
  status: number
  createdAt: string
  lastLoginAt?: string | null
}

interface UserPage {
  items: AdminUser[]
  total: number
}

const rows = ref<AdminUser[]>([])
const total = ref(0)
const loading = ref(false)

const keyword = ref('')
const statusFilter = ref(-1)
const page = ref(1)
const pageSize = ref(20)

onMounted(() => { void load() })

async function load(): Promise<void> {
  loading.value = true
  try {
    const params = new URLSearchParams()
    params.set('keyword', keyword.value.trim())
    params.set('status', String(statusFilter.value))
    params.set('page', String(page.value))
    params.set('pageSize', String(pageSize.value))
    const data = await api.get<UserPage>(`/admin/users?${params.toString()}`)
    rows.value = data.items
    total.value = data.total
  } catch (e) {
    // 401/403（普通账号误入等）会带 message，统一用其提示
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
  keyword.value = ''
  statusFilter.value = -1
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

async function toggleStatus(row: AdminUser): Promise<void> {
  const next = row.status === 1 ? 0 : 1
  if (next === 0) {
    try {
      await ElMessageBox.confirm('禁用后该用户将无法登录，确认？', '禁用确认', {
        type: 'warning',
        confirmButtonText: '禁用',
        cancelButtonText: '取消',
      })
    } catch {
      return
    }
  }
  try {
    await api.patch(`/admin/users/${row.id}/status`, { status: next })
    row.status = next
    ElMessage.success(next === 0 ? '已禁用该用户' : '已启用该用户')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '操作失败，请稍后重试')
  }
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

function roleInfo(role: string): { type: 'warning' | 'info'; text: string } {
  return role === 'admin' ? { type: 'warning', text: '管理员' } : { type: 'info', text: '用户' }
}

function statusInfo(status: number): { type: 'success' | 'danger'; text: string } {
  return status === 1 ? { type: 'success', text: '正常' } : { type: 'danger', text: '禁用' }
}
</script>

<template>
  <div>
    <el-card class="page-card" shadow="never">
      <div class="table-toolbar">
        <div class="toolbar-filters">
          <el-input
            v-model="keyword"
            placeholder="手机号 / 昵称（模糊）"
            clearable
            class="filter-input"
            @keyup.enter="search"
          />
          <el-select v-model="statusFilter" class="status-select">
            <el-option label="全部状态" :value="-1" />
            <el-option label="正常" :value="1" />
            <el-option label="禁用" :value="0" />
          </el-select>
        </div>
        <div class="toolbar-actions">
          <el-button type="primary" @click="search">查询</el-button>
          <el-button @click="reset">重置</el-button>
        </div>
      </div>

      <p class="form-tip phone-tip">手机号为完整明文展示，仅供管理员在本后台查看（用户端始终为脱敏号码）。</p>

      <el-table :data="rows" v-loading="loading" row-key="id">
        <el-table-column label="昵称" min-width="140">
          <template #default="{ row }">{{ row.nickname || '—' }}</template>
        </el-table-column>
        <el-table-column label="手机号" min-width="150">
          <template #default="{ row }">
            <span class="mono">{{ row.phone || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="角色" width="100">
          <template #default="{ row }">
            <el-tag :type="roleInfo(row.role).type" size="small">{{ roleInfo(row.role).text }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="statusInfo(row.status).type" size="small">{{ statusInfo(row.status).text }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="注册时间" min-width="160">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="最近登录" min-width="160">
          <template #default="{ row }">{{ formatDateTime(row.lastLoginAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status === 1" link type="danger" @click="toggleStatus(row)">禁用</el-button>
            <el-button v-else link type="success" @click="toggleStatus(row)">启用</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无用户" :image-size="90" />
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
  </div>
</template>

<style scoped>
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
.status-select {
  width: 130px;
}
.phone-tip {
  margin: -4px 0 12px;
}
.mono {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 12px;
}
</style>
