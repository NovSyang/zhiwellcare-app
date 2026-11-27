<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
import Taro, { useDidHide, useDidShow, useUnload } from '@tarojs/taro'
import type { MotionProfile } from '@/shared/core'
import { connectionSnapshot, initializeMiniServices, interactionsBlocked, motionProfileService } from '../../../app/MiniServices'
import { navigateMini, withMiniOperationLock } from '../../../app/MiniPageSafety'
import MiniRangeValues from '../../../components/calibration/MiniRangeValues.vue'

defineOptions({ name: 'MiniTrainingSettingsPage' })

const profile = shallowRef<MotionProfile>()
const loading = ref(true)
const working = ref(false)
const error = ref('')
const trainingRatio = computed(() => profile.value ? `${Math.round(profile.value.trainingRatio * 1000) / 10}%` : '')
let revision = 0
let visible = false

// 从测量页返回时读取已生效的 Profile，启动阶段等本地配置加载完成。
async function refresh() {
  const current = ++revision
  loading.value = true
  error.value = ''
  try {
    await initializeMiniServices()
    if (current === revision) profile.value = motionProfileService.getCurrent()
  } catch (failure) {
    if (current === revision) error.value = failure instanceof Error ? failure.message : '读取个人活动范围失败。'
  } finally { if (current === revision) loading.value = false }
}
useDidShow(() => { visible = true; void refresh() })
function hide() { visible = false; revision += 1 }
useDidHide(hide)
useUnload(hide)

async function open(device: boolean) {
  if (working.value || interactionsBlocked.value) return
  working.value = true
  error.value = ''
  try {
    await navigateMini(() => device ? Taro.switchTab({ url: '/pages/device/index' })
      : Taro.navigateTo({ url: '/features/settings/range/index' }))
  } catch { error.value = '暂时无法打开该页面，请重试。' }
  finally { working.value = false }
}

async function reset() {
  if (!profile.value || working.value || loading.value || interactionsBlocked.value) return
  const current = revision
  working.value = true
  error.value = ''
  try {
    await withMiniOperationLock('恢复默认范围', async () => {
      const answer = await Taro.showModal({ title: '恢复默认范围', content: '恢复后，个人实测范围将清除，训练将使用默认范围。' })
      if (!answer.confirm || current !== revision || interactionsBlocked.value) return
      const result = await motionProfileService.reset()
      // 写入期间若页面已回到前台，直接显示最新已生效的范围。
      if (visible) profile.value = result
    })
  } catch (failure) {
    if (current === revision) error.value = failure instanceof Error ? failure.message : '恢复默认范围失败，请重试。'
  } finally { working.value = false }
}
</script>

<template>
  <view class="mini-page">
    <view class="mini-card">
      <text class="mini-card-title">设备管理</text>
      <text class="mini-description">当前设备 {{ connectionSnapshot.binding?.name || '未绑定' }}</text>
      <button :disabled="working || interactionsBlocked" @tap="open(true)">前往设备管理</button>
    </view>
    <view class="mini-card">
      <text class="mini-card-title">个人活动范围</text>
      <text v-if="loading" class="mini-description">正在读取个人活动范围…</text>
      <template v-else-if="profile">
        <text class="mini-description">实测范围</text>
        <MiniRangeValues :range="profile.measuredRange" />
        <text v-if="profile.measuredRange === null" class="mini-description">尚未完成个人活动范围测量。</text>
        <text class="mini-description">当前训练范围 · 训练比例 {{ trainingRatio }}</text>
        <MiniRangeValues :range="profile.activeRange" />
        <button class="mini-primary" :disabled="working || interactionsBlocked" @tap="open(false)">
          {{ profile.measuredRange ? '重新测量个人活动范围' : '开始测量个人活动范围' }}
        </button>
        <button :disabled="working || interactionsBlocked" @tap="reset">恢复默认范围</button>
      </template>
      <button v-else :disabled="working || interactionsBlocked" @tap="refresh">重新读取</button>
      <text v-if="error" class="mini-error">{{ error }}</text>
    </view>
  </view>
</template>
