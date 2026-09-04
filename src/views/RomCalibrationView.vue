<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import CenterCalibrationGuide from '../components/calibration/CenterCalibrationGuide.vue'
import RomCalibrationPanel from '../components/rom/RomCalibrationPanel.vue'
import { motionProfileService, updateInstallGuard } from '../app/AppServices'
import { profileFromMeasuredRange } from '../core/motion/MotionProfile'
import type { MotionRange } from '../core/motion/MotionConfig'

const router = useRouter()
const route = useRoute()
const phase = ref<'center' | 'rom'>('center')
const errorMessage = ref('')
const source = computed(() => route.query.source === 'settings' ? 'settings' : 'setup')
let releaseUpdateLock: (() => void) | null = null

/** ?return= 完整路径优先（例如游戏页引导首次设定后回到该训练）；默认保留 source 语义。 */
const returnTarget = computed<string | null>(() => {
  const value = route.query.return
  if (typeof value !== 'string' || !value) return null
  return value.startsWith('/') && !value.startsWith('//') ? value : null
})
const exitTarget = computed(() => returnTarget.value ?? (source.value === 'settings' ? '/mine/settings' : '/games'))

// 整个挥腕范围设定流程禁止启动安装器，避免中心或样本采集被系统页面中断。
onMounted(() => { releaseUpdateLock = updateInstallGuard.acquire('rom-calibration') })
onBeforeUnmount(() => releaseUpdateLock?.())

// 从设置重新设定时，旧 Profile 一直保留到四方向全部完成并保存。
function centerCompleted(): void { phase.value = 'rom' }
async function completed(range: MotionRange): Promise<void> {
  try { await motionProfileService.save(profileFromMeasuredRange(range, motionProfileService.getCurrent())); await router.replace(exitTarget.value) }
  catch (error) { errorMessage.value = error instanceof Error ? error.message : String(error) }
}
function cancel(): void { void router.replace(exitTarget.value) }
</script>

<template><main class="content-page"><p class="eyebrow">挥腕范围设定</p><h1>{{ phase === 'center' ? '归零校准' : '挥腕范围设定' }}</h1><CenterCalibrationGuide v-if="phase === 'center'" @completed="centerCompleted" /><RomCalibrationPanel v-else @completed="completed" @cancelled="cancel" /><p v-if="errorMessage" class="error">{{ errorMessage }}</p></main></template>
