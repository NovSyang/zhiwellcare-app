<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { SystemBars, SystemBarsStyle, SystemBarType } from '@capacitor/core'
import { RouterView } from 'vue-router'
import { useRoute, useRouter } from 'vue-router'
import { appLifecycleService, backButtonService, connectionManager, initializeAppServices, motionProfileService, sensorService, transport, updateInstallGuard, updateService } from './app/AppServices'
import DeviceConnectionLoading from './components/app/DeviceConnectionLoading.vue'
import DeviceConnectionStatus from './components/app/DeviceConnectionStatus.vue'
import UpdateDialog from './components/update/UpdateDialog.vue'
import AppTabBar from './components/layout/AppTabBar.vue'
import InitialRangeSetupPrompt from './components/rom/InitialRangeSetupPrompt.vue'
import { InitialRangePromptSession } from './core/motion/InitialRangePromptSession'
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
const showInitialRangePrompt = ref(false)
const rangePromptSession = new InitialRangePromptSession()
const sensorConnected = ref(false)
let unsubscribeBack: (() => void) | null = null
let unsubscribeUpdateLifecycle: (() => void) | null = null
let unsubscribeRangePromptSensor: (() => void) | null = null
let startupUpdateTimer: number | null = null
let rangePromptOverlayObserver: MutationObserver | null = null
let releaseRangePromptUpdateLock: (() => void) | null = null

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
watch(() => route.fullPath, () => {
  void syncSystemBars()
  // 主动进入测量页也视为本次会话已处理，取消后不会立刻再次弹出首次提示。
  if (route.path === '/calibration') rangePromptSession.markHandled()
  syncInitialRangePrompt()
}, { immediate: true })

/** 设备连接与全局弹窗状态变化时重新判断首次提示。 */
function syncInitialRangePrompt(): void {
  const blockingOverlayVisible = document.querySelector('.device-dialog-backdrop, .update-dialog-backdrop') !== null
  const shouldShow = rangePromptSession.shouldShow({
    connected: sensorConnected.value,
    profile: motionProfileService.getCurrent(),
    route: { path: route.path, immersive: hideChrome.value },
    blockingOverlayVisible,
  })
  if (!shouldShow) {
    if (showInitialRangePrompt.value) closeInitialRangePrompt(false)
    return
  }
  if (showInitialRangePrompt.value) return
  showInitialRangePrompt.value = true
  releaseRangePromptUpdateLock ??= updateInstallGuard.acquire('initial-range-setup-prompt')
}

function closeInitialRangePrompt(markHandled: boolean): void {
  if (markHandled) rangePromptSession.markHandled()
  showInitialRangePrompt.value = false
  releaseRangePromptUpdateLock?.()
  releaseRangePromptUpdateLock = null
}

function postponeInitialRangeSetup(): void {
  closeInitialRangePrompt(true)
}

async function startInitialRangeSetup(): Promise<void> {
  rangePromptSession.markHandled()
  showInitialRangePrompt.value = false
  try {
    await router.push('/calibration?source=setup')
    // 等待校准页面挂载并接管安装锁，避免导航交接期间短暂弹出更新窗口。
    await nextTick()
  } finally {
    // 校准页面会接管更新安装锁，此处在导航完成后释放提示锁。
    releaseRangePromptUpdateLock?.()
    releaseRangePromptUpdateLock = null
  }
}

// 全局只初始化一次服务，页面切换不会中断 BLE 监听或丢失当前 Profile。
onMounted(async () => {
  try { await initializeAppServices() }
  catch (error) { startupError.value = error instanceof Error ? error.message : String(error) }
  // MutationObserver 可覆盖手动连接与更换设备弹窗，无需让业务组件互相感知。
  rangePromptOverlayObserver = new MutationObserver(syncInitialRangePrompt)
  rangePromptOverlayObserver.observe(document.body, { childList: true, subtree: true })
  unsubscribeRangePromptSensor = sensorService.onSnapshot((snapshot) => {
    sensorConnected.value = snapshot.state === 'connected'
    syncInitialRangePrompt()
  })
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
  unsubscribeRangePromptSensor?.()
  rangePromptOverlayObserver?.disconnect()
  releaseRangePromptUpdateLock?.()
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
    <InitialRangeSetupPrompt
      v-if="showInitialRangePrompt"
      @start="startInitialRangeSetup"
      @later="postponeInitialRangeSetup"
    />
    <UpdateDialog />
  </div>
</template>
