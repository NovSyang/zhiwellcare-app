<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import CenterCalibrationGuide from '../components/calibration/CenterCalibrationGuide.vue'
import MobileTrainingHud from '../components/training/MobileTrainingHud.vue'
import { appLifecycleService, connectionManager, displayService, persistTrainingResult, sensorService, updateInstallGuard } from '../app/AppServices'
import type { GameHudSnapshot } from '../core/game/TrainingGameEvents'
import type { ITrainingGame } from '../core/game/ITrainingGame'
import { pauseReasonAfterBackground, pauseReasonAfterDisconnect, shouldAutoResume, type PauseReason } from '../core/game/TrainingPausePolicy'
import { TrainingReplayRecorder } from '../core/replay/TrainingReplayRecorder'
import type { BaseTrainingResult } from '../core/training/BaseTrainingResult'
import type { TrainingSessionState } from '../core/training/TrainingSessionState'
import { getGameModule } from '../games/GameRegistry'
import { isAndroidNativeRuntime } from '../platform/PlatformRuntime'

type TrainingPreflightState = 'checking-device' | 'device-required' | 'center-guide' | 'ready' | 'playing' | 'recalibrating'

const route = useRoute()
const router = useRouter()
const module = getGameModule(String(route.params.gameId ?? ''))
const gameHost = ref<HTMLElement | null>(null)
const errorMessage = ref('')
const displayMessage = ref('')
const trainingState = ref<TrainingSessionState>('idle')
const preflight = ref<TrainingPreflightState>('checking-device')
const pauseReason = ref<PauseReason>('none')
const connected = ref(false)
const hud = ref<GameHudSnapshot>({ title: '训练准备', metrics: [] })
const canPause = computed(() => preflight.value === 'playing' && (trainingState.value === 'playing' || trainingState.value === 'paused'))
const replayRecorder = new TrainingReplayRecorder(40)
const androidNative = isAndroidNativeRuntime()
let unsubscribe: (() => void) | null = null
let unsubscribeLifecycle: (() => void) | null = null
let game: ITrainingGame<BaseTrainingResult> | null = null
let displayModeEntered = false
let appActive = true
let backgroundedDuringSession = false
let releaseUpdateLock: (() => void) | null = null

if (module?.definition.enabled) {
  game = module.createGame({
    onSessionStateChanged(state: TrainingSessionState) { trainingState.value = state },
    onHudChanged(next: GameHudSnapshot) { hud.value = next },
    onReplayEvent(event) { replayRecorder.recordEvent(event) },
    onCompleted(result: BaseTrainingResult) { void completeTraining(result) },
  })
}

// 通用宿主只分发标准化输入；具体游戏无法访问 BLE 或原始角度数据。
onMounted(async () => {
  releaseUpdateLock = updateInstallGuard.acquire('training')
  if (!module || !module.definition.enabled || !game) {
    await router.replace({ path: '/games', query: { error: 'game-unavailable' } })
    return
  }
  unsubscribeLifecycle = appLifecycleService.onActiveChanged(handleAppActiveChanged)
  unsubscribe = sensorService.onSnapshot((snapshot) => {
    const nextConnected = snapshot.state === 'connected'
    connected.value = nextConnected
    const stateBeforeInput = trainingState.value
    if (preflight.value === 'playing' && !nextConnected && ['countdown', 'playing', 'paused'].includes(stateBeforeInput)) {
      // 只有系统造成的暂停才允许校准后自动恢复，手动暂停优先保留。
      pauseReason.value = pauseReasonAfterDisconnect(pauseReason.value, stateBeforeInput)
      game?.pause()
      preflight.value = 'recalibrating'
    }
    game?.setInput(snapshot.gameInput)
    if (preflight.value === 'playing' && nextConnected && trainingState.value === 'playing') {
      replayRecorder.recordInput(snapshot.gameInput, game?.getTrainingElapsedMs() ?? 0)
    }
    if (preflight.value === 'checking-device' || preflight.value === 'device-required') {
      preflight.value = nextConnected ? 'center-guide' : 'device-required'
    }
  })
  const displayState = await displayService.enterTrainingMode()
  displayModeEntered = true
  const displayWarnings: string[] = []
  if (displayState.native && !displayState.orientationLocked) displayWarnings.push('系统未能锁定横屏，建议将设备横向放置。')
  if (displayState.native && !displayState.systemBarsHidden) displayWarnings.push('系统未能进入完整全屏模式。')
  displayMessage.value = displayWarnings.join(' ')
  // 系统栏隐藏会再次改变 WebView 尺寸，等待两帧后再创建 Pixi Canvas。
  await waitForLayoutStable()
  if (!gameHost.value) { errorMessage.value = '游戏容器尚未创建。'; return }
  try {
    await game.mount(gameHost.value)
    // 每局训练都清除旧 Zero，个人活动范围设置保持不变。
    sensorService.resetCalibration()
    preflight.value = connected.value ? 'center-guide' : 'device-required'
    if (!connected.value) void connectionManager.reconnectNow()
  } catch (error) { errorMessage.value = formatError(error) }
})

