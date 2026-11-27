import Taro from '@tarojs/taro'
import { createPinia, defineStore, storeToRefs } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import {
  CatalogService, CourseCheckins, createSensorServices, type SensorDevice, type SensorRuntimeSnapshot,
} from '@/shared/core'
import { WeChatBleTransport } from '../platform/ble/WeChatBleTransport'
import { WeChatStorageStore } from '../platform/WeChatStorageStore'
import { WeChatCatalogSource } from '../platform/WeChatCatalogSource'
import { WeChatReplayFiles } from '../platform/storage/WeChatReplayFiles'
import { WeChatTrainingRepository } from '../platform/storage/WeChatTrainingRepository'

// 姿态帧使用 Unix 毫秒，与共享校准链路使用的时间基准一致。
const transport = new WeChatBleTransport(Taro, { nowEpochMs: Date.now })
export const miniStorage = new WeChatStorageStore(Taro)
export const courseCheckins = new CourseCheckins(miniStorage)
export const { connectionManager, motionProfileService, sensorService } = createSensorServices(
  transport,
  miniStorage,
  // 微信返回的设备 ID 不跨手机推断，重连只匹配本机已绑定的 ID。
  (binding, devices) => devices.find(({ id }) => id === binding.deviceId) ?? null,
)
// 仅配置正式 HTTPS 目录地址时启动 HTTP；本地目录仍可离线使用。
const catalogBase = __MINI_CATALOG_BASE_URL__
export const catalogService = new CatalogService(catalogBase
  ? new WeChatCatalogSource(catalogBase, (options) => Taro.request<unknown>(options))
  : undefined)

let historyRepository: WeChatTrainingRepository | null = null
export function getTrainingRepository(): WeChatTrainingRepository {
  const userDataPath = Taro.env.USER_DATA_PATH
  // 只有微信提供可持久化用户目录时才初始化回放文件仓储。
  if (!userDataPath) throw new Error('此环境无法读取微信本地训练文件。')
  historyRepository ??= new WeChatTrainingRepository(
    miniStorage, new WeChatReplayFiles(Taro.getFileSystemManager(), userDataPath),
  )
  return historyRepository
}
// 跨页状态使用 Pinia，蓝牙和存储服务仍由平台入口组装。
export const miniPinia = createPinia()
const useMiniRuntimeStore = defineStore('mini-runtime', () => {
  const foreground = ref(true)
  const sensorSnapshot = shallowRef<SensorRuntimeSnapshot>()
  const connectionSnapshot = shallowRef(connectionManager.getSnapshot())
  const lifecycleError = ref<string | null>(null)
  const readyForTraining = computed(() => foreground.value
    && sensorSnapshot.value?.state === 'connected'
    && sensorSnapshot.value.gameInput.connected
    && sensorSnapshot.value.gameInput.calibrated)
  return { foreground, sensorSnapshot, connectionSnapshot, lifecycleError, readyForTraining }
})
export const { foreground, sensorSnapshot, connectionSnapshot, lifecycleError, readyForTraining } =
  storeToRefs(useMiniRuntimeStore(miniPinia))

let lastUiUpdateAt = 0
sensorService.onSnapshot((snapshot) => {
  const now = Date.now()
  const previous = sensorSnapshot.value
  // 状态变化立即响应，高频姿态数据只在设备界面按 10Hz 刷新。
  if (now - lastUiUpdateAt >= 100 || !previous || previous.state !== snapshot.state
    || previous.gameInput.calibrated !== snapshot.gameInput.calibrated
    || previous.battery.updatedAt !== snapshot.battery.updatedAt) {
    sensorSnapshot.value = snapshot
    lastUiUpdateAt = now
  }
})
connectionManager.onChanged((snapshot) => { connectionSnapshot.value = snapshot })

let initialization: Promise<void> | null = null
let suspendTask: Promise<void> | null = null

/** 打开页面时只恢复本地资料，用户操作后才初始化蓝牙。 */
export function initializeMiniServices(): Promise<void> {
  initialization ??= Promise.all([connectionManager.initialize(), motionProfileService.load()])
    .then(() => undefined)
    .catch((error: unknown) => {
      initialization = null
      throw error
    })
  return initialization
}

export async function scanTrainingDevices(): Promise<SensorDevice[]> {
  await waitForForeground()
  return sensorService.scan()
}

export async function selectTrainingDevice(device: SensorDevice): Promise<void> {
  await waitForForeground()
  if (sensorSnapshot.value?.state === 'connected') {
    if (connectionSnapshot.value.binding?.deviceId !== device.id) await connectionManager.switchDevice(device)
  } else {
    await connectionManager.connect(device)
  }
}

export async function reconnectTrainingDevice(): Promise<void> {
  await waitForForeground()
  await connectionManager.reconnectNow()
}

async function waitForForeground(): Promise<void> {
  await initializeMiniServices()
  await suspendTask
  if (!foreground.value) throw new Error('请回到小程序前台后再操作蓝牙。')
}

/** 后台立即撤销训练资格，销毁会话后由用户重连并重新中心校准。 */
export function suspendMiniServices(): void {
  foreground.value = false
  sensorService.resetCalibration()
  const pending = suspendTask ?? Promise.resolve()
  suspendTask = pending.then(async () => {
    try {
      await connectionManager.disconnectManually()
    } finally {
      await transport.suspend()
    }
  }).catch((error: unknown) => {
    lifecycleError.value = error instanceof Error ? error.message : '蓝牙会话清理失败，请重新连接设备。'
  })
}

export function resumeMiniServices(): void {
  foreground.value = true
}
