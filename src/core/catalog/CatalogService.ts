import { ref } from 'vue'
import type { ICatalogSource } from './ICatalogSource'
import { MockCatalogSource } from './MockCatalogSource'
import { HttpCatalogSource } from './HttpCatalogSource'
import type {
  CatalogSnapshot,
  DeviceGameProfile,
  DeviceModelInfo,
  GameCatalogEntry,
} from './DeviceCatalogTypes'
import { missingTags, tagsSatisfy } from './tagMatching'
import type { MatchTag } from './CapabilityTags'

/** 目录源当前状态：UI 可据此展示“本地目录 / 后端目录 / 后端不可用回退本地”。 */
export const catalogSourceStatus = ref<{
  kind: 'mock' | 'http' | 'http-fallback-mock'
  message: string
}>({ kind: 'mock', message: '本地目录' })

/** 运行时目录源工厂：VITE_CATALOG_MODE=http 时连接 Golang 后端，失败自动回退本地。 */
export function createCatalogSource(): ICatalogSource {
  const mode = import.meta.env.VITE_CATALOG_MODE ?? 'mock'
  const base = import.meta.env.VITE_API_BASE ?? ''
  if (mode === 'http' && base) {
    return new HttpCatalogSource(base.replace(/\/$/, ''))
  }
  return new MockCatalogSource()
}

/**
 * 目录服务：页面唯一的目录访问入口。
 * 缓存快照，提供“全部游戏 / 按设备型号过滤 / 缺失标签引导”的派生查询。
 */
export class CatalogService {
  private snapshotPromise: Promise<CatalogSnapshot> | null = null

  constructor(private readonly source: ICatalogSource = createCatalogSource()) {}

  async loadSnapshot(): Promise<CatalogSnapshot> {
    this.snapshotPromise ??= this.fetchSnapshotWithFallback()
    return this.snapshotPromise
  }

  async listDeviceModels(): Promise<DeviceModelInfo[]> {
    return (await this.loadSnapshot()).deviceModels
  }

  async listAllGames(): Promise<GameCatalogEntry[]> {
    const snapshot = await this.loadSnapshot()
    return snapshot.games.filter((game) => game.status === 'on')
  }

  /** 未连接设备时的大厅视图：全部上架游戏 + 推荐适配设备。 */
  async listGamesWithModels(): Promise<Array<GameCatalogEntry & { compatibleModels: string[] }>> {
    const snapshot = await this.loadSnapshot()
    return snapshot.games
      .filter((game) => game.status === 'on')
      .map((game) => ({
        ...game,
        compatibleModels: snapshot.deviceModels
          .filter((model) => tagsSatisfy(model.capabilityTags, game.requiredTags))
          .map((model) => model.name),
      }))
  }

  /** 某型号设备的完整可用画像：可用游戏 + 大厅可见但标签不满足的游戏。 */
  async getDeviceGameProfile(model: DeviceModelInfo | null): Promise<DeviceGameProfile | null> {
    if (!model) return null
    const snapshot = await this.loadSnapshot()
    const onGames = snapshot.games.filter((game) => game.status === 'on')
    const games = onGames.filter((game) => tagsSatisfy(model.capabilityTags, game.requiredTags))
    const unavailableGames = onGames
      .filter((game) => !tagsSatisfy(model.capabilityTags, game.requiredTags))
      .map((game) => ({ ...game, missingTags: missingTags(model.capabilityTags, game.requiredTags) }))
    return {
      modelId: model.modelId,
      modelName: model.name,
      deviceTags: [...model.capabilityTags, ...model.supportedHandleTags] as MatchTag[],
      games: games.map((game) => ({ ...game })),
      unavailableGames,
    }
  }

  /** 清缓存（灰度/目录刷新场景）。 */
  invalidate(): void {
    this.snapshotPromise = null
  }

  private async fetchSnapshotWithFallback(): Promise<CatalogSnapshot> {
    try {
      const snapshot = await this.source.loadSnapshot()
      catalogSourceStatus.value = {
        kind: this.source.kind,
        message: this.source.kind === 'http' ? '后端目录' : '本地目录',
      }
      return snapshot
    } catch (error) {
      // 后端未就绪/网络失败时回退本地目录，保证设备首页与游戏大厅永远可用。
      if (this.source.kind === 'http') {
        const mock = new MockCatalogSource()
        const snapshot = await mock.loadSnapshot()
        catalogSourceStatus.value = {
          kind: 'http-fallback-mock',
          message: error instanceof Error ? `后端目录不可用，已回退本地：${error.message}` : '后端目录不可用，已回退本地',
        }
        return snapshot
      }
      throw error
    }
  }
}
