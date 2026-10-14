<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { updateService } from '../../app/AppServices'
import type { AppUpdateSnapshot } from '../../core/update/AppUpdateService'
import type { UpdatePolicy } from '../../core/update/UpdatePolicy'
import { formatVersionLabel } from '../../core/version/AppVersion'
import { UPDATE_CHANNEL } from '../../platform/update/UpdateEndpoints'

// 设置卡片只操作统一更新服务，不直接调用具体平台插件。
const snapshot = ref<AppUpdateSnapshot>(updateService.getSnapshot())
const busy = computed(() => ['checking', 'downloading', 'installing'].includes(snapshot.value.state))
const canOpenDetails = computed(() => snapshot.value.info !== null)
// 优先显示原生实际版本；Web 等环境尚未初始化时使用统一发布元数据。
const currentVersionLabel = computed(() => formatVersionLabel(snapshot.value.currentVersion || undefined))
const internalBuild = String(UPDATE_CHANNEL) === 'staging'
let unsubscribe: (() => void) | null = null

onMounted(() => {
  unsubscribe = updateService.onSnapshot((next) => { snapshot.value = next })
  void updateService.initialize()
})
onBeforeUnmount(() => unsubscribe?.())

function changePolicy(event: Event): void {
  void updateService.setPolicy((event.target as HTMLSelectElement).value as UpdatePolicy)
}

function check(): void { void updateService.checkForUpdate(true) }
function openDetails(): void { updateService.showDialog() }
function allowInstall(): void { void updateService.openInstallPermissionSettings() }

function statusText(): string {
  const labels: Record<AppUpdateSnapshot['state'], string> = {
    idle: '尚未检查', checking: '正在检查更新…', 'up-to-date': '已是最新版本', available: '发现新版本',
    downloading: '正在下载更新…', downloaded: '更新已下载', 'waiting-install': '等待安全时机安装',
    'waiting-permission': '等待允许安装更新', installed: '安装已完成，重启后确认版本',
    installing: '正在启动系统安装器…', unsupported: '当前环境不支持在线更新', error: '更新操作失败',
  }
  return labels[snapshot.value.state]
}
</script>

<template>
  <section class="card update-settings-card">
    <h2>关于与更新</h2>
    <div class="update-version-row"><span>当前版本</span><strong>{{ currentVersionLabel }}</strong></div>
    <p v-if="internalBuild" class="error">内部验证版</p>
    <label class="update-policy-field">
      <span>更新方式</span>
      <select class="select" :value="snapshot.policy" @change="changePolicy">
        <option value="silent">自动检查并下载</option>
        <option value="prompt">提醒更新</option>
        <option value="manual">手动检查</option>
      </select>
    </label>
    <p v-if="snapshot.policy === 'silent'" class="muted small">自动下载后在训练或标定结束时安装，安装仍需按系统要求确认。</p>
    <p class="muted">更新状态：{{ statusText() }}</p>
    <p v-if="snapshot.errorMessage" class="error">{{ snapshot.errorMessage }}</p>
    <p v-if="snapshot.platform === 'android'" class="muted small">
      安装更新权限：{{ snapshot.installPermission === 'denied' ? '未允许' : '已允许' }}
    </p>
    <div class="row">
      <button class="button primary" :disabled="busy || snapshot.state === 'unsupported'" @click="check">检查更新</button>
      <button v-if="canOpenDetails" class="button" @click="openDetails">查看更新</button>
      <button v-if="snapshot.platform === 'android' && snapshot.state === 'waiting-permission' && snapshot.installPermission === 'denied'" class="button" @click="allowInstall">允许安装更新</button>
    </div>
  </section>
</template>
