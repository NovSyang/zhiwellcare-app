import type { ICatalogSource } from './ICatalogSource'
import type { CatalogSnapshot, DeviceModelInfo, GameCatalogEntry } from './DeviceCatalogTypes'

/**
 * Golang 后端目录源（HTTP）：
 * - GET  {base}/api/v1/catalog/devices            设备型号目录
 * - GET  {base}/api/v1/device/{model}/games       设备可用游戏（含 CDN 资源/版本/灰度）
 * 服务端已按标签与灰度过滤；前端仍保留本地二次过滤作为兜底。
 */
export class HttpCatalogSource implements ICatalogSource {
  readonly kind = 'http' as const

  constructor(private readonly baseUrl: string) {}

  async loadSnapshot(): Promise<CatalogSnapshot> {
    const [deviceModels, games] = await Promise.all([
      this.getJson<DeviceModelInfo[]>(`${this.baseUrl}/api/v1/catalog/devices`),
      this.getJson<GameCatalogEntry[]>(`${this.baseUrl}/api/v1/catalog/games`),
    ])
    return { schemaVersion: 1, deviceModels, games }
  }

  async listDeviceModels(): Promise<DeviceModelInfo[]> {
    return this.getJson<DeviceModelInfo[]>(`${this.baseUrl}/api/v1/catalog/devices`)
  }

  async listModelGames(modelId: string): Promise<GameCatalogEntry[]> {
    return this.getJson<GameCatalogEntry[]>(`${this.baseUrl}/api/v1/device/${encodeURIComponent(modelId)}/games`)
  }

  private async getJson<T>(url: string): Promise<T> {
    const response = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`目录接口请求失败：${response.status} ${url}`)
    return (await response.json()) as T
  }
}
