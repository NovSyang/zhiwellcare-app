<script setup lang="ts">
import { ROM_DIRECTION_ORDER, type MotionRange } from '@/shared/core'
import { rangeDirections } from './RangeDirections'

// 未测量和已测出 0° 分开处理，数值统一保留一位小数。
defineProps<{ range: MotionRange | null }>()
</script>

<template>
  <view class="mini-metrics mini-range-values">
    <view v-for="direction in ROM_DIRECTION_ORDER" :key="direction" class="mini-metric">
      <text class="mini-metric-value">{{ range ? range[rangeDirections[direction].key].toFixed(1) + '°' : '--' }}</text>
      <text class="mini-metric-label">{{ rangeDirections[direction].label }}</text>
    </view>
  </view>
</template>

<style>
/* 窄屏保持两列，数值和方向不会挤出卡片。 */
.mini-metrics.mini-range-values { grid-template-columns: repeat(2, minmax(0, 1fr)); }
</style>
