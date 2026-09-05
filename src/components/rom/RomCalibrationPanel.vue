<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { sensorService } from '../../app/AppServices'
import type { MotionRange } from '../../core/motion/MotionConfig'
import { RomCalibrationFlow } from '../../core/motion/RomCalibrationFlow'
import { ROM_DIRECTION_ORDER, type RomDirection } from '../../core/motion/RomCalibrationState'

const emit = defineEmits<{
  completed: [range: MotionRange]
  cancelled: []
  centerRequired: []
}>()

const directionContent: Record<RomDirection, { icon: string; label: string; instructions: string[] }> = {
  forward: { icon: '↑', label: '向前', instructions: ['请从自然中心位置开始，缓慢向前移动至舒适的最大活动位置。', '达到舒适位置后保持，不要突然发力，也不要勉强超过自己的活动范围。'] },
  backward: { icon: '↓', label: '向后', instructions: ['请从自然中心位置开始，缓慢向后移动至舒适的最大活动位置。', '达到舒适位置后保持，如感到不适请立即停止。'] },
  left: { icon: '←', label: '向左', instructions: ['请从自然中心位置开始，缓慢向左移动至舒适的最大活动位置。', '动作保持平稳，避免同时向前或向后偏移。'] },
  right: { icon: '→', label: '向右', instructions: ['请从自然中心位置开始，缓慢向右移动至舒适的最大活动位置。', '动作保持平稳，避免同时向前或向后偏移。'] },
}

const flow = new RomCalibrationFlow()
const snapshot = ref(flow.getSnapshot(Date.now()))
const sensorConnected = ref(false)
const ready = ref(false)
const errorMessage = ref('')
const currentContent = computed(() => directionContent[snapshot.value.currentDirection])
const measurementProgress = computed(() => Math.min(100, Math.round(
  snapshot.value.calibration.elapsedMs / snapshot.value.measurementDurationMs * 100,
)))
let countdownTimer: number | null = null
let measurementTimer: number | null = null
let unsubscribe: (() => void) | null = null
let needsCenterConfirmation = false
let centerRequestEmitted = false

// 传感器状态决定是否允许开始；采样时间戳继续沿用传感器的 Epoch 毫秒。
onMounted(() => {
  unsubscribe = sensorService.onSnapshot((sensor) => {
    sensorConnected.value = sensor.state === 'connected'
    ready.value = sensorConnected.value && sensor.gameInput.calibrated
    const attemptActive = snapshot.value.phase === 'countdown' || snapshot.value.phase === 'measuring'
    if (attemptActive && !ready.value) interruptForConnectionChange()
    if (sensorConnected.value && needsCenterConfirmation && !centerRequestEmitted) requestCenterConfirmation()
    if (ready.value) {
      needsCenterConfirmation = false
      centerRequestEmitted = false
      errorMessage.value = ''
    }
    if (sensor.frame) flow.addSample(sensorService.motion.getRelativeMotion(sensor.frame), sensor.frame.timestamp)
  })
  measurementTimer = window.setInterval(() => {
    if (snapshot.value.phase !== 'measuring') return
    flow.complete(Date.now())
    refresh()
  }, 50)
})

onBeforeUnmount(() => {
  unsubscribe?.()
  clearCountdownTimer()
  if (measurementTimer !== null) window.clearInterval(measurementTimer)
})

function beginCountdown(): void {
  if (!sensorConnected.value) {
    errorMessage.value = '训练设备尚未连接，请重新连接后继续当前方向。'
    needsCenterConfirmation = true
    return
  }
  if (!ready.value) {
    errorMessage.value = '继续测量前需要重新确认自然中心位置。'
    needsCenterConfirmation = true
    requestCenterConfirmation()
    return
  }
  errorMessage.value = ''
  if (!flow.beginCountdown()) return
  refresh()
  clearCountdownTimer()
  countdownTimer = window.setInterval(() => {
    // 临界时刻再次校验设备，确保断线或中心失效时绝不会启动采样。
    if (!ready.value) {
      interruptForConnectionChange()
      return
    }
    const measuringStarted = flow.advanceCountdown(Date.now())
    refresh()
    if (measuringStarted) clearCountdownTimer()
  }, 1000)
}

