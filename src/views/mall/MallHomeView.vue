<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { findGoodsById, mallCategories, mallGoods, readMallCart, writeMallCart } from '../../data/mall'
import type { Goods, MallCartItem } from '../../data/mall'

type CategoryId = 'all' | 'hardware' | 'service'

const router = useRouter()

const activeCategory = ref<CategoryId>('all')
const cartItems = ref<MallCartItem[]>([])
const cartOpen = ref(false)
const cartNote = ref('')

const filteredGoods = computed(() =>
  activeCategory.value === 'all' ? mallGoods : mallGoods.filter((goods) => goods.kind === activeCategory.value),
)
const cartCount = computed(() => cartItems.value.reduce((sum, item) => sum + item.quantity, 0))
const cartTotal = computed(() =>
  cartItems.value.reduce((sum, item) => {
    const goods = findGoodsById(item.productId)
    return sum + (goods ? goods.price * item.quantity : 0)
  }, 0),
)

onMounted(refreshCart)

function refreshCart(): void {
  cartItems.value = readMallCart()
}

function openCart(): void {
  cartNote.value = ''
  refreshCart()
  cartOpen.value = true
}

function removeFromCart(productId: string): void {
  cartItems.value = cartItems.value.filter((item) => item.productId !== productId)
  writeMallCart(cartItems.value)
}

function clearCart(): void {
  cartItems.value = []
  writeMallCart([])
}

function showCheckoutNote(): void {
  cartNote.value = '当前为演示环境：不会产生真实订单与扣款；正式版接入 Golang 后端订单系统与支付后开放结算。'
}

function goDetail(goods: Goods): void {
  void router.push(`/mall/product/${goods.id}`)
}

function isService(goods: Goods): boolean {
  return goods.kind === 'service'
}

function kindLabel(goods: Goods): string {
  return goods.kind === 'hardware' ? '硬件' : '服务'
}
</script>

<template>
  <main class="content-page">
    <div class="page-hero">
      <div class="mall-hero-row">
        <div class="mall-hero-copy">
          <p class="eyebrow">ZhiWellCare Mall</p>
          <h1>商城</h1>
          <p>智能训练硬件 × 居家健身指导服务</p>
        </div>
        <button type="button" class="mall-cart-button" @click="openCart">
          <span class="mall-cart-icon">🛒</span><span>购物车</span>
          <span v-if="cartCount > 0" class="mall-cart-badge">{{ cartCount }}</span>
        </button>
      </div>
      <div class="hero-tags">
        <span class="hero-tag">实物硬件 · 主动训练设备</span>
        <span class="hero-tag">上门居家健身指导（非医疗服务）</span>
        <span class="hero-tag">演示环境 · 支付未接入</span>
      </div>
    </div>

    <div class="mall-tabs" role="tablist" aria-label="商品分类">
      <button
        v-for="category in mallCategories"
        :key="category.id"
        type="button"
        role="tab"
        class="mall-tab"
        :class="{ 'is-active': activeCategory === category.id }"
        :aria-selected="activeCategory === category.id"
        @click="activeCategory = category.id"
      >{{ category.label }}</button>
    </div>

    <div v-if="filteredGoods.length" class="grid-cards auto mall-goods-grid">
      <article v-for="goods in filteredGoods" :key="goods.id" class="card card-hover goods-card" @click="goDetail(goods)">
        <div class="goods-cover" :class="{ 'is-service': isService(goods) }">
          <span class="mall-kind-chip" :class="{ 'is-service': isService(goods) }">{{ kindLabel(goods) }}</span>
          <span class="mall-cover-emoji" aria-hidden="true">{{ goods.cover }}</span>
          <span class="price-tag">演示价 ¥{{ goods.price }}/{{ goods.priceUnit }}</span>
        </div>
        <h3 class="mall-goods-name">{{ goods.name }}</h3>
        <p class="muted small mall-goods-summary">{{ goods.summary }}</p>
        <div class="tag-chip-row">
          <span v-for="badge in goods.badges" :key="badge" class="tag-chip" :class="{ 'is-cyan': isService(goods) }">{{ badge }}</span>
          <span v-if="goods.relatedHardware" class="tag-chip is-warn">需搭配训练底座</span>
        </div>
        <div class="goods-meta mall-goods-meta">
          <span>{{ isService(goods) ? '上门居家健身指导（非医疗服务）' : '消费级主动训练硬件' }}</span>
        </div>
        <div class="mall-card-footer">
          <span class="goods-price">¥{{ goods.price }}<span class="mall-price-unit">/{{ goods.priceUnit }}</span></span>
          <button type="button" class="button primary small" @click.stop="goDetail(goods)">查看详情</button>
        </div>
      </article>
    </div>

    <div class="compliance-note mall-footer-note">
      <strong>交易与合规说明：</strong>
      <span>商城为统一交易入口的演示版本：购物车与支付均为本地占位，全部价格均为演示价，不产生真实订单与扣款，正式版接入 Golang 后端订单系统与支付后开放下单。上门服务为「上门居家健身指导（非医疗服务）」，由合作服务商承接，APP 内不展示派单 / 工单；硬件为消费级主动训练设备（无医疗器械功能、无被动电机驱动、纯主动发力）。</span>
    </div>

    <Teleport to="body">
      <div v-if="cartOpen" class="device-dialog-backdrop" @click.self="cartOpen = false">
        <section class="device-dialog mall-dialog" role="dialog" aria-modal="true" aria-label="购物车（本地占位）">
          <header>
            <div><p class="eyebrow">本地购物车占位</p><h2>购物车</h2></div>
            <button type="button" class="button" @click="cartOpen = false">关闭</button>
          </header>
          <p class="muted small">购物车数据保存在本机（localStorage），仅供界面演示，不会上传或发起任何网络请求。</p>

          <template v-if="cartItems.length">
            <ul class="mall-cart-list">
              <li v-for="item in cartItems" :key="item.productId" class="mall-cart-row">
                <span class="mall-cart-thumb" aria-hidden="true">{{ findGoodsById(item.productId)?.cover ?? '❓' }}</span>
                <span class="mall-cart-info">
                  <strong>{{ findGoodsById(item.productId)?.name ?? '未知商品' }}</strong>
                  <small>演示价 ¥{{ findGoodsById(item.productId)?.price ?? 0 }}/{{ findGoodsById(item.productId)?.priceUnit ?? '件' }} · ×{{ item.quantity }}</small>
                </span>
                <span class="mall-cart-sub">¥{{ (findGoodsById(item.productId)?.price ?? 0) * item.quantity }}</span>
                <button type="button" class="button small" @click="removeFromCart(item.productId)">移除</button>
              </li>
            </ul>
            <div class="mall-cart-tools">
              <span class="mall-cart-count muted small">共 {{ cartCount }} 件</span>
              <button type="button" class="button small" @click="clearCart">清空购物车</button>
            </div>
            <div class="mall-cart-total"><span>合计（演示价）</span><strong>¥{{ cartTotal }}</strong></div>
          </template>
          <div v-else class="empty-state mall-cart-empty">
            <div class="empty-ic">🛒</div>
            <p>购物车还是空的</p>
            <button type="button" class="button ghost" @click="cartOpen = false">去逛逛</button>
          </div>

          <footer class="mall-cart-actions">
            <button v-if="cartItems.length" type="button" class="button wide primary" disabled>演示环境：支付未接入</button>
            <button v-else type="button" class="button wide" disabled>演示环境：支付未接入</button>
            <button v-if="cartItems.length" type="button" class="button wide ghost" @click="showCheckoutNote">查看结算说明</button>
            <p v-if="cartNote" class="mall-cart-note">{{ cartNote }}</p>
          </footer>
        </section>
      </div>
    </Teleport>
  </main>
