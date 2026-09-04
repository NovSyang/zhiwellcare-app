<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { sensorService } from '../../app/AppServices'
import { createEmptyBatteryState } from '../../core/sensor/bsbt91/BsBt91Battery'
import type { SensorRuntimeSnapshot } from '../../core/sensor/SensorService'

const emit = defineEmits<{ completed: []; failed: [] }>()
const phase = ref<'guide' | 'calibrating' | 'failed'>('guide')
const snapshot = ref<SensorRuntimeSnapshot>({ state: 'idle', frame: null, gameInput: { x: 0, y: 0, connected: false, calibrated: false, timestamp: 0 }, rateHz: 0, rawHex: '', battery: createEmptyBatteryState() })
const calibration = computed(() => sensorService.motion.getCalibrationSnapshot(snapshot.value.frame?.timestamp ?? Date.now()))
let unsubscribe: (() => void) | null = null
let timeoutId: number | null = null

// 完成判断始终来自真实 GameInput.calibrated，而不是固定等待一秒。
onMounted(() => { unsubscribe = sensorService.onSnapshot((next) => { snapshot.value = next; if (phase.value === 'calibrating' && next.gameInput.calibrated) finish() }) })
onBeforeUnmount(() => { unsubscribe?.(); if (timeoutId !== null) window.clearTimeout(timeoutId) })

function start(): void {
  if (snapshot.value.state !== 'connected') { phase.value = 'failed'; return }
  phase.value = 'calibrating'
  sensorService.resetCalibration()
  sensorService.startCalibration()
  timeoutId = window.setTimeout(() => { if (phase.value === 'calibrating' && !snapshot.value.gameInput.calibrated) { phase.value = 'failed'; emit('failed') } }, 3000)
}
function finish(): void { if (timeoutId !== null) window.clearTimeout(timeoutId); timeoutId = null; phase.value = 'guide'; emit('completed') }
</script>

<template><section class="center-guide"><template v-if="phase === 'guide'"><h2>归零校准</h2><p>请将手部自然放置在设备上，调整到舒适的中心位置。开始后请保持不动约 1 秒。</p><button class="button primary wide" @click="start">开始归零校准</button></template><template v-else-if="phase === 'calibrating'"><h2>请保持当前位置</h2><p>正在确认中心位置……</p><div class="calibration-progress"><span :style="{ width: `${Math.round(calibration.progress * 100)}%` }"></span></div></template><template v-else><h2>归零校准未完成</h2><p>请确认设备连接正常，并重新保持设备中心位置。</p><button class="button primary" @click="start">重新归零校准</button></template></section></template>
