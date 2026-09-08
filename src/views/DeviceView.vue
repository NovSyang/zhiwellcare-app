<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { catalogService, connectionManager, sensorService, syncActiveDeviceToLibrary } from '../app/AppServices'
import { useDeviceLibraryStore, type DeviceLibraryItem } from '../stores/deviceLibrary'
import { catalogSourceStatus } from '../core/catalog/CatalogService'
import type { DeviceModelInfo } from '../core/catalog/DeviceCatalogTypes'
import { tagLabel, type MatchTag } from '../core/catalog/CapabilityTags'
import type { SensorDevice } from '../core/sensor/SensorDevice'
import type { SensorRuntimeSnapshot } from '../core/sensor/SensorService'
import type { SensorConnectionSnapshot } from '../core/sensor/SensorConnectionManager'
import { createEmptyBatteryState, isLowBatteryPercent } from '../core/sensor/bsbt91/BsBt91Battery'
import DeviceConnectDialog from '../components/device/DeviceConnectDialog.vue'
import DeviceRenameDialog from '../components/device/DeviceRenameDialog.vue'
import DeviceManualDialog from '../components/device/DeviceManualDialog.vue'
import DeviceFirmwareDialog from '../components/device/DeviceFirmwareDialog.vue'
import DeviceSelfCheckDialog from '../components/device/DeviceSelfCheckDialog.vue'

const router = useRouter()
const library = useDeviceLibraryStore()

type DialogKind = 'connect' | 'rename' | 'manual' | 'firmware' | 'selfcheck'
interface DialogState { kind: DialogKind; item: DeviceLibraryItem | null }

/** 单例服务订阅的运行时快照；只读展示，避免页面各自建立连接。 */
const runtime = ref<SensorRuntimeSnapshot>({
  state: 'idle',
  frame: null,
  gameInput: { x: 0, y: 0, connected: false, calibrated: false, timestamp: 0 },
  rateHz: 0,
  rawHex: '',
  battery: createEmptyBatteryState(),
})
const connection = ref<SensorConnectionSnapshot>(connectionManager.getSnapshot())
const models = ref<DeviceModelInfo[]>([])

const dialog = ref<DialogState | null>(null)
const notice = ref('')
const pageError = ref('')
const activatingId = ref('')
const removingId = ref('')
let unsubscribeSensor: (() => void) | null = null
let unsubscribeConnection: (() => void) | null = null

const modelById = computed(() => new Map(models.value.map((model) => [model.modelId, model] as const)))
const activeDialog = computed(() => dialog.value?.kind ?? 'none')
const dialogItem = computed(() => dialog.value?.item ?? null)
const catalogLabel = computed(() => {
  const kind = catalogSourceStatus.value.kind
  if (kind === 'http') return '后端目录'
  if (kind === 'http-fallback-mock') return '本地目录（后端回退）'
  return '本地目录'
})

function modelOf(item: DeviceLibraryItem): DeviceModelInfo | null {
  return modelById.value.get(item.modelId) ?? null
}
function iconOf(item: DeviceLibraryItem): string {
  return modelOf(item)?.icon ?? '📡'
}
function capabilityLabels(item: DeviceLibraryItem): string[] {
  return item.capabilityTags.map((tag) => tagLabel(tag as MatchTag))
}

/** 运行时状态只属于当前绑定的那台设备，其余卡片一律按“未连接”展示。 */
function isBound(item: DeviceLibraryItem): boolean {
  return connection.value.binding?.deviceId === item.deviceId
}
function runtimeState(item: DeviceLibraryItem): 'online' | 'connecting' | 'offline' {
  if (!isBound(item)) return 'offline'
  const state = runtime.value.state
  if (state === 'connected') return 'online'
  if (
    state === 'connecting' || state === 'scanning' || state === 'discovering' || state === 'subscribing' || state === 'configuring'
    || connection.value.reconnectState === 'reconnecting'
  ) return 'connecting'
  return 'offline'
}
function stateText(item: DeviceLibraryItem): string {
  if (!isBound(item)) return '未连接'
  if (runtime.value.state === 'configuring') return '设备初始化中…'
  const state = runtimeState(item)
  if (state === 'online') return '在线'
  if (state === 'connecting') return '连接中…'
  return '离线'
}
function dotState(item: DeviceLibraryItem): string {
  return isBound(item) ? runtimeState(item) : 'unbound'
}
function batteryText(item: DeviceLibraryItem): string | null {
  if (!isBound(item) || runtime.value.state !== 'connected') return null
  const percent = runtime.value.battery.percent
  return percent === null ? '电量 --' : `电量 ${percent}%`
}
function batteryLow(): boolean {
  return isLowBatteryPercent(runtime.value.battery.percent)
}

