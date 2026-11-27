<script setup lang="ts">
import { computed, ref } from 'vue'
import Taro from '@tarojs/taro'
import { connectionSnapshot, interactionsBlocked, updateState, version } from '../../app/MiniServices'
import { navigateMini, useMiniTabPage } from '../../app/MiniPageSafety'
import { miniUpdateStatusText } from '../../app/MiniUpdatePresentation'
import MiniPageHeader from '../../components/app/MiniPageHeader.vue'
import MiniTabScrollBody from '../../components/app/MiniTabScrollBody.vue'

defineOptions({ name: 'ProfilePage' })
const { viewport, scrollStyle, fallbackPageScroll } = useMiniTabPage('pages/profile/index')
const navigating = ref(false)
const error = ref('')

// 首页只提供导航，训练历史等数据进入对应分包后再读取。
const links = computed(() => [
  { url: '/features/profile/settings/index', icon: '⚙', title: '训练设置', detail: `设备管理 · 个人活动范围 · ${connectionSnapshot.value.binding?.name || '未绑定设备'}` },
  { url: '/features/history/overview/index', icon: '▤', title: '训练历史', detail: '查看训练成绩及回放' },
  { url: '/features/profile/update/index', icon: '↻', title: '检查更新', detail: `${version.value.displayLabel} · ${miniUpdateStatusText(updateState.value, true)}` },
  { url: '/features/profile/privacy/index', icon: '🔒', title: '隐私政策', detail: '数据用途与隐私保护说明' },
])

async function open(url: string) {
  if (interactionsBlocked.value || navigating.value) return
  navigating.value = true
  error.value = ''
  try { await navigateMini(() => Taro.navigateTo({ url })) }
  catch { error.value = '暂时无法打开该页面，请重试。' }
  finally { navigating.value = false }
}
</script>

<template>
  <view class="mini-tab-page" :class="{ 'mini-tab-page--fallback': fallbackPageScroll }" :style="viewport">
    <view id="mini-tab-header" class="mini-tab-header">
      <MiniPageHeader title="我的" />
    </view>
    <MiniTabScrollBody :fallback="fallbackPageScroll" :scroll-style="scrollStyle">
      <view class="mini-card mini-profile-links">
        <button v-for="link in links" :key="link.url" class="mini-profile-link" :disabled="interactionsBlocked || navigating" @tap="open(link.url)">
          <text class="mini-profile-icon" aria-hidden="true">{{ link.icon }}</text>
          <view class="mini-profile-copy">
            <text class="mini-card-title">{{ link.title }}</text>
            <text class="mini-description">{{ link.detail }}</text>
          </view>
          <text class="mini-profile-chevron" aria-hidden="true">›</text>
        </button>
      </view>
      <text v-if="error" class="mini-error">{{ error }}</text>
    </MiniTabScrollBody>
  </view>
</template>

<style>
/* 原生按钮提供整行触区，长设备名可以随正文换行。 */
.mini-profile-links { padding: 0 24px; }
.mini-profile-links .mini-profile-link {
  display: flex;
  align-items: center;
  gap: 22px;
  width: 100%;
  margin: 0;
  min-height: 120px;
  padding: 20px 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  text-align: left;
  color: var(--c-ink);
}
.mini-profile-links .mini-profile-link + .mini-profile-link { border-top: 1px solid var(--c-line); }
.mini-profile-icon {
  display: flex;
  flex: 0 0 66px;
  align-items: center;
  justify-content: center;
  height: 66px;
  border-radius: 20px;
  background: var(--c-primary-soft);
  color: var(--c-primary);
  font-size: 34px;
}
.mini-profile-copy { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.mini-profile-copy .mini-description { margin-top: 4px; }
.mini-profile-chevron { flex-shrink: 0; color: var(--c-ink-2); font-size: 44px; }
</style>
