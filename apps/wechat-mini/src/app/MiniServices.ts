import Taro from '@tarojs/taro'
import { createPinia, defineStore, storeToRefs } from 'pinia'
import { computed, shallowRef } from 'vue'
import {
  CatalogService, CourseCheckins, createSensorServices, type SensorDevice, type SensorRuntimeSnapshot,
} from '@/shared/core'
import { WeChatBleTransport } from '../platform/ble/WeChatBleTransport'
import { WeChatStorageStore } from '../platform/WeChatStorageStore'
import { WeChatCatalogSource } from '../platform/WeChatCatalogSource'
import { WeChatReplayFiles } from '../platform/storage/WeChatReplayFiles'
import { WeChatTrainingRepository } from '../platform/storage/WeChatTrainingRepository'
import { setTrainingScreenOn } from '../platform/ImmersiveLayout'
import { WeChatUpdateProvider } from '../platform/update/WeChatUpdateProvider'
import { MiniDeviceCoordinator } from './MiniDeviceCoordinator'
import { MiniReconnectPolicy } from './MiniReconnectPolicy'
import { MiniUpdateService } from './MiniUpdateService'
import { readMiniVersion } from './MiniVersion'
import { miniSafety, withMiniOperationLock } from './MiniPageSafety'

// 姿态帧使用 Unix 毫秒，与共享校准链路使用的时间基准一致。
const transport = new WeChatBleTransport(Taro, { nowEpochMs: Date.now })
const miniStorage = new WeChatStorageStore(Taro)
export const courseCheckins = new CourseCheckins(miniStorage)
const { connectionManager, motionProfileService, sensorService } = createSensorServices(
  transport,
  miniStorage,
  // 微信返回的设备 ID 不跨手机推断，重连只匹配本机已绑定的 ID。
  (binding, devices) => devices.find(({ id }) => id === binding.deviceId) ?? null,
  () => miniDeviceCoordinator.onDrop(),
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
export { motionProfileService, sensorService }

export const miniDeviceCoordinator = new MiniDeviceCoordinator({
  manager: connectionManager,
  policy: new MiniReconnectPolicy(miniStorage),
  safety: miniSafety,
  initialize: async () => {
    // 读取失败也等另一项结束，重试不会叠加尚未完成的初始化。
    const tasks = await Promise.allSettled([connectionManager.initialize(), motionProfileService.load()])
    if (tasks.some((task) => task.status === 'rejected')) throw new Error('读取本地设备设置失败，请手动重试。')
  },
  scan: () => sensorService.scan(),
  suspendTransport: () => transport.suspend(),
  startCalibration: () => sensorService.startCalibration(),
  resetCalibration: () => sensorService.resetCalibration(),
  permissionError: bluetoothPermissionError,
})

export const miniUpdateService = new MiniUpdateService(
  new WeChatUpdateProvider(() => Taro.getUpdateManager?.()),
  miniSafety,
  async () => {
    const result = await Taro.showModal({
      title: '发现新版本',
      content: '新版本已下载。更新会重新打开小程序，已保存的训练记录和个人活动范围将保留。',
      cancelText: '稍后更新',
      confirmText: '立即更新',
    })
    return result.confirm
  },
  async () => {
    await miniDeviceCoordinator.cleanupForUpdate()
    await setTrainingScreenOn(false, true)
  },
)

// Pinia 发布只读快照，平台服务的生命周期由应用入口管理。
export const miniPinia = createPinia()
const useMiniRuntimeStore = defineStore('mini-runtime', () => {
  const deviceState = shallowRef(miniDeviceCoordinator.getSnapshot())
  const sensorSnapshot = shallowRef<SensorRuntimeSnapshot>()
  const connectionSnapshot = shallowRef(connectionManager.getSnapshot())
  const updateState = shallowRef(miniUpdateService.getSnapshot())
  const version = shallowRef(readMiniVersion(__MINI_BUILD_VERSION__))
  const foreground = computed(() => deviceState.value.foreground)
  const deviceBusy = computed(() => deviceState.value.action !== 'idle' || connectionSnapshot.value.operation !== 'idle')
  const interactionsBlocked = computed(() => !foreground.value || updateState.value.applying || updateState.value.promptOpen)
  const readyForTraining = computed(() => foreground.value
    && !deviceState.value.calibrating
    && sensorSnapshot.value?.state === 'connected'
    && sensorSnapshot.value.gameInput.connected
    && sensorSnapshot.value.gameInput.calibrated)
  return { foreground, deviceState, deviceBusy, interactionsBlocked, sensorSnapshot, connectionSnapshot, updateState, version, readyForTraining }
})
export const { foreground, deviceState, deviceBusy, interactionsBlocked, sensorSnapshot, connectionSnapshot, updateState, version, readyForTraining } =
  storeToRefs(useMiniRuntimeStore(miniPinia))

miniDeviceCoordinator.onChanged((snapshot) => { deviceState.value = snapshot })
miniUpdateService.onChanged((snapshot) => { updateState.value = snapshot })
connectionManager.onChanged((snapshot) => { connectionSnapshot.value = snapshot })

let lastUiUpdateAt = 0
sensorService.onSnapshot((snapshot) => {
  const now = Date.now()
  const previous = sensorSnapshot.value
  const calibrating = sensorService.motion.getCalibrationSnapshot(snapshot.frame?.timestamp).active
  // 校准开始、结束和掉线即时传播，普通姿态刷新保持 10Hz。
  if (now - lastUiUpdateAt >= 100 || !previous || previous.state !== snapshot.state
    || previous.gameInput.calibrated !== snapshot.gameInput.calibrated
    || previous.battery.updatedAt !== snapshot.battery.updatedAt || deviceState.value.calibrating !== calibrating) {
    sensorSnapshot.value = snapshot
    lastUiUpdateAt = now
  }
  miniDeviceCoordinator.observeSensor(snapshot.state, calibrating)
})

export const initializeMiniServices = () => miniDeviceCoordinator.initialize()
export const scanTrainingDevices = () => miniDeviceCoordinator.scan()
export const selectTrainingDevice = (device: SensorDevice, owner?: symbol) => miniDeviceCoordinator.select(device, owner)
export const reconnectTrainingDevice = (requiredId?: string) => miniDeviceCoordinator.reconnect(requiredId)
export const disconnectTrainingDevice = () => miniDeviceCoordinator.disconnect()
export const startTrainingCalibration = () => miniDeviceCoordinator.startCalibration()
export const cancelTrainingCalibration = () => miniDeviceCoordinator.cancelCalibration()
export const invalidateTrainingCalibration = () => miniDeviceCoordinator.invalidateCalibration()

export function confirmForgetTrainingDevice(): Promise<void> {
  return withMiniOperationLock('忘记设备确认', async () => {
    const id = connectionSnapshot.value.binding?.deviceId
    if (!id || !foreground.value || deviceBusy.value) return
    const answer = await Taro.showModal({
      title: '忘记设备',
      content: '下次训练需要重新选择设备。已保存的训练历史和个人活动范围将保留。',
    })
    // 确认只对应弹窗打开时的设备；后台或绑定变化后让用户重新确认。
    if (answer.confirm && foreground.value && connectionSnapshot.value.binding?.deviceId === id) await miniDeviceCoordinator.forget()
  })
}

export function launchMiniServices(): void {
  version.value = readMiniVersion(__MINI_BUILD_VERSION__, () => Taro.getAccountInfoSync?.()?.miniProgram)
  if (version.value.runtimeVersion && version.value.runtimeVersion !== version.value.buildVersion) {
    console.warn('微信正式版本与小程序构建版本不一致。')
  }
  miniUpdateService.initialize()
  void initializeMiniServices().catch(() => undefined)
}

export function resumeMiniServices(): void {
  miniSafety.setForeground(true)
  miniDeviceCoordinator.show()
  miniUpdateService.onForeground()
}

export function suspendMiniServices(): void {
  miniSafety.setForeground(false)
  miniDeviceCoordinator.hide()
}

function bluetoothPermissionError(): string | null {
  // 旧基础库没有系统查询接口时，已有绑定允许一次受控恢复。
  try {
    if (Taro.getSystemSetting?.()?.bluetoothEnabled === false) return '请打开手机蓝牙，再手动重连训练设备。'
  } catch { /* 继续使用可查询的授权信息。 */ }
  try {
    const authorization = Taro.getAppAuthorizeSetting?.()?.bluetoothAuthorized
    if (authorization === 'denied' || authorization === 'not determined') return '请在手机设置中允许微信使用蓝牙，再手动重连。'
  } catch { /* 由现有 BLE 错误处理终止无权限的尝试。 */ }
  return null
}
