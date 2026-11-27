<script setup lang="ts">
import { computed, ref } from 'vue'
import Taro from '@tarojs/taro'
import { mallCategories, mallGoods } from '@/shared/mall'
import GoodsCover from '../../components/mall/GoodsCover.vue'
import { navigateMini, useMiniTabPage } from '../../app/MiniPageSafety'
import MiniPageHeader from '../../components/app/MiniPageHeader.vue'

defineOptions({ name: 'ShopPage' })
const viewport = useMiniTabPage('pages/shop/index')

const category = ref<'all' | 'hardware' | 'service'>('all')
const products = computed(() => mallGoods.filter((item) => category.value === 'all' || item.kind === category.value))

// 展示原 APP 的产品目录及演示价格，详情只接受已知的商品 ID。
function openProduct(id: string) {
  void navigateMini(() => Taro.navigateTo({ url: `/features/content/goods/index?id=${encodeURIComponent(id)}` }))
    .catch(() => Taro.showToast({ title: '暂时无法打开商品详情，请重试。', icon: 'none' }))
}
</script>

<template>
  <view class="mini-tab-page" :style="viewport">
    <MiniPageHeader title="商城" />
    <scroll-view scroll-y class="mini-tab-scroll">
      <view class="mini-page mini-tab-content">
        <view class="mini-filters">
          <button v-for="item in mallCategories" :key="item.id" size="mini" :class="{ 'mini-primary': category === item.id }" @tap="category = item.id">
            {{ item.label }}
          </button>
        </view>
        <view v-for="product in products" :key="product.id" class="mini-card" @tap="openProduct(product.id)">
          <!-- 列表和详情使用同一张包内图片及失败占位。 -->
          <GoodsCover :image="product.coverImage" :fallback="product.cover" :fit="product.coverFit" />
          <text class="mini-card-title">{{ product.name }}</text>
          <text class="mini-description">{{ product.summary }}</text>
          <text class="mini-description mini-price">演示价 ¥{{ product.price }}/{{ product.priceUnit }}</text>
        </view>
      </view>
    </scroll-view>
  </view>
</template>