onBeforeRouteLeave(() => { game?.abort() })
onBeforeUnmount(() => {
  unsubscribe?.()
  unsubscribeLifecycle?.()
  game?.destroy()
  releaseUpdateLock?.()
  if (displayModeEntered) void displayService.leaveTrainingMode()
})

/** 后台只冻结当前会话；回前台必须使用真实传感器数据重新确认中心。 */
function handleAppActiveChanged(active: boolean): void {
  if (active === appActive) return
  appActive = active
  if (!active) {
    if (preflight.value !== 'playing' || !['countdown', 'playing', 'paused'].includes(trainingState.value)) return
    backgroundedDuringSession = true
    pauseReason.value = pauseReasonAfterBackground(pauseReason.value, trainingState.value)
    game?.pause()
    return
  }
  // 部分 Android 系统会在回前台后恢复系统栏，非阻塞地重新应用训练显示状态。
  if (displayModeEntered) void displayService.refreshTrainingMode()
  if (!backgroundedDuringSession || trainingState.value !== 'paused') return
  backgroundedDuringSession = false
  sensorService.resetCalibration()
  preflight.value = 'recalibrating'
  if (!connected.value) void connectionManager.reconnectNow()
}

/** 等待 Vue DOM 更新和连续两次浏览器布局，确保 Pixi 读取最终视口。 */
async function waitForLayoutStable(): Promise<void> {
  await nextTick()
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

function centerCompleted(): void {
  if (!game) return
  try {
    if (preflight.value === 'recalibrating') {
      preflight.value = 'playing'
      if (shouldAutoResume(pauseReason.value)) {
        game.resume()
        pauseReason.value = 'none'
      }
      return
    }
    preflight.value = 'ready'
    pauseReason.value = 'none'
    replayRecorder.reset()
    game.start()
    preflight.value = 'playing'
  } catch (error) { errorMessage.value = formatError(error) }
}

function retryConnection(): void { errorMessage.value = ''; void connectionManager.reconnectNow() }

function togglePause(): void {
  if (!game) return
  try {
    if (trainingState.value === 'playing') {
      pauseReason.value = 'manual'
      game.pause()
    } else if (trainingState.value === 'paused') {
      game.resume()
      pauseReason.value = 'none'
    }
  } catch (error) { errorMessage.value = formatError(error) }
}

function abort(): void { game?.abort(); void router.push('/games') }

async function completeTraining(result: BaseTrainingResult): Promise<void> {
  if (!module || !game) return
  try {
    await persistTrainingResult({ game: module.definition, result, replay: replayRecorder.finish(result.durationMs), gameConfig: module.getConfigSnapshot() })
    await router.push('/result')
  } catch (error) { errorMessage.value = `训练已完成，但保存历史失败：${formatError(error)}` }
}

function formatError(error: unknown): string { return error instanceof Error ? error.message : String(error) }
</script>

<template>
  <main class="training-shell">
    <!-- 桌面端保留完整工具栏，Android 改用覆盖在画布上的轻量 HUD。 -->
    <header v-if="!androidNative" class="training-toolbar">
      <div><p class="eyebrow">{{ module?.definition.name ?? '训练' }}</p><h1>{{ preflight !== 'playing' ? '训练准备' : hud.title }}</h1><p v-if="hud.subtitle" class="muted small">{{ hud.subtitle }}</p></div>
      <div class="scoreboard"><span v-for="metric in hud.metrics" :key="metric.label">{{ metric.label }} {{ metric.value }}</span><span>{{ trainingState }}</span></div>
      <div class="row training-actions"><button class="button" :disabled="!canPause" @click="togglePause">{{ trainingState === 'paused' ? '继续' : '暂停' }}</button><button class="button danger" @click="abort">结束训练</button></div>
    </header>
    <div ref="gameHost" class="game-host training-host"></div>
    <MobileTrainingHud
      v-if="androidNative"
      :hud="hud"
      :training-state="trainingState"
      :can-pause="canPause"
      :show-metrics="preflight === 'playing'"
      @pause="togglePause"
      @abort="abort"
    />
    <div v-if="preflight !== 'playing'" class="training-overlay">
      <CenterCalibrationGuide v-if="preflight === 'center-guide' || (preflight === 'recalibrating' && connected)" @completed="centerCompleted" />
      <section v-else class="center-guide"><h2>{{ preflight === 'recalibrating' ? '正在恢复设备连接' : '当前设备未连接' }}</h2><p>{{ preflight === 'recalibrating' ? '训练已暂停。设备恢复后请重新确认自然中心；如需手动处理设备，请使用右上角设备状态菜单。' : '系统正在尝试恢复已绑定设备。如需重新连接、更换设备或忘记设备，请使用右上角设备状态菜单。' }}</p><button class="button primary" @click="retryConnection">重新连接</button></section>
    </div>
    <!-- 原生训练提示保持悬浮，不能挤压全屏画布。 -->
    <div class="training-message-stack">
      <p v-if="errorMessage" class="error training-error-hint">{{ errorMessage }}</p>
      <p v-if="displayMessage" class="training-display-hint">{{ displayMessage }}</p>
    </div>
  </main>
</template>