// 页面只订阅单例服务的快照，避免重复创建蓝牙连接。
onMounted(() => {
  unsubscribeSensor = sensorService.onSnapshot((next) => { runtime.value = next })
  unsubscribeConnection = connectionManager.onChanged((next) => { connection.value = next })
  void loadPage()
})
onBeforeUnmount(() => { unsubscribeSensor?.(); unsubscribeConnection?.() })

async function loadPage(): Promise<void> {
  try {
    await library.load()
    models.value = await catalogService.listDeviceModels()
    await syncLibraryWithBinding()
  } catch (error) {
    pageError.value = formatError(error)
  }
}

/** 启动恢复或历史遗留场景下，让设备库与当前绑定保持一致。 */
async function syncLibraryWithBinding(): Promise<void> {
  const binding = connection.value.binding
  if (!binding) return
  const boundItem = library.items.find((item) => item.deviceId === binding.deviceId)
  if (!boundItem || !boundItem.active) await syncActiveDeviceToLibrary()
}

async function activateItem(item: DeviceLibraryItem): Promise<void> {
  activatingId.value = item.deviceId
  pageError.value = ''
  try {
    const device: SensorDevice = { id: item.deviceId, name: item.name, address: item.address }
    const boundId = connection.value.binding?.deviceId ?? null
    if (boundId && boundId !== item.deviceId) await connectionManager.switchDevice(device)
    else await connectionManager.connect(device)
    await syncActiveDeviceToLibrary()
    notice.value = `「${item.alias}」已连接并设为当前运行设备。`
  } catch (error) {
    pageError.value = formatError(error)
  } finally {
    activatingId.value = ''
  }
}

async function reconnectItem(): Promise<void> {
  pageError.value = ''
  activatingId.value = 'reconnect'
  try {
    await connectionManager.reconnectNow()
    await syncActiveDeviceToLibrary()
    notice.value = '已开始重新连接当前设备。'
  } catch (error) {
    pageError.value = formatError(error)
  } finally {
    activatingId.value = ''
  }
}

async function unbindItem(item: DeviceLibraryItem): Promise<void> {
  if (!window.confirm(`确认解绑「${item.alias}」吗？\n\n解绑后会从设备库移除；若该设备正在运行，将同时断开连接。个人训练记录不受影响。`)) return
  removingId.value = item.deviceId
  pageError.value = ''
  try {
    if (isBound(item)) await connectionManager.forgetCurrentDevice()
    await library.remove(item.deviceId)
    notice.value = `已解绑「${item.alias}」。`
  } catch (error) {
    pageError.value = formatError(error)
  } finally {
    removingId.value = ''
  }
}

function openDialog(kind: DialogKind, item: DeviceLibraryItem | null = null): void {
  pageError.value = ''
  notice.value = ''
  dialog.value = { kind, item }
}
function closeDialog(): void { dialog.value = null }
function onDialogConnected(): void {
  dialog.value = null
  notice.value = '设备已连接并登记到设备库，已设为当前运行设备。'
}
function onDialogRenamed(): void {
  dialog.value = null
  notice.value = '设备别名已更新。'
}
function goGames(): void { void router.push('/games') }

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
</script>

