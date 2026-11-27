<script setup lang="ts">
import { computed, ref } from 'vue'
import Taro from '@tarojs/taro'
import { mallCategories, mallGoods } from '@/shared/mall'

defineOptions({ name: 'ShopPage' })

const category = ref<'all' | 'hardware' | 'service'>('all')
const products = computed(() => mallGoods.filter((item) => category.value === 'all' || item.kind === category.value))

// 展示原 APP 的产品目录及演示价格，详情只接受已知的商品 ID。
function openProduct(id: string) {
  void Taro.navigateTo({ url: `/features/content/goods/index?id=${encodeURIComponent(id)}` })
}
</script>

<template>
  <view class="mini-page">
    <text class="mini-hero">商城</text>
    <view class="mini-filters">
      <button v-for="item in mallCategories" :key="item.id" size="mini" :class="{ 'mini-primary': category === item.id }" @tap="category = item.id">
        {{ item.label }}
      </button>
    </view>
    <view v-for="product in products" :key="product.id" class="mini-card" @tap="openProduct(product.id)">
      <image v-if="product.coverImage" class="mini-cover" :src="product.coverImage" :mode="product.coverFit === 'cover' ? 'aspectFill' : 'aspectFit'" />
      <text class="mini-card-title">{{ product.name }}</text>
      <text class="mini-description">{{ product.summary }}</text>
      <text class="mini-description mini-price">演示价 ¥{{ product.price }}/{{ product.priceUnit }}</text>
    </view>
  </view>
</template>
