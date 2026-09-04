<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { updateService } from '../../app/AppServices'
import type { AppUpdateSnapshot } from '../../core/update/AppUpdateService'
import type { UpdatePolicy } from '../../core/update/UpdatePolicy'
import releaseVersion from '../../../release-version.json'

// 设置卡片只操作统一更新服务，不直接调用具体平台插件。
const snapshot = ref<AppUpdateSnapshot>(updateService.getSnapshot())
const busy = computed(() => ['checking', 'downloading', 'installing'].includes(snapshot.value.state))
const canOpenDetails = computed(() => snapshot.value.info !== null)
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
    installing: '正在启动系统安装器…', unsupported: '当前环境不支持在线更新', error: '更新操作失败',
  }
  return labels[snapshot.value.state]
}
</script>

<template>
  <section class="card update-settings-card">
    <h2>关于与更新</h2>
    <div class="update-version-row"><span>当前版本</span><strong>V{{ releaseVersion.displayVersion }}</strong></div>
    <label class="update-policy-field">
      <span>更新方式</span>
      <select class="select" :value="snapshot.policy" @change="changePolicy">
        <option value="silent">无感更新</option>
        <option value="prompt">提醒更新</option>
        <option value="manual">手动检查</option>
      </select>
    </label>
    <p class="muted">更新状态：{{ statusText() }}</p>
    <p v-if="snapshot.errorMessage" class="error">{{ snapshot.errorMessage }}</p>
    <p v-if="snapshot.platform === 'android'" class="muted small">
      安装更新权限：{{ snapshot.installPermission === 'denied' ? '未允许' : '已允许' }}
    </p>
    <div class="row">
      <button class="button primary" :disabled="busy || snapshot.state === 'unsupported'" @click="check">检查更新</button>
      <button v-if="canOpenDetails" class="button" @click="openDetails">查看更新</button>
      <button v-if="snapshot.platform === 'android' && snapshot.installPermission === 'denied'" class="button" @click="allowInstall">允许安装更新</button>
    </div>
  </section>
</template>