</template>

<style scoped>
.mall-hero-row {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
}
.mall-hero-copy { min-width: 0; }
.mall-cart-button {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 2px 0 0 auto;
  padding: 9px 16px;
  border: 1px solid rgba(255, 255, 255, .5);
  border-radius: 999px;
  background: rgba(255, 255, 255, .16);
  color: #fff;
  font-weight: 700;
  font-size: 14px;
  transition: background .15s ease;
}
.mall-cart-button:hover { background: rgba(255, 255, 255, .3); }
.mall-cart-icon { font-size: 17px; line-height: 1; }
.mall-cart-badge {
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: #fff;
  color: var(--c-primary);
  font-size: 12px;
  font-weight: 800;
}

.mall-tabs { display: flex; flex-wrap: wrap; gap: 10px; margin: 4px 0 18px; }
.mall-tab {
  padding: 8px 18px;
  border: 1.5px solid var(--c-line-2);
  border-radius: 999px;
  background: #fff;
  color: var(--c-ink-2);
  font-weight: 600;
  font-size: 14px;
  transition: all .15s ease;
}
.mall-tab:hover { border-color: var(--c-primary); color: var(--c-primary); }
.mall-tab.is-active {
  background: var(--grad-brand-soft);
  border-color: transparent;
  color: #fff;
  box-shadow: 0 8px 18px rgba(13, 180, 204, .25);
}

.mall-goods-grid { margin-bottom: 18px; }
.goods-cover.is-service { background: linear-gradient(150deg, #e6fbf8, #dff3ef); }
.mall-kind-chip {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 1;
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--c-primary);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
}
.mall-kind-chip.is-service { background: #08978b; }
.mall-cover-emoji { font-size: 42px; line-height: 1; }
.mall-goods-name { margin: 2px 0 0; font-size: 16px; line-height: 1.45; }
.mall-goods-summary { flex: 1; margin: 0; }
.mall-goods-meta { margin-top: 2px; }
.mall-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 2px;
}
.mall-price-unit { color: var(--c-ink-3); font-size: 12px; font-weight: 700; }
.mall-footer-note { margin-top: 22px; }

.mall-cart-list { list-style: none; margin: 14px 0 0; padding: 0; display: grid; gap: 10px; }
.mall-cart-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--c-line);
  border-radius: 12px;
  background: var(--c-bg-2);
}
.mall-cart-thumb {
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: linear-gradient(150deg, #eaf3ff, #e6fbf8);
  font-size: 22px;
}
.mall-cart-info { flex: 1; min-width: 0; }
.mall-cart-info strong { display: block; font-size: 14px; line-height: 1.4; }
.mall-cart-info small { display: block; color: var(--c-ink-3); font-size: 12px; }
.mall-cart-sub { color: var(--c-ink-2); font-size: 13px; font-weight: 700; white-space: nowrap; }
.mall-cart-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 12px;
}
.mall-cart-count { margin: 0; }
.mall-cart-total {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px dashed var(--c-line-2);
  color: var(--c-ink-2);
  font-size: 14px;
}
.mall-cart-total strong { color: #e2574c; font-size: 20px; font-weight: 800; }
.mall-cart-actions { display: grid; gap: 10px; margin-top: 14px; }
.mall-cart-note {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--c-line);
  border-left: 4px solid var(--c-primary-2);
  border-radius: 10px;
  background: var(--c-bg-3);
  color: var(--c-ink-2);
  font-size: 12px;
  line-height: 1.7;
}
.mall-cart-empty { padding: 22px 10px; }
</style>
