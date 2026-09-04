import { defineStore } from 'pinia'
import { LocalStorageStore } from '../core/storage/LocalStorageStore'
import { StorageKeys } from '../core/storage/StorageKeys'
import type { DeviceModelInfo } from '../core/catalog/DeviceCatalogTypes'
import type { SensorDevice } from '../core/sensor/SensorDevice'

/** 设备库条目：用户已管理的一台消费训练设备（多设备绑定体系）。 */
export interface DeviceLibraryItem {
  deviceId: string
  address?: string
  /** BLE 广播名。 */
  name: string
  /** 用户别名（默认取型号名）。 */
  alias: string
  modelId: string
  modelName: string
  /** 能力标签快照（型号基础标签 + 已启用配件标签）。 */
  capabilityTags: string[]
  boundAt: number
  lastActiveAt: number
  /** 家属共享占位（首版仅记录状态，正式版由后端账号体系承载）。 */
  sharedWith: string[]
  /** 当前激活（运行时连接）标记。 */
  active: boolean
}

const store = new LocalStorageStore()

function isItem(value: unknown): value is DeviceLibraryItem {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<DeviceLibraryItem>
  return typeof item.deviceId === 'string'
    && typeof item.name === 'string'
    && typeof item.modelId === 'string'
    && typeof item.boundAt === 'number'
}

/**
 * 设备库：本地保存“用户拥有/绑定”的多台设备（型号 + 别名 + 能力标签快照），
 * 运行时只激活一台（连接引擎保持单活跃绑定），切换通过连接管理器完成。
 */
export const useDeviceLibraryStore = defineStore('deviceLibrary', {
  state: () => ({
    items: [] as DeviceLibraryItem[],
    loaded: false,
  }),

  getters: {
    activeItem(state): DeviceLibraryItem | null {
      return state.items.find((item) => item.active) ?? null
    },
    activeModelId(state): string | null {
      return state.items.find((item) => item.active)?.modelId ?? null
    },
  },

  actions: {
    async load(): Promise<void> {
      if (this.loaded) return
      const raw = await store.get(StorageKeys.deviceLibrary)
      if (raw) {
        try {
          const parsed: unknown = JSON.parse(raw)
          if (Array.isArray(parsed)) this.items = parsed.filter(isItem)
        } catch {
          this.items = []
        }
      }
      this.loaded = true
    },

    /** 设备连接成功后登记/刷新（由设备首页与连接回调调用）。 */
    async upsertFromConnection(input: {
      device: SensorDevice
      model: DeviceModelInfo | null
      active: boolean
    }): Promise<void> {
      await this.load()
      const existing = this.items.find((item) => item.deviceId === input.device.id)
      const now = Date.now()
      const capabilityTags = input.model
        ? [...input.model.capabilityTags, ...input.model.supportedHandleTags]
        : []
      const alias = input.model?.name ?? input.device.name
      if (existing) {
        existing.name = input.device.name
        existing.address = input.device.address ?? existing.address
        existing.lastActiveAt = now
        existing.active = input.active
        if (input.model) {
          existing.modelId = input.model.modelId
          existing.modelName = input.model.name
          existing.capabilityTags = capabilityTags
        }
      } else {
        this.items.push({
          deviceId: input.device.id,
          address: input.device.address,
          name: input.device.name,
          alias,
          modelId: input.model?.modelId ?? '',
          modelName: input.model?.name ?? '未识别设备',
          capabilityTags,
          boundAt: now,
          lastActiveAt: now,
          sharedWith: [],
          active: input.active,
        })
      }
      if (input.active) {
        for (const item of this.items) item.active = item.deviceId === input.device.id
      }
      await this.persist()
    },

    /** 用户重命名别名。 */
    async rename(deviceId: string, alias: string): Promise<void> {
      await this.load()
      const item = this.items.find((entry) => entry.deviceId === deviceId)
      if (item) {
        item.alias = alias.trim() || item.alias
        await this.persist()
      }
    },

    /** 解绑设备。 */
    async remove(deviceId: string): Promise<void> {
      await this.load()
      this.items = this.items.filter((entry) => entry.deviceId !== deviceId)
      await this.persist()
    },

    /** 解除所有激活标记（连接管理器解绑时调用）。 */
    async markInactiveAll(): Promise<void> {
      await this.load()
      for (const item of this.items) item.active = false
      await this.persist()
    },

    /** 家属共享占位（正式版对接后端账号体系）。 */
    async toggleShare(deviceId: string, memberId: string): Promise<void> {
      await this.load()
      const item = this.items.find((entry) => entry.deviceId === deviceId)
      if (!item) return
      const index = item.sharedWith.indexOf(memberId)
      if (index >= 0) item.sharedWith.splice(index, 1)
      else item.sharedWith.push(memberId)
      await this.persist()
    },

    async persist(): Promise<void> {
      await store.set(StorageKeys.deviceLibrary, JSON.stringify(this.items))
    },
  },
})
