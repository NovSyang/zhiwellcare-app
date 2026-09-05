<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { motionProfileService } from '../app/AppServices'
import UpdateSettingsCard from '../components/update/UpdateSettingsCard.vue'

const router = useRouter()
const profile = computed(() => motionProfileService.getCurrent())

// Settings 仅保存长期配置；日常设备连接统一由顶部状态菜单处理。
function range(value: number | undefined): string { return value === undefined ? '--' : `${value.toFixed(1)}°` }
</script>

<template><main class="content-page"><p class="eyebrow">Settings</p><h1>设置</h1><section class="card"><h2>个人活动范围</h2><template v-if="profile.measuredRange"><p>实测活动范围：前 {{ range(profile.measuredRange.forwardMax) }} · 后 {{ range(profile.measuredRange.backwardMax) }} · 左 {{ range(profile.measuredRange.leftMax) }} · 右 {{ range(profile.measuredRange.rightMax) }}</p><p class="muted">当前训练范围：前 {{ range(profile.activeRange.forwardMax) }} · 后 {{ range(profile.activeRange.backwardMax) }} · 左 {{ range(profile.activeRange.leftMax) }} · 右 {{ range(profile.activeRange.rightMax) }}</p><p class="muted small">训练比例 {{ (profile.trainingRatio * 100).toFixed(0) }}% · 死区 {{ profile.horizontalDeadZone }}° / {{ profile.verticalDeadZone }}°</p></template><p v-else class="muted">尚未完成个人活动范围测量。</p><button class="button primary" @click="router.push('/calibration?source=settings')">{{ profile.measuredRange ? '重新测量个人活动范围' : '开始个人活动范围测量' }}</button></section><UpdateSettingsCard /><section class="card"><h2>高级</h2><button class="button" @click="router.push('/mine/settings/debug')">开发者诊断</button></section></main></template>
