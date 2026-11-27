<script setup lang="ts">
import { computed, ref } from 'vue'
import { useLoad } from '@tarojs/taro'
import { findGoodsById } from '@/shared/mall'

defineOptions({ name: 'GoodsDetailPage' })
const id = ref('')
const product = computed(() => findGoodsById(id.value))

// 详情和列表使用同一商品资料，保留原目录的规格和使用说明。
useLoad((options) => { id.value = options.id ?? '' })
</script>

<template>
  <view class="mini-page">
    <template v-if="product">
      <text class="mini-heading">{{ product.name }}</text>
      <view class="mini-card">
        <image v-if="product.coverImage" class="mini-cover" :src="product.coverImage" :mode="product.coverFit === 'cover' ? 'aspectFill' : 'aspectFit'" />
        <text class="mini-card-title">演示价 ¥{{ product.price }}/{{ product.priceUnit }}</text>
        <text class="mini-description">{{ product.summary }}</text>
        <text v-if="product.badges.length" class="mini-description">{{ product.badges.join(' · ') }}</text>
        <text v-if="product.relatedHardware" class="mini-description">需搭配桌面力矩主动训练底座使用。</text>
      </view>
      <view class="mini-card">
        <text class="mini-card-title">{{ product.kind === 'hardware' ? '规格' : '服务内容' }}</text>
        <text v-for="line in product.spec" :key="line" class="mini-description">{{ line }}</text>
      </view>
      <view class="mini-card">
        <text class="mini-card-title">详情</text>
        <text v-for="line in product.detail" :key="line" class="mini-description">{{ line }}</text>
        <text class="mini-description">{{ product.disclaimer }}</text>
      </view>
    </template>
    <text v-else class="mini-description">商品不存在，请返回商城。</text>
  </view>
</template>
