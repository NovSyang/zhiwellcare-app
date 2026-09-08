<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { connectionManager, sensorService } from '../../app/AppServices'
import DeviceSwitchDialog from '../device/DeviceSwitchDialog.vue'
import { createEmptyBatteryState, getBatteryFillPercent, isLowBatteryPercent } from '../../core/sensor/bsbt91/BsBt91Battery'
import type { SensorConnectionSnapshot } from '../../core/sensor/SensorConnectionManager'
import type { SensorRuntimeSnapshot } from '../../core/sensor/SensorService'

const props = withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })
const snapshot = ref<SensorRuntimeSnapshot>({ state: 'idle', frame: null, gameInput: { x: 0, y: 0, connected: false, calibrated: false, timestamp: 0 }, rateHz: 0, rawHex: '', battery: createEmptyBatteryState() })
const connection = ref<SensorConnectionSnapshot>(connectionManager.getSnapshot())
const connected = computed(() => snapshot.value.state === 'connected')
const configuring = computed(() => snapshot.value.state === 'configuring')
const batteryText = computed(() => snapshot.value.battery.percent === null ? '--%' : `${snapshot.value.battery.percent}%`)
const batteryFillPercent = computed(() => getBatteryFillPercent(snapshot.value.battery.percent))
const batteryLow = computed(() => isLowBatteryPercent(snapshot.value.battery.percent))
const batteryAriaLabel = computed(() => snapshot.value.battery.percent === null ? '设备电量读取中' : `设备电量 ${snapshot.value.battery.percent}%`)
// Compact 模式仍通过完整标签向辅助技术说明连接状态与电量。
const statusAriaLabel = computed(() => {
  if (configuring.value) return '设备初始化中'
  if (!connected.value) return '设备未连接'
  return snapshot.value.battery.percent === null
    ? '设备已连接，电量读取中'
    : `设备已连接，设备电量 ${snapshot.value.battery.percent}%`
})
const open = ref(false)
const showSwitchDialog = ref(false)
const root = ref<HTMLElement | null>(null)
const errorMessage = ref('')
let unsubscribeSensor: (() => void) | null = null
let unsubscribeConnection: (() => void) | null = null

// 顶部状态是日常设备管理入口，连接重试细节始终由管理器执行。
onMounted(() => {
  unsubscribeSensor = sensorService.onSnapshot((next) => { snapshot.value = next })
  unsubscribeConnection = connectionManager.onChanged((next) => { connection.value = next })
  document.addEventListener('pointerdown', closeOnOutside)
  document.addEventListener('keydown', closeOnEscape)
})
onBeforeUnmount(() => { unsubscribeSensor?.(); unsubscribeConnection?.(); document.removeEventListener('pointerdown', closeOnOutside); document.removeEventListener('keydown', closeOnEscape) })

function closeOnOutside(event: PointerEvent): void { if (root.value && !root.value.contains(event.target as Node)) open.value = false }
function closeOnEscape(event: KeyboardEvent): void { if (event.key === 'Escape') { open.value = false; showSwitchDialog.value = false } }
function reconnect(): void { open.value = false; void connectionManager.reconnectNow() }
function switchDevice(): void { open.value = false; showSwitchDialog.value = true }
async function forget(): Promise<void> {
  open.value = false
  if (!window.confirm('确认忘记当前训练设备吗？\n\n忘记后，下次训练需要重新选择设备。活动范围设置和训练历史不会被删除。')) return
  try { await connectionManager.forgetCurrentDevice() }
  catch (error) { errorMessage.value = error instanceof Error ? error.message : String(error) }
}
</script>

<template>
  <!-- 外层只承接全局或页面级布局，内层菜单提供下拉框的定位锚点。 -->
  <div ref="root" class="device-status-root">
    <div class="device-status-menu">
      <button
        class="device-status"
        :class="{ 'device-status--compact': props.compact }"
        :data-connected="connected"
        :aria-expanded="open"
        :aria-label="statusAriaLabel"
        aria-haspopup="menu"
        @click="open = !open"
      >
        <span class="status-dot"></span>
        <!-- 已连接时省略重复文案；断线时必须保留明确提示。 -->
        <span v-if="!props.compact || !connected">{{ connected ? '设备已连接' : configuring ? '设备初始化中…' : props.compact ? '未连接' : '设备未连接' }}</span>
        <span
          v-if="connected"
          class="battery-status"
          :data-low="batteryLow"
          :aria-label="batteryAriaLabel"
        >
          <span class="battery-icon" :style="{ '--battery-fill-width': `${batteryFillPercent}%` }" aria-hidden="true">
            <span class="battery-icon-level"><i></i></span>
          </span>
          <span aria-hidden="true">{{ batteryText }}</span>
        </span>
        <span
          class="device-status-chevron"
          :class="{ 'is-open': open }"
          aria-hidden="true"
        >▲</span>
      </button>

      <div v-if="open" class="device-status-dropdown" role="menu">
        <button class="dropdown-item" role="menuitem" :disabled="!connection.binding" @click="reconnect">重新连接</button>
        <button class="dropdown-item" role="menuitem" @click="switchDevice">更换设备</button>
        <button class="dropdown-item danger-text" role="menuitem" :disabled="!connection.binding" @click="forget">忘记设备</button>
      </div>

      <!-- 错误提示保留在相对定位容器内，兼容训练工具栏中的内嵌实例。 -->
      <p v-if="errorMessage" class="device-status-error">{{ errorMessage }}</p>
    </div>

    <DeviceSwitchDialog
      v-if="showSwitchDialog"
      @close="showSwitchDialog = false"
      @connected="showSwitchDialog = false"
    />
  </div>
</template>
