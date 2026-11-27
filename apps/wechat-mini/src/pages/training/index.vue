<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Taro, { useDidShow } from '@tarojs/taro'
import { connectionSnapshot, deviceBusy, interactionsBlocked, readyForTraining, sensorSnapshot } from '../../app/MiniServices'
import { navigateMini, useMiniTabPage } from '../../app/MiniPageSafety'
import MiniPageHeader from '../../components/app/MiniPageHeader.vue'
import { isMiniTrainingGameId, miniTrainingGames, type MiniTrainingGameId } from '../../app/TrainingGames'
import { getTrainingOffers } from '../../app/TrainingOffers'

defineOptions({ name: 'TrainingPage' })
const viewport = useMiniTabPage('pages/training/index')

const offers = ref<Awaited<ReturnType<typeof getTrainingOffers>>>([])
const cards = computed(() => offers.value.flatMap(({ game, device }) => isMiniTrainingGameId(game.gameId)
  ? [{ game, id: game.gameId, info: miniTrainingGames[game.gameId], matched: device !== null } as const]
  : []))
const error = ref('')
const loading = ref(true)
const entering = ref(false)
const sensorConnected = computed(() => sensorSnapshot.value?.state === 'connected')
let revision = 0

/** 设备状态变化后重新匹配所有已接入的训练，旧请求的结果直接丢弃。 */
async function refresh() {
  const request = ++revision
  loading.value = true
  try {
    const binding = connectionSnapshot.value.binding
    const device = binding && sensorConnected.value ? { id: binding.deviceId, name: binding.name, address: binding.address } : undefined
    const current = await getTrainingOffers(device)
    if (request !== revision) return
    offers.value = current
    error.value = ''
  } catch {
    if (request === revision) error.value = '读取训练目录失败，请重新打开训练页。'
  } finally {
    if (request === revision) loading.value = false
  }
}

/** 训练页还会复核设备与校准，防止离开大厅后状态发生变化。 */
async function openTraining(id: MiniTrainingGameId) {
  if (!readyForTraining.value || !cards.value.some((card) => card.id === id && card.matched)
    || loading.value || entering.value || deviceBusy.value || interactionsBlocked.value) return
  entering.value = true
  try { await navigateMini(() => Taro.navigateTo({ url: `/features/training/session/index?game=${id}` })) } catch {
    error.value = '打开训练失败，请重试。'
  } finally { entering.value = false }
}

function openDevice() {
  void navigateMini(() => Taro.switchTab({ url: '/pages/device/index' }))
    .catch(() => { error.value = '暂时无法打开设备页，请重试。' })
}
useDidShow(() => { void refresh() })
watch([sensorConnected, () => connectionSnapshot.value.binding?.deviceId], () => { void refresh() })
</script>

<template>
  <view class="mini-tab-page" :style="viewport">
    <MiniPageHeader title="训练" />
    <scroll-view scroll-y class="mini-tab-scroll">
      <view class="mini-page mini-tab-content">
        <view v-for="{ game, id, info, matched } in cards" :key="id" class="mini-card">
          <text class="mini-card-title">{{ game.name }}</text>
          <text class="mini-description">{{ game.summary }}</text>
          <text class="mini-description">{{ info.description }}</text>
          <text v-if="loading" class="mini-description">正在核对设备能力…</text>
          <text v-else-if="sensorConnected && !matched" class="mini-description">当前设备未匹配此训练。</text>
          <text v-else-if="readyForTraining" class="mini-description">设备已完成中心校准。</text>
          <text v-else class="mini-description">训练需要兼容的蓝牙设备，并完成中心校准。</text>
          <button v-if="readyForTraining && matched" class="mini-primary" :disabled="loading || entering || deviceBusy || interactionsBlocked" @tap="openTraining(id)">进入训练</button>
          <button v-else class="mini-primary" :disabled="interactionsBlocked" @tap="openDevice">查看设备状态</button>
        </view>
        <text v-if="error" class="mini-error">{{ error }}</text>
        <text v-else-if="!cards.length" class="mini-description">{{ loading ? '正在读取训练目录…' : '当前没有可展示的微信训练。' }}</text>
      </view>
    </scroll-view>
  </view>
</template>
