<script setup lang="ts">
import { RouterLink, useRoute } from 'vue-router'

/** 5 大底部导航：设备首页｜训练游戏｜课程训练｜商城｜我的（手机/平板/桌面共用）。 */
const tabs = [
  { path: '/devices', label: '设备', icon: '⌚', title: '设备首页' },
  { path: '/games', label: '训练', icon: '🎯', title: '训练游戏' },
  { path: '/courses', label: '课程', icon: '📚', title: '课程训练' },
  { path: '/mall', label: '商城', icon: '🛍️', title: '商城' },
  { path: '/mine', label: '我的', icon: '👤', title: '我的' },
] as const

const route = useRoute()

function isActive(path: string): boolean {
  return route.path === path || route.path.startsWith(`${path}/`)
}
</script>

<template>
  <nav class="app-tabbar" aria-label="主导航">
    <div class="app-tabbar-inner">
      <RouterLink
        v-for="tab in tabs"
        :key="tab.path"
        :to="tab.path"
        class="app-tab"
        :class="{ 'is-active': isActive(tab.path) }"
      >
        <span class="tab-ic" aria-hidden="true">{{ tab.icon }}</span>
        <span>{{ tab.label }}</span>
      </RouterLink>
    </div>
  </nav>
</template>
