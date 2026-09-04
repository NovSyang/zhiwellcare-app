<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { updateService } from '../../app/AppServices'
import type { AppUpdateSnapshot } from '../../core/update/AppUpdateService'

// 全局弹窗订阅单例服务，路由切换时不会重复创建下载任务。
const snapshot = ref<AppUpdateSnapshot>(updateService.getSnapshot())
const visible = computed(() => snapshot.value.dialogVisible && snapshot.value.info !== null)
const canDismiss = computed(() => !['downloading', 'installing'].includes(snapshot.value.state))
let unsubscribe: (() => void) | null = null

onMounted(() => {
  unsubscribe = updateService.onSnapshot((next) => { snapshot.value = next })
  window.addEventListener('keydown', handleKeydown)
})
onBeforeUnmount(() => {
  unsubscribe?.()
  window.removeEventListener('keydown', handleKeydown)
})

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && visible.value && canDismiss.value) updateService.dismissDialog()
}

function dismiss(): void { if (canDismiss.value) updateService.dismissDialog() }
function updateNow(): void { void updateService.downloadAndInstall() }
function install(): void { void updateService.installUpdate() }
function retry(): void { void updateService.checkForUpdate(true) }
function allowInstall(): void { void updateService.openInstallPermissionSettings() }
function formatSize(value: number | null): string { return value === null ? '未知' : `${(value / 1024 / 1024).toFixed(1)} MB` }
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="update-dialog-backdrop" role="presentation" @click.self="dismiss">
      <section class="update-dialog" role="dialog" aria-modal="true" aria-labelledby="update-dialog-title">
        <header>
          <div><p class="eyebrow">Application Update</p><h2 id="update-dialog-title">发现 ZhiWellCare 新版本</h2></div>
          <button class="button" :disabled="!canDismiss" aria-label="关闭更新弹窗" @click="dismiss">关闭</button>
        </header>
        <div class="update-dialog-body">
          <p>当前版本 {{ snapshot.info?.currentVersion }} → 新版本 {{ snapshot.info?.displayVersion }}</p>
          <p class="muted">文件大小：{{ formatSize(snapshot.info?.sizeBytes ?? null) }}</p>
          <ul v-if="snapshot.info?.notes.length" class="update-notes"><li v-for="note in snapshot.info.notes" :key="note">{{ note }}</li></ul>
          <p v-else class="muted">本次更新暂无详细说明。</p>
          <div v-if="snapshot.progress" class="update-progress" aria-label="更新下载进度">
            <span :style="{ width: `${snapshot.progress.percent ?? 0}%` }"></span>
          </div>
          <p v-if="snapshot.progress" class="muted small">{{ snapshot.progress.percent === null ? '正在下载…' : `${snapshot.progress.percent}%` }}</p>
          <p v-if="snapshot.state === 'waiting-install' && !snapshot.installSafe" class="muted">训练或标定结束后将继续安装。</p>
          <p v-if="snapshot.errorMessage" class="error">{{ snapshot.errorMessage }}</p>
        </div>
        <footer class="row">
          <button v-if="canDismiss" class="button" @click="dismiss">稍后更新</button>
          <button v-if="snapshot.installPermission === 'denied'" class="button primary" @click="allowInstall">允许安装更新</button>
          <button v-else-if="snapshot.state === 'available'" class="button primary" @click="updateNow">立即更新</button>
          <button v-else-if="snapshot.state === 'downloaded' || snapshot.state === 'waiting-install'" class="button primary" :disabled="!snapshot.installSafe" @click="install">安装</button>
          <button v-else-if="snapshot.state === 'error'" class="button primary" @click="retry">重新检查</button>
          <button v-else-if="snapshot.state === 'downloading' || snapshot.state === 'installing'" class="button primary" disabled>{{ snapshot.state === 'downloading' ? '下载中' : '安装中' }}</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
