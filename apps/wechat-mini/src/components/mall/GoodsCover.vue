<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = defineProps<{ image?: string; fallback: string; fit?: 'cover' | 'contain' }>()
const loaded = ref(false)
const failed = ref(false)
const showImage = computed(() => !!props.image && !failed.value)

// 切换商品或图片时，清除上一张图的加载状态。
watch(() => props.image, () => { loaded.value = false; failed.value = false })
</script>

<template>
  <view class="mini-cover goods-cover">
    <text v-if="!showImage || !loaded" class="goods-cover-placeholder">{{ fallback }}</text>
    <image v-if="showImage" :key="image" class="goods-cover-image" :class="{ 'goods-cover-loaded': loaded }"
      :src="image" :mode="fit === 'contain' ? 'aspectFit' : 'aspectFill'"
      @load="loaded = true" @error="failed = true" />
  </view>
</template>

<style>
/* 占位和图片共用固定区域，contain 商品图能完整显示。 */
.goods-cover { position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center; }
.goods-cover-placeholder { font-size: 72px; line-height: 1; }
.goods-cover-image { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; }
.goods-cover-loaded { opacity: 1; }
</style>