function interruptForConnectionChange(): void {
  clearCountdownTimer()
  flow.abortCurrentAttempt()
  needsCenterConfirmation = true
  centerRequestEmitted = false
  errorMessage.value = sensorConnected.value
    ? '中心位置状态已失效，请重新确认后测量当前方向。'
    : '设备已断开。重新连接后需要再次确认自然中心位置。'
  refresh()
}

function requestCenterConfirmation(): void {
  if (!sensorConnected.value || centerRequestEmitted) return
  centerRequestEmitted = true
  emit('centerRequired')
}

function accept(): void {
  if (!flow.accept()) {
    errorMessage.value = snapshot.value.calibration.result?.message ?? '请重新测量当前方向。'
    return
  }
  errorMessage.value = ''
  refresh()
}

function retry(): void {
  flow.retry()
  errorMessage.value = ''
  refresh()
}

function finish(): void {
  const range = flow.finish()
  if (range) emit('completed', range)
}

function cancel(): void {
  if (!window.confirm('确认退出个人活动范围测量吗？\n\n本次尚未完成的测量结果不会保存。')) return
  clearCountdownTimer()
  flow.cancel()
  emit('cancelled')
}

function clearCountdownTimer(): void {
  if (countdownTimer !== null) window.clearInterval(countdownTimer)
  countdownTimer = null
}

function refresh(): void {
  snapshot.value = flow.getSnapshot(Date.now())
}

function directionStatus(item: RomDirection): 'completed' | 'current' | 'pending' {
  const index = ROM_DIRECTION_ORDER.indexOf(item)
  if (snapshot.value.phase === 'summary' || index < snapshot.value.currentDirectionIndex) return 'completed'
  return index === snapshot.value.currentDirectionIndex ? 'current' : 'pending'
}

function rangeValue(range: Partial<MotionRange> | MotionRange | null, direction: RomDirection): string {
  if (!range) return '--'
  const key = direction === 'forward' ? 'forwardMax'
    : direction === 'backward' ? 'backwardMax'
      : direction === 'left' ? 'leftMax'
        : 'rightMax'
  const value = range[key]
  return value === undefined ? '--' : `${value.toFixed(1)}°`
}
</script>

<template>
  <div class="rom-flow">
    <ol class="rom-direction-progress" aria-label="测量进度">
      <li
        v-for="item in ROM_DIRECTION_ORDER"
        :key="item"
        :class="`is-${directionStatus(item)}`"
      >
        <span aria-hidden="true">{{ directionStatus(item) === 'completed' ? '✓' : directionStatus(item) === 'current' ? '●' : '○' }}</span>
        {{ directionContent[item].label }}
      </li>
    </ol>

    <section class="card rom-panel" aria-live="polite">
      <template v-if="snapshot.phase === 'guide'">
        <p class="eyebrow">第 {{ snapshot.currentDirectionIndex + 1 }} / {{ snapshot.totalDirections }} 项</p>
        <div class="rom-direction-icon" aria-hidden="true">{{ currentContent.icon }}</div>
        <h2>{{ currentContent.label }}</h2>
        <p v-for="line in currentContent.instructions" :key="line">{{ line }}</p>
        <button type="button" class="button primary wide rom-primary-action" @click="beginCountdown">我准备好了</button>
      </template>

      <template v-else-if="snapshot.phase === 'countdown'">
        <p class="eyebrow">准备测量：{{ currentContent.label }}</p>
        <div class="rom-countdown">{{ snapshot.countdown }}</div>
        <h2>请回到自然中心位置</h2>
        <p>准备好后，缓慢{{ currentContent.label }}移动。</p>
      </template>

      <template v-else-if="snapshot.phase === 'measuring'">
        <p class="eyebrow">正在测量：{{ currentContent.label }}</p>
        <div class="rom-direction-icon is-measuring" aria-hidden="true">{{ currentContent.icon }}</div>
        <h2>缓慢{{ currentContent.label }}移动</h2>
        <p>达到舒适最大位置后保持，请保持设备连接。</p>
        <div class="calibration-progress" role="progressbar" :aria-valuenow="measurementProgress" aria-valuemin="0" aria-valuemax="100">
          <span :style="{ width: `${measurementProgress}%` }"></span>
        </div>
        <strong class="rom-progress-label">{{ measurementProgress }}%</strong>
      </template>

      <template v-else-if="snapshot.phase === 'review'">
        <p class="eyebrow">{{ currentContent.label }}测量结果</p>
        <template v-if="snapshot.calibration.result?.valid">
          <div class="rom-result-value">{{ snapshot.calibration.result.measuredRom.toFixed(1) }}°</div>
          <h2>本次测量有效</h2>
          <div class="rom-review-actions">
            <button type="button" class="button primary" @click="accept">使用本次结果</button>
            <button type="button" class="button" @click="retry">重新测量</button>
          </div>
        </template>
        <template v-else>
          <div class="rom-result-value is-error">未完成</div>
          <h2>本次测量未完成</h2>
          <p class="error">{{ snapshot.calibration.result?.message ?? '有效动作数据不足。' }}</p>
          <button type="button" class="button primary wide rom-primary-action" @click="retry">重新测量</button>
        </template>
      </template>

      <template v-else>
        <p class="eyebrow">个人活动范围</p>
        <h2>测量已完成</h2>
        <div class="rom-summary-grid">
          <div v-for="item in ROM_DIRECTION_ORDER" :key="item">
            <span>{{ directionContent[item].icon }} {{ directionContent[item].label }}</span>
            <strong>{{ rangeValue(snapshot.summary, item) }}</strong>
          </div>
        </div>
        <p>后续训练会在你的舒适活动范围内进行。</p>
        <button type="button" class="button primary wide rom-primary-action" @click="finish">完成并保存</button>
      </template>
    </section>

    <p v-if="errorMessage" class="error rom-flow-error" role="alert">{{ errorMessage }}</p>
    <button type="button" class="button danger rom-cancel" @click="cancel">取消测量</button>
  </div>
