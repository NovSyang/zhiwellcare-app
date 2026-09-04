<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { connectionManager, sensorService } from '../../app/AppServices'
import type { SensorDevice } from '../../core/sensor/SensorDevice'
import type { SensorRuntimeSnapshot } from '../../core/sensor/SensorService'
import { createEmptyBatteryState } from '../../core/sensor/bsbt91/BsBt91Battery'

type DeviceConnectionMode = 'initial' | 'replace'

const props = withDefaults(defineProps<{ mode?: DeviceConnectionMode }>(), { mode: 'initial' })
const emit = defineEmits<{ connected: []; error: [message: string] }>()
const devices = ref<SensorDevice[]>([])
const selectedDeviceId = ref('')
const snapshot = ref<SensorRuntimeSnapshot>({ state: 'idle', frame: null, gameInput: { x: 0, y: 0, connected: false, calibrated: false, timestamp: 0 }, rateHz: 0, rawHex: '', battery: createEmptyBatteryState() })
const scanning = ref(false)
const busy = ref(false)
const errorMessage = ref('')
const connected = computed(() => snapshot.value.state === 'connected')
let unsubscribe: (() => void) | null = null

// 面板只调用连接管理器，避免页面分别管理扫描、绑定和底层连接。
onMounted(async () => {
  unsubscribe = sensorService.onSnapshot((next) => { snapshot.value = next })
  // 已有绑定时优先等待后台恢复，避免首次设置面板取消启动连接工作流。
  if (props.mode === 'replace' || (!connected.value && !connectionManager.getSnapshot().binding)) await scan()
})
onBeforeUnmount(() => unsubscribe?.())

async function scan(): Promise<void> {
  scanning.value = true; errorMessage.value = ''
  try {
    devices.value = await connectionManager.discoverDevicesForSelection()
    if (devices.value.length === 1) selectedDeviceId.value = devices.value[0].id
    if (devices.value.length === 0) errorMessage.value = '未发现训练设备，请确认设备已开启后重试。'
  }
  catch (error) { setError(error) }
  finally { scanning.value = false }
}
async function connect(): Promise<void> {
  const device = devices.value.find((item) => item.id === selectedDeviceId.value)
  if (!device) return
  busy.value = true; errorMessage.value = ''
  try {
    if (props.mode === 'replace') await connectionManager.switchDevice(device)
    else await connectionManager.connect(device)
    emit('connected')
  }
  catch (error) { setError(error) }
  finally { busy.value = false }
}
function setError(error: unknown): void { errorMessage.value = error instanceof Error ? error.message : String(error); emit('error', errorMessage.value) }
</script>

<template><section class="card device-connection-panel"><template v-if="connected && mode === 'initial'"><p class="success-text">训练设备已连接</p><button class="button primary" @click="emit('connected')">继续</button></template><template v-else><p class="muted">{{ mode === 'replace' ? '请选择要替换为的新训练设备。' : '请选择并连接用于训练的设备。' }}</p><div class="row"><button class="button" :disabled="scanning || busy" @click="scan">{{ scanning ? '搜索设备中…' : '扫描设备' }}</button></div><select v-model="selectedDeviceId" class="select"><option value="">请选择设备</option><option v-for="device in devices" :key="device.id" :value="device.id">{{ device.name }} · {{ device.address || device.id }}</option></select><button class="button primary wide" :disabled="!selectedDeviceId || busy" @click="connect">{{ busy ? '连接中…' : mode === 'replace' ? '连接此设备' : '连接并继续' }}</button></template><p v-if="errorMessage" class="error">{{ errorMessage }}</p></section></template>
