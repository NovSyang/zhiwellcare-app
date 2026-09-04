<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()

/** 本地占位订单结构；后端订单系统接入后改为实时同步（演示环境默认无数据，不做持久化）。 */
interface OrderItem { id: string; title: string; subtitle: string; stateText: string }
const orders = ref<OrderItem[]>([])

function goMall(): void { void router.push('/mall') }
function goBack(): void {
  // 有站内历史则返回上一页，否则回「我的」首页。
  if (window.history.state?.back) router.back()
  else void router.push('/mine')
}
</script>

<template>
  <main class="content-page">
    <header class="subpage-head">
      <button class="button ghost small subpage-back" type="button" @click="goBack">← 返回</button>
      <div class="subpage-head-text">
        <p class="eyebrow">Orders</p>
        <h1>我的订单</h1>
      </div>
    </header>

    <div class="subpage-body">
      <section class="card">
        <div class="section-title">订单聚合</div>
        <p class="muted">硬件实物订单与上门服务订单统一在此展示；后端订单系统接入后，订单状态将实时同步到本页。</p>
        <p class="muted small order-note">当前为演示环境，尚未接入后端订单系统，本页暂无订单数据。</p>
      </section>

      <template v-if="orders.length">
        <div class="card list-card">
          <button v-for="order in orders" :key="order.id" class="list-row" type="button">
            <span class="row-ic" aria-hidden="true">🧾</span>
            <span class="row-main">{{ order.title }}<small>{{ order.subtitle }} · {{ order.stateText }}</small></span>
            <span class="row-arrow" aria-hidden="true">›</span>
          </button>
        </div>
      </template>
      <div v-else class="card empty-state">
        <div class="empty-ic" aria-hidden="true">🧾</div>
        <p>暂无订单</p>
        <button class="button primary" type="button" @click="goMall">去商城逛逛</button>
      </div>

      <p class="compliance-note"><strong>说明：</strong>上门服务订单为居家健身指导服务（非医学服务）；当前为交易演示环境，不产生真实交易。</p>
    </div>
  </main>
</template>

<style scoped>
.subpage-head { display: flex; align-items: center; gap: 14px; margin-bottom: 18px; }
.subpage-back { flex: 0 0 auto; }
.subpage-head-text { min-width: 0; }
.subpage-head-text h1 { margin-bottom: 0; }
.subpage-body { display: flex; flex-direction: column; gap: 16px; }
.order-note { margin-top: 10px; }
</style>
