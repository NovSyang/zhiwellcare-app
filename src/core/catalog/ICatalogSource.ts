import type { CatalogSnapshot, DeviceModelInfo, GameCatalogEntry } from './DeviceCatalogTypes'

/**
 * 目录源抽象：统一“本地 Mock 目录”与“Golang 后端目录接口”两种来源。
 * 页面只依赖该接口，后端就绪后切换 VITE_CATALOG_MODE=http 即可，无需改任何页面。
 */
export interface ICatalogSource {
  readonly kind: 'mock' | 'http'

  /** 全量目录快照（设备型号 + 全部游戏，含上下架状态）。 */
  loadSnapshot(): Promise<CatalogSnapshot>

  /** 当前生效（上架）的全部设备型号。 */
  listDeviceModels(): Promise<DeviceModelInfo[]>

  /** 某型号可用游戏（已按能力标签过滤 + 灰度过滤）。 */
  listModelGames(modelId: string): Promise<GameCatalogEntry[]>
}
