<script setup lang="ts">
// 测量失败时把同一份页面内容交给微信原生页面滚动。
defineProps<{ fallback: boolean; scrollStyle?: { height: string } }>()
</script>

<template>
  <view v-if="fallback" class="mini-page mini-tab-content">
    <slot />
  </view>
  <scroll-view v-else :scroll-y="true" class="mini-tab-scroll" :style="scrollStyle">
    <view class="mini-page mini-tab-content">
      <slot />
    </view>
  </scroll-view>
</template>