<template>
  <main class="content-page device-page">
    <!-- 页头 -->
    <section class="page-hero device-hero">
      <div class="device-hero-copy">
        <p class="eyebrow">Device Hub</p>
        <h1>设备首页</h1>
        <p>连接智为康乐智能训练设备，自动解锁适配游戏。</p>
        <div class="hero-tags">
          <span class="hero-tag" :title="catalogSourceStatus.message">{{ catalogLabel }}</span>
        </div>
      </div>
      <button type="button" class="button hero-games-btn" @click="goGames">全部游戏<span class="hero-games-arrow" aria-hidden="true">→</span></button>
    </section>

    <p v-if="notice" class="page-notice" role="status">{{ notice }}</p>
    <p v-if="pageError" class="error page-error" role="alert">{{ pageError }}</p>

    <!-- 我的设备 -->
    <section class="device-section" aria-labelledby="my-devices-title">
      <div class="section-head">
        <h2 id="my-devices-title" class="section-title">我的设备</h2>
        <span class="muted small">共 {{ library.items.length }} 台 · 数据保存在本机</span>
      </div>

      <div v-if="!library.items.length" class="card empty-state device-empty">
        <div class="empty-ic" aria-hidden="true">📡</div>
        <p>还没有绑定设备，点击下方连接设备</p>
      </div>

      <div v-else class="grid-cards auto device-grid">
        <article v-for="item in library.items" :key="item.deviceId" class="card device-card">
          <header class="device-card-head">
            <span class="device-card-icon" :class="{ 'is-idle': !isBound(item) || runtimeState(item) !== 'online' }" aria-hidden="true">{{ iconOf(item) }}</span>
            <div class="device-card-titles">
              <h3 class="device-card-title">{{ item.alias }}</h3>
              <p class="device-card-sub">{{ item.modelName }}<template v-if="item.address"> · {{ item.address }}</template></p>
            </div>
            <span class="tag-chip" :class="item.active ? 'is-cyan' : 'is-off'">{{ item.active ? '运行中' : '未激活' }}</span>
          </header>

          <div v-if="capabilityLabels(item).length" class="tag-chip-row">
            <span v-for="tag in capabilityLabels(item)" :key="tag" class="tag-chip">{{ tag }}</span>
          </div>

          <div class="runtime-line">
            <span class="runtime-dot" :data-state="dotState(item)" aria-hidden="true"></span>
            <span class="runtime-text">{{ stateText(item) }}</span>
            <span v-if="isBound(item) && connection.reconnectState === 'reconnecting'" class="runtime-sub muted small">自动重连中…</span>
            <span class="runtime-spacer"></span>
            <span v-if="batteryText(item)" class="tag-chip runtime-battery" :class="{ 'is-warn': batteryLow() }">{{ batteryText(item) }}</span>
          </div>

          <div class="device-card-actions">
            <button
              v-if="!item.active"
              type="button"
              class="button primary small"
              :disabled="activatingId === item.deviceId || removingId === item.deviceId"
              @click="activateItem(item)"
            >
              {{ activatingId === item.deviceId ? '连接中…' : '激活连接' }}
            </button>
            <button
              v-if="item.active && isBound(item) && runtimeState(item) === 'offline'"
              type="button"
              class="button small"
              :disabled="activatingId !== '' || removingId !== ''"
              @click="reconnectItem"
            >
              {{ activatingId === 'reconnect' ? '连接中…' : '重新连接' }}
            </button>
            <button type="button" class="button small" :disabled="activatingId !== '' || removingId !== ''" @click="openDialog('rename', item)">重命名</button>
            <button v-if="modelOf(item)" type="button" class="button small" :disabled="activatingId !== '' || removingId !== ''" @click="openDialog('firmware', item)">固件</button>
            <button type="button" class="button small" :disabled="activatingId !== '' || removingId !== ''" @click="openDialog('manual', item)">说明书</button>
            <button type="button" class="button small" :disabled="activatingId !== '' || removingId !== ''" @click="openDialog('selfcheck', item)">故障自检</button>
            <button
              type="button"
              class="button small danger"
              :disabled="removingId === item.deviceId || activatingId !== ''"
              @click="unbindItem(item)"
            >
              {{ removingId === item.deviceId ? '解绑中…' : '解绑' }}
            </button>
          </div>
        </article>
      </div>
    </section>

    <!-- 连接 / 发现区 -->
    <section class="device-section" aria-labelledby="connect-title">
      <div class="section-head">
        <h2 id="connect-title" class="section-title">连接设备</h2>
      </div>
      <section class="card connect-card">
        <p class="muted connect-desc">
          搜索附近的智为康乐训练设备并完成配对，配对成功后自动登记到设备库并设为当前运行设备。
          <template v-if="connection.binding">当前已绑定「{{ connection.binding.name }}」，连接新设备时会自动切换。</template>
        </p>
        <button type="button" class="button primary wide connect-cta" @click="openDialog('connect')">连接新设备</button>
        <p v-if="connection.reconnectState === 'waiting-user' && connection.message" class="connect-message" aria-live="polite">{{ connection.message }}</p>
      </section>
    </section>

    <!-- 合规说明 -->
    <section class="compliance-note" aria-label="产品说明">
      <span class="compliance-ic" aria-hidden="true">ⓘ</span>
      <div class="compliance-copy">
        <p><strong>消费级健身设备：</strong>本设备为面向大众的消费级主动训练硬件，无电机、无被动驱动，每次训练都由你主动发力完成。</p>
        <p><strong>产品定位：</strong>仅用于日常健身与锻炼，非医疗用途产品，不做疾病防治相关功能；如有健康疑问请咨询专业人士，训练请量力而行。</p>
        <p class="small">目录来源：{{ catalogLabel }} —— 设备型号与游戏目录由智为康乐服务端下发，服务端不可用时自动回退本地目录。</p>
      </div>
    </section>

    <!-- 弹窗 -->
    <DeviceConnectDialog v-if="activeDialog === 'connect'" @close="closeDialog" @connected="onDialogConnected" />
    <DeviceRenameDialog v-if="activeDialog === 'rename' && dialogItem" :item="dialogItem" @close="closeDialog" @saved="onDialogRenamed" />
    <DeviceManualDialog v-if="activeDialog === 'manual' && dialogItem" :item="dialogItem" @close="closeDialog" />
    <DeviceFirmwareDialog v-if="activeDialog === 'firmware' && dialogItem" :item="dialogItem" :model="modelOf(dialogItem)" @close="closeDialog" />
    <DeviceSelfCheckDialog v-if="activeDialog === 'selfcheck' && dialogItem" :item="dialogItem" @close="closeDialog" />
  </main>
