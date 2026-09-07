<script setup lang="ts">
import type { GameHudSnapshot } from '../../core/game/TrainingGameEvents'
import type { TrainingSessionState } from '../../core/training/TrainingSessionState'
import DeviceConnectionStatus from '../app/DeviceConnectionStatus.vue'

defineProps<{
  hud: GameHudSnapshot
  trainingState: TrainingSessionState
  canPause: boolean
  showMetrics: boolean
}>()

const emit = defineEmits<{
  pause: []
  abort: []
}>()
</script>

<template>
  <!-- 移动端 HUD 只覆盖在画布上，不参与游戏区域的尺寸计算。 -->
  <div class="mobile-training-hud">
    <div v-if="showMetrics" class="mobile-training-hud__metrics">
      <span
        v-for="metric in hud.metrics"
        :key="metric.label"
        class="training-hud-pill"
      >
        {{ metric.label }} {{ metric.value }}
      </span>
    </div>

    <div class="mobile-training-hud__actions">
      <DeviceConnectionStatus compact />
      <!-- 准备和重校准阶段隐藏暂停按钮，避免用户误以为游戏已经开始。 -->
      <button
        v-if="canPause"
        class="mobile-training-action"
        type="button"
        @click="emit('pause')"
      >
        {{ trainingState === 'paused' ? '继续' : '暂停' }}
      </button>
      <button
        class="mobile-training-action mobile-training-action--danger"
        type="button"
        @click="emit('abort')"
      >
        结束
      </button>
    </div>
  </div>
</template>