</template>

<style scoped>
.rom-flow { width: min(680px, 100%); display: grid; gap: 16px; margin: 18px auto 0; }
.rom-direction-progress { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.rom-direction-progress li { min-width: 0; padding: 9px 6px; border-radius: 10px; background: var(--c-bg-3); color: var(--c-ink-3); font-size: 13px; text-align: center; }
.rom-direction-progress li span { margin-right: 3px; }
.rom-direction-progress .is-current { background: var(--c-primary-soft); color: var(--c-primary); font-weight: 700; }
.rom-direction-progress .is-completed { background: rgba(42, 171, 107, .12); color: var(--c-accent); font-weight: 700; }
.rom-panel { min-height: 390px; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 30px; text-align: center; }
.rom-panel p { max-width: 540px; line-height: 1.75; }
.rom-direction-icon { width: 76px; height: 76px; margin: 8px 0 14px; display: grid; place-items: center; border-radius: 24px; background: var(--grad-brand); color: #fff; font-size: 44px; font-weight: 800; }
.rom-direction-icon.is-measuring { animation: rom-direction-pulse 1s ease-in-out infinite alternate; }
.rom-countdown { margin: 10px 0; color: var(--c-primary); font-size: clamp(64px, 14vw, 92px); font-weight: 800; line-height: 1; }
.rom-result-value { margin: 12px 0; color: var(--c-primary); font-size: 48px; font-weight: 800; line-height: 1.2; }
.rom-result-value.is-error { color: var(--c-danger); font-size: 32px; }
.rom-primary-action { min-height: 50px; margin-top: 18px; }
.rom-review-actions { width: min(420px, 100%); display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 18px; }
.rom-review-actions .button { min-height: 48px; }
.calibration-progress { width: min(460px, 100%); margin-top: 18px; }
.rom-progress-label { margin-top: 8px; color: var(--c-primary); }
.rom-summary-grid { width: min(500px, 100%); display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin: 18px 0; }
.rom-summary-grid div { padding: 14px; border-radius: 12px; background: var(--c-bg-2); }
.rom-summary-grid span, .rom-summary-grid strong { display: block; }
.rom-summary-grid span { color: var(--c-ink-2); font-size: 13px; }
.rom-summary-grid strong { margin-top: 5px; color: var(--c-primary); font-size: 21px; }
.rom-flow-error { margin: 0; text-align: center; }
.rom-cancel { justify-self: center; }

@keyframes rom-direction-pulse { to { transform: scale(1.05); filter: brightness(1.08); } }

@media (max-width: 479px) {
  .rom-direction-progress { gap: 5px; }
  .rom-direction-progress li { padding-inline: 3px; font-size: 12px; }
  .rom-panel { min-height: 360px; padding: 24px 16px; }
  .rom-review-actions, .rom-summary-grid { grid-template-columns: 1fr; }
}
</style>
