import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { ISensorTransport } from '../../core/sensor/ISensorTransport'
import type {
  SensorConnectionState,
  SensorDataPacket,
  SensorDevice,
} from '../../core/sensor/SensorDevice'

interface BleDataEvent {
  data: number[]
  timestampMs: number
}

interface BleStateEvent {
  state: SensorConnectionState
  message?: string
}

const TAURI_REQUIRED_MESSAGE =
  '蓝牙扫描仅支持在 Tauri 桌面应用中运行，请执行 npm run tauri:dev 后在自动打开的应用窗口中操作。'

export class TauriBleTransport implements ISensorTransport {
  private dataCallbacks = new Set<(packet: SensorDataPacket) => void>()
  private stateCallbacks = new Set<(state: SensorConnectionState) => void>()
  private listenersReady = false
  private unlisteners: UnlistenFn[] = []

  async scan(): Promise<SensorDevice[]> {
    this.ensureTauriRuntime()
    await this.ensureListeners()
    return invoke<SensorDevice[]>('ble_scan')
  }

  async connect(deviceId: string): Promise<void> {
    this.ensureTauriRuntime()
    await this.ensureListeners()
    await invoke('ble_connect', { deviceId })
  }

  async disconnect(): Promise<void> {
    this.ensureTauriRuntime()
    await invoke('ble_disconnect')
  }

  async write(data: Uint8Array): Promise<void> {
    this.ensureTauriRuntime()
    await invoke('ble_write', { data: Array.from(data) })
  }

  onData(callback: (packet: SensorDataPacket) => void): () => void {
    this.dataCallbacks.add(callback)
    return () => this.dataCallbacks.delete(callback)
  }

  onStateChanged(callback: (state: SensorConnectionState) => void): () => void {
    this.stateCallbacks.add(callback)
    return () => this.stateCallbacks.delete(callback)
  }

  async dispose(): Promise<void> {
    for (const unlisten of this.unlisteners) unlisten()
    this.unlisteners = []
    this.listenersReady = false
  }

  private async ensureListeners(): Promise<void> {
    if (this.listenersReady) return

    const unlistenData = await listen<BleDataEvent>('bsbt91-data', (event) => {
      const packet: SensorDataPacket = {
        data: Uint8Array.from(event.payload.data),
        timestamp: event.payload.timestampMs,
      }
      for (const callback of this.dataCallbacks) callback(packet)
    })

    const unlistenState = await listen<BleStateEvent>('bsbt91-state', (event) => {
      for (const callback of this.stateCallbacks) callback(event.payload.state)
    })

    this.unlisteners.push(unlistenData, unlistenState)
    this.listenersReady = true
  }

  private ensureTauriRuntime(): void {
    // 浏览器没有 Tauri 注入的 IPC 与事件桥接，不能直接访问 BLE 后端。
    if (typeof window === 'undefined' || !isTauri()) {
      throw new Error(TAURI_REQUIRED_MESSAGE)
    }
  }
}
