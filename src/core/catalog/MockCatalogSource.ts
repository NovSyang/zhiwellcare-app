import { mockCatalog } from '../../data/catalog'
import type { ICatalogSource } from './ICatalogSource'
import type { CatalogSnapshot, DeviceModelInfo, GameCatalogEntry } from './DeviceCatalogTypes'
import { tagsSatisfy } from './tagMatching'

/**
 * 本地 Mock 目录源：与后端接口同构，支撑前端全链路开发与离线演示。
 * 数据源位于 src/data/catalog.ts（等价于服务端一张目录配置表）。
 */
export class MockCatalogSource implements ICatalogSource {
  readonly kind = 'mock' as const

  async loadSnapshot(): Promise<CatalogSnapshot> {
    return {
      schemaVersion: mockCatalog.schemaVersion,
      deviceModels: mockCatalog.deviceModels.map((model) => ({ ...model, capabilityTags: [...model.capabilityTags] })),
      games: mockCatalog.games.map((game) => ({ ...game, requiredTags: [...game.requiredTags] })),
    }
  }

  async listDeviceModels(): Promise<DeviceModelInfo[]> {
    return (await this.loadSnapshot()).deviceModels
  }

  async listModelGames(modelId: string): Promise<GameCatalogEntry[]> {
    const snapshot = await this.loadSnapshot()
    const model = snapshot.deviceModels.find((item) => item.modelId === modelId)
    if (!model) return []
    return snapshot.games
      .filter((game) => game.status === 'on')
      .filter((game) => tagsSatisfy(model.capabilityTags, game.requiredTags))
      .map((game) => ({ ...game }))
  }
}
