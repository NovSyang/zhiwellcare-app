<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterView } from 'vue-router'
import { useRoute, useRouter } from 'vue-router'
import { appLifecycleService, backButtonService, connectionManager, initializeAppServices, transport, updateService } from './app/AppServices'
import DeviceConnectionLoading from './components/app/DeviceConnectionLoading.vue'
import DeviceConnectionStatus from './components/app/DeviceConnectionStatus.vue'
import UpdateDialog from './components/update/UpdateDialog.vue'
import AppTabBar from './components/layout/AppTabBar.vue'
import { isAndroidNativeRuntime } from './platform/PlatformRuntime'

const startupError = ref('')
const route = useRoute()
const router = useRouter()
const androidNative = isAndroidNativeRuntime()

/** 沉浸路由（训练/结果全屏）：隐藏全局连接胶囊与底部 Tab。 */
const hideChrome = computed(() => route.meta.hideChrome === true)
const mobileTrainingLayout = computed(() => androidNative && route.meta.trainingLayout === true)
let unsubscribeBack: (() => void) | null = null
let unsubscribeUpdateLifecycle: (() => void) | null = null
let startupUpdateTimer: number | null = null

// 全局只初始化一次服务，页面切换不会中断 BLE 监听或丢失当前 Profile。
onMounted(async () => {
  try { await initializeAppServices() }
  catch (error) { startupError.value = error instanceof Error ? error.message : String(error) }
  // 更新检查延后执行，不阻塞首屏、Profile 加载或 BLE 自动连接。
  startupUpdateTimer = window.setTimeout(() => { void updateService.handleStartup() }, 3_000)
  unsubscribeUpdateLifecycle = appLifecycleService.onActiveChanged((active) => {
    if (active) void updateService.refreshInstallPermission()
  })
  // Android Back：训练中先确认，普通页面继续遵守 Vue Router 历史。
  unsubscribeBack = backButtonService.onBack(({ canGoBack }) => {
    if (route.meta.trainingLayout === true) {
      if (window.confirm('确认结束当前训练吗？\n\n当前未完成的训练不会保存。')) void router.push('/games')
      return
    }
    if (canGoBack) router.back()
    else void backButtonService.minimizeApp()
  })
})

onBeforeUnmount(async () => {
  unsubscribeBack?.()
  unsubscribeUpdateLifecycle?.()
  if (startupUpdateTimer !== null) window.clearTimeout(startupUpdateTimer)
  connectionManager.dispose()
  await Promise.allSettled([transport.dispose(), updateService.dispose(), appLifecycleService.dispose(), backButtonService.dispose()])
})
</script>

<template>
  <DeviceConnectionStatus v-if="!hideChrome" class="global-connection" />
  <DeviceConnectionLoading v-if="!hideChrome" />
  <p v-if="startupError" class="error app-error">{{ startupError }}</p>
  <RouterView :class="{ 'native-training-route': mobileTrainingLayout }" />
  <AppTabBar v-if="!hideChrome" />
  <UpdateDialog />
</template>
