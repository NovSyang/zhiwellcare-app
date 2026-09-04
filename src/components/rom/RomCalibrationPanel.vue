<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { sensorService } from '../../app/AppServices'
import type { MotionRange } from '../../core/motion/MotionConfig'
import { RomCalibrator } from '../../core/motion/RomCalibrator'
import { ROM_DIRECTION_ORDER, type RomDirection } from '../../core/motion/RomCalibrationState'

const emit = defineEmits<{ completed: [range: MotionRange]; cancelled: [] }>()
const calibrator = new RomCalibrator()
const snapshot = ref(calibrator.getSnapshot(Date.now()))
const ready = ref(false)
const errorMessage = ref('')
const direction = computed(() => snapshot.value.direction)
let timer: number | null = null
let unsubscribe: (() => void) | null = null

// ROM 面板只收集四方向范围，保存 Profile 与路由跳转交给调用页面决定。
onMounted(() => { calibrator.prepare(); refresh(); unsubscribe = sensorService.onSnapshot((sensor) => { ready.value = sensor.state === 'connected' && sensor.gameInput.calibrated; if (sensor.frame) calibrator.addSample(sensorService.motion.getRelativeMotion(sensor.frame), sensor.frame.timestamp) }); timer = window.setInterval(() => { if (snapshot.value.state === 'measuring') { calibrator.complete(Date.now()); refresh() } }, 50) })
onBeforeUnmount(() => { unsubscribe?.(); if (timer !== null) window.clearInterval(timer) })

function start(item: RomDirection): void { if (!ready.value) { errorMessage.value = '请先完成中心校准。'; return }; errorMessage.value = ''; calibrator.start(item, Date.now()); refresh() }
function accept(): void { if (!calibrator.accept()) { errorMessage.value = snapshot.value.result?.message ?? '请重新测量。'; return }; const range = calibrator.getMeasuredRange(); refresh(); if (range) emit('completed', range) }
function retry(): void { calibrator.retry(); refresh() }
function refresh(): void { snapshot.value = calibrator.getSnapshot(Date.now()) }
function label(item: RomDirection): string { return { forward: '向前', backward: '向后', left: '向左', right: '向右' }[item] }
</script>

<template><section class="card rom-panel"><template v-if="snapshot.state === 'ready'"><h2>设置个人活动范围</h2><p class="muted">请以舒适、安全的活动范围为准。</p><div class="row"><button v-for="item in ROM_DIRECTION_ORDER" :key="item" class="button primary" @click="start(item)">{{ label(item) }}</button></div></template><template v-else-if="snapshot.state === 'measuring'"><h2>当前：{{ direction && label(direction) }}</h2><p>采集中 {{ Math.min(100, Math.round(snapshot.elapsedMs / 30)) }}% · 有效样本 {{ snapshot.sampleCount }}</p></template><template v-else-if="snapshot.state === 'review'"><h2>{{ snapshot.result?.valid ? '测量结果' : '需要重新测量' }}</h2><p>{{ snapshot.result?.measuredRom.toFixed(1) }}° · {{ snapshot.result?.validSamples }} 个有效样本</p><p v-if="snapshot.result?.message" class="error">{{ snapshot.result.message }}</p><div class="row"><button class="button primary" :disabled="!snapshot.result?.valid" @click="accept">接受</button><button class="button" @click="retry">重新测量</button></div></template></section><p v-if="errorMessage" class="error">{{ errorMessage }}</p><button class="button danger" @click="emit('cancelled')">取消</button></template>
