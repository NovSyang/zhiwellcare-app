<script setup lang="ts">
import { computed, ref } from 'vue'
import Taro, { useDidShow } from '@tarojs/taro'
import { buildTrainingHistoryGroups, type TrainingRecord } from '@/shared/core'
import { connectionSnapshot, getTrainingRepository, interactionsBlocked } from '../../app/MiniServices'
import { navigateMini, useMiniTabPage, withMiniOperationLock } from '../../app/MiniPageSafety'
import MiniPageHeader from '../../components/app/MiniPageHeader.vue'
import MiniTabScrollBody from '../../components/app/MiniTabScrollBody.vue'
import MiniUpdateSettingsCard from '../../components/app/MiniUpdateSettingsCard.vue'
import TrainingGameHistoryCard from '../../components/history/TrainingGameHistoryCard.vue'

defineOptions({ name: 'ProfilePage' })
const { viewport, scrollStyle, fallbackPageScroll } = useMiniTabPage('pages/profile/index')

const records = ref<TrainingRecord[]>([])
const groups = computed(() => buildTrainingHistoryGroups(records.value))
const loading = ref(false)
const error = ref('')
const privacyError = ref('')

// 回到此页时重新读取本地摘要，反映详情页删除等操作。
useDidShow(async () => {
  loading.value = true
  error.value = ''
  try { records.value = await getTrainingRepository().getAll() } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '读取训练历史失败。'
  } finally { loading.value = false }
})

// 使用历史里的游戏 ID，已下架游戏也能进入记录列表。
async function openHistory(gameId: string) {
  error.value = ''
  try {
    await navigateMini(() => Taro.navigateTo({ url: `/features/history/list/index?gameId=${encodeURIComponent(gameId)}` }))
  } catch {
    error.value = '暂时无法打开游戏历史，请重试。'
  }
}

/** 正式隐私指引由微信平台提供，本页也保留离线可读的数据说明。 */
async function openPrivacyGuide() {
  if (interactionsBlocked.value) return
  privacyError.value = ''
  if (typeof Taro.openPrivacyContract !== 'function') {
    privacyError.value = '当前微信版本无法打开隐私保护指引。'
    return
  }
  try {
    // Taro 4.3.3 的隐私接口通过回调报告结果。
    await withMiniOperationLock('微信隐私保护指引', () => new Promise<void>((resolve, reject) => {
      Taro.openPrivacyContract({ success: () => resolve(), fail: reject })
    }))
  }
  catch { privacyError.value = '暂时无法打开微信隐私保护指引，请稍后再试。' }
}

function openSettings(device: boolean) {
  void navigateMini(() => device ? Taro.switchTab({ url: '/pages/device/index' })
    : Taro.navigateTo({ url: '/features/settings/range/index' }))
    .catch(() => { error.value = '暂时无法打开训练设置，请重试。' })
}
</script>

<template>
  <view class="mini-tab-page" :class="{ 'mini-tab-page--fallback': fallbackPageScroll }" :style="viewport">
    <view id="mini-tab-header" class="mini-tab-header">
      <MiniPageHeader title="我的" />
    </view>
    <MiniTabScrollBody :fallback="fallbackPageScroll" :scroll-style="scrollStyle">
        <view class="mini-card">
          <text class="mini-card-title">训练设置</text>
          <text class="mini-description">当前设备 {{ connectionSnapshot.binding?.name ?? '未绑定' }}</text>
          <button :disabled="interactionsBlocked" @tap="openSettings(true)">设备管理</button>
          <button :disabled="interactionsBlocked" @tap="openSettings(false)">个人活动范围</button>
        </view>
        <view class="mini-card">
          <text class="mini-card-title">本地训练历史</text>
          <text v-if="loading" class="mini-description">正在读取训练记录…</text>
          <text v-else-if="error" class="mini-error">{{ error }}</text>
          <text v-else-if="!groups.length" class="mini-description">暂无训练记录。</text>
          <text v-else class="mini-description">共 {{ records.length }} 次训练</text>
        </view>
        <TrainingGameHistoryCard v-for="group in groups" :key="group.gameId" :group="group" selectable @select="openHistory" />
        <MiniUpdateSettingsCard />
        <!-- 按当前实际存储和请求范围说明数据用途。 -->
        <view class="mini-card">
          <text class="mini-card-title">数据与隐私</text>
          <text class="mini-description">设备绑定、个人活动范围、训练成绩和动作回放保存在本机微信中。可在设备页忘记设备，或在历史详情删除成绩及回放。</text>
          <text class="mini-description">启用在线目录时，只请求公开的设备型号和游戏目录。腕部姿态和训练记录仅用于本机训练与回放。</text>
          <button :disabled="interactionsBlocked" @tap="openPrivacyGuide">查看微信隐私保护指引</button>
          <text v-if="privacyError" class="mini-error">{{ privacyError }}</text>
        </view>
    </MiniTabScrollBody>
  </view>
</template>