</template>

<style scoped>
.device-page { display: flex; flex-direction: column; gap: 18px; }

/* 页头 */
.device-hero { display: flex; align-items: center; justify-content: space-between; gap: 18px; flex-wrap: wrap; margin-bottom: 0; }
.device-hero-copy { flex: 1; min-width: min(280px, 100%); }
.device-hero .hero-tags { margin-top: 10px; }
.hero-games-btn {
  flex: 0 0 auto;
  background: rgba(255, 255, 255, .96);
  border: 0;
  color: var(--c-primary-dark);
  box-shadow: 0 10px 24px rgba(3, 42, 134, .24);
}
.hero-games-btn:hover:not(:disabled) { color: var(--c-primary); border: 0; filter: brightness(1.03); }
.hero-games-arrow { margin-left: 4px; font-weight: 800; }

.page-notice { margin: 0; padding: 10px 14px; border-radius: 12px; background: rgba(42, 171, 107, .1); color: #1e7f4f; font-size: 13px; }
.page-error { margin: 0; padding: 10px 14px; border-radius: 12px; background: var(--c-danger-soft); }

/* 区块标题 */
.device-section { display: flex; flex-direction: column; gap: 12px; }
.section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.section-head .section-title { margin: 0; font-size: 17px; }

/* 设备卡片 */
.device-grid { grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
.device-card { display: flex; flex-direction: column; gap: 12px; }
.device-card-head { display: flex; align-items: center; gap: 12px; min-width: 0; }
.device-card-head .tag-chip { flex: 0 0 auto; }
.device-card-titles { flex: 1; min-width: 0; }
.device-card-titles h3 { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.device-card-titles p { margin: 2px 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.runtime-line { display: flex; align-items: center; gap: 8px; }
.runtime-spacer { flex: 1; }
.runtime-dot { width: 9px; height: 9px; flex: 0 0 auto; border-radius: 50%; background: var(--c-ink-3); }
.runtime-dot[data-state="online"] { background: var(--c-accent); box-shadow: 0 0 0 3px rgba(42, 171, 107, .16); }
.runtime-dot[data-state="connecting"] { background: #e29b32; box-shadow: 0 0 0 3px rgba(226, 155, 50, .16); animation: runtime-pulse 1.2s ease-in-out infinite; }
.runtime-dot[data-state="offline"] { background: var(--c-danger); box-shadow: 0 0 0 3px rgba(204, 51, 64, .12); }
.runtime-dot[data-state="unbound"] { background: var(--c-ink-3); }
.runtime-text { font-size: 13px; color: var(--c-ink-2); font-weight: 600; }
.runtime-sub { margin: 0; }
.runtime-battery { font-weight: 600; }
@keyframes runtime-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: .4; }
}

.device-card-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 2px; }

/* 连接 / 发现区 */
.connect-card { display: flex; flex-direction: column; gap: 12px; }
.connect-desc { margin: 0; font-size: 13px; line-height: 1.8; }
.connect-cta { margin-top: 2px; }
.connect-message { margin: 0; padding: 10px 12px; border-radius: 10px; background: var(--c-warn-bg); color: var(--c-warn-ink); font-size: 13px; }

/* 合规说明 */
.compliance-ic { flex: 0 0 auto; color: var(--c-primary); }
.compliance-copy { flex: 1; min-width: 0; }
.compliance-copy p { margin: 0 0 4px; }
.compliance-copy p:last-child { margin-bottom: 0; }

/* 空态 emoji 由全局 .empty-state 承接 */

@media (max-width: 767px) {
  .hero-games-btn { width: 100%; }
}
</style>
