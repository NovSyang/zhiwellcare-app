import type { DeviceCapabilityTag, MatchTag } from './CapabilityTags'

/** 目录快照版本；服务端目录结构升级时递增（本地 Mock 同步维护）。 */
export const CATALOG_SCHEMA_VERSION = 1

/** 硬件协议标识：平台层 BLE 传输据此识别设备帧协议。 */
export type DeviceProtocolId = 'bs-bt91' | 'generic-ble' | null

/** 设备型号目录项（由后端 /api/v1/catalog/devices 提供，Mock 源内置首版）。 */
export interface DeviceModelInfo {
  modelId: string
  name: string
  manufacturer: string
  category: 'wrist' | 'desk-torque' | 'grip' | 'body' | 'other'
  description: string
  /** 设备能力标签：训练游戏匹配的核心依据。 */
  capabilityTags: DeviceCapabilityTag[]
  /** 该型号支持的（二级）手柄配件标签，实际启用取决于用户安装的配件。 */
  supportedHandleTags: MatchTag[]
  /** BLE 广播名匹配片段，用于把扫描到的设备归入型号。 */
  namePatterns: string[]
  /** 硬件通信协议，平台层据此选择传输实现。 */
  protocol: DeviceProtocolId
  /** 最低支持 APP 版本（后端版本体系，Mock 占位）。 */
  minAppVersion: string
  /** 固件 OTA 可用（消费版固件；服务端永久拦截医疗版固件下发）。 */
  firmwareUpdatable: boolean
  /** 纯消费主动训练设备：无电机驱动、无医疗功能。 */
  consumerOnly: true
  /** 展示用图标（内嵌 emoji，正式版换 CDN 图标地址）。 */
  icon: string
}

/** 游戏上架状态。 */
export type GameCatalogStatus = 'on' | 'off'

/** 游戏目录项（由后端 /api/v1/device/{model}/games 返回，含 CDN 资源与灰度）。 */
export interface GameCatalogEntry {
  gameId: string
  name: string
  summary: string
  /** 游戏所需的全部标签；设备能力标签 ⊇ 该集合才可运行。 */
  requiredTags: MatchTag[]
  /** 目标训练时长预设（分钟）。 */
  durationPresetsMin: number[]
  /** 内容资源版本（CDN 缓存键，后端管控）。 */
  resourceVersion: string
  /** CDN 封面/资源地址占位（正式环境由后端下发）。 */
  resourceUrl: string
  status: GameCatalogStatus
  /** 灰度批次与放量比例占位（后端管控）。 */
  grayBatch?: number
  grayRatio?: number
  /** 训练品类文案（课程/统计归组用）。 */
  categoryLabel: string
  /** 纯主动发力模式（消费合规：无被动驱动）。 */
  playMode: 'active-force'
}

/** 设备型号 → 可用游戏：目录服务的核心返回值。 */
export interface DeviceGameProfile {
  modelId: string
  modelName: string
  deviceTags: MatchTag[]
  games: GameCatalogEntry[]
  /** 大厅可见但当前设备不满足标签的游戏（用于“连接对应设备”引导）。 */
  unavailableGames: Array<GameCatalogEntry & { missingTags: MatchTag[] }>
}

/** 设备目录总体快照。 */
export interface CatalogSnapshot {
  schemaVersion: number
  deviceModels: DeviceModelInfo[]
  games: GameCatalogEntry[]
}

/** 目录源来源标识（UI 展示“本地目录 / 后端目录”）。 */
export type CatalogSourceKind = 'mock' | 'http'
