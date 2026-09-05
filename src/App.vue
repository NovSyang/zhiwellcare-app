<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { SystemBars, SystemBarsStyle, SystemBarType } from '@capacitor/core'
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

/** 一级 Hero 页面使用深色背景，状态栏需要浅色图标保证可读。 */
const darkStatusBarRoutes = new Set(['/devices', '/games', '/courses', '/mall', '/mine'])

/** 沉浸路由（训练/结果全屏）：隐藏全局连接胶囊与底部 Tab。 */
const hideChrome = computed(() => route.meta.hideChrome === true)
const mobileTrainingLayout = computed(() => androidNative && route.meta.trainingLayout === true)
let unsubscribeBack: (() => void) | null = null
let unsubscribeUpdateLifecycle: (() => void) | null = null
let startupUpdateTimer: number | null = null

/** Edge-to-Edge 下根据页面顶部/底部背景设置系统栏图标明暗。 */
async function syncSystemBars(): Promise<void> {
  if (!androidNative) return
  const darkTopBackground = hideChrome.value || darkStatusBarRoutes.has(route.path)
  await Promise.allSettled([
    SystemBars.setStyle({
      bar: SystemBarType.StatusBar,
      style: darkTopBackground ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
    }),
    SystemBars.setStyle({
      bar: SystemBarType.NavigationBar,
      style: hideChrome.value ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
    }),
  ])
}

// 路由切换时同步系统栏，避免透明状态栏上的图标与页面背景对比不足。
watch(() => route.fullPath, () => { void syncSystemBars() }, { immediate: true })

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
  <div
    class="app-shell"
    :class="{
      'app-shell--immersive': hideChrome,
      'app-shell--native-training': mobileTrainingLayout,
    }"
  >
    <DeviceConnectionStatus v-if="!hideChrome" class="global-connection" />
    <DeviceConnectionLoading v-if="!hideChrome" />

    <!-- 仅内容区滚动，避免根文档与固定导航一起产生 WebView 拉伸。 -->
    <div class="app-scroll">
      <p v-if="startupError" class="error app-error">{{ startupError }}</p>
      <RouterView :class="{ 'native-training-route': mobileTrainingLayout }" />
    </div>

    <AppTabBar v-if="!hideChrome" />
    <UpdateDialog />
  </div>
</template>
