<script setup lang="ts">
import { ref } from 'vue'
import Taro from '@tarojs/taro'
import { interactionsBlocked } from '../../../app/MiniServices'
import { withMiniOperationLock } from '../../../app/MiniPageSafety'

defineOptions({ name: 'MiniPrivacyPolicyPage' })

const opening = ref(false)
const error = ref('')

async function openPrivacyGuide() {
  if (interactionsBlocked.value || opening.value) return
  error.value = ''
  if (typeof Taro.openPrivacyContract !== 'function') {
    error.value = '当前微信版本无法打开隐私保护指引。'
    return
  }
  opening.value = true
  try {
    // Taro 4.3.3 通过回调报告结果，回调结束前一直持有业务锁。
    await withMiniOperationLock('微信隐私保护指引', () => new Promise<void>((resolve, reject) => {
      Taro.openPrivacyContract({ success: () => resolve(), fail: reject })
    }))
  } catch { error.value = '暂时无法打开微信隐私保护指引，请稍后再试。' }
  finally { opening.value = false }
}
</script>

<template>
  <view class="mini-page">
    <!-- 用途与本机存储及在线目录的实际请求范围一致。 -->
    <view class="mini-card">
      <text class="mini-card-title">设备和个人活动范围</text>
      <text class="mini-description">设备绑定和个人活动范围保存在当前手机的微信中，用于重新连接训练设备及应用个人训练范围。可在设备页忘记设备，在训练设置恢复默认范围。</text>
    </view>
    <view class="mini-card">
      <text class="mini-card-title">训练成绩与回放</text>
      <text class="mini-description">腕部姿态用于本机训练与回放。训练成绩和动作回放保存在当前手机的微信中，可在训练历史详情删除对应记录及回放。</text>
    </view>
    <view class="mini-card">
      <text class="mini-card-title">在线目录</text>
      <text class="mini-description">启用在线目录时，小程序请求公开的设备型号和游戏目录。</text>
      <button :disabled="interactionsBlocked || opening" @tap="openPrivacyGuide">{{ opening ? '正在打开…' : '查看微信隐私保护指引' }}</button>
      <text v-if="error" class="mini-error">{{ error }}</text>
    </view>
  </view>
</template>
