<script setup lang="ts">
import { useMiniSafePage } from '../../../app/MiniPageSafety'
import MiniUpdateSettingsCard from '../../../components/app/MiniUpdateSettingsCard.vue'

defineOptions({ name: 'MiniCheckUpdatePage' })

// 本页可提示微信更新，仍需满足同一套可见性和业务锁要求。
useMiniSafePage('features/profile/update/index')
</script>

<template>
  <view class="mini-page">
    <MiniUpdateSettingsCard />
  </view>
</template>
