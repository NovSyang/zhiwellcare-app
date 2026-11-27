import {
  CATALOG_SCHEMA_VERSION, type ICatalogSource, type DeviceModelInfo, type GameCatalogEntry,
} from '../../../../src/core/shared'

/** 请求细节集中在平台边界。公开目录使用 GET，无需身份凭据。 */
export type CatalogRequest = (options: {
  url: string
  method: 'GET'
  header: { Accept: string }
  timeout: number
}) => Promise<{ statusCode: number; data: unknown }>

export class WeChatCatalogSource implements ICatalogSource {
  readonly kind = 'http' as const

  constructor(private readonly baseUrl: string, private readonly request: CatalogRequest) {}

  async loadSnapshot() {
    const [deviceModels, games] = await Promise.all([
      this.listDeviceModels(),
      this.getRows('/catalog/games').then((rows) => rows.map(gameFromWire)),
    ])
    return { schemaVersion: CATALOG_SCHEMA_VERSION, deviceModels, games }
  }

  async listDeviceModels(): Promise<DeviceModelInfo[]> {
    return (await this.getRows('/catalog/devices')).map(deviceFromWire)
  }

  async listModelGames(modelId: string): Promise<GameCatalogEntry[]> {
    return (await this.getRows(`/device/${encodeURIComponent(modelId)}/games`)).map(gameFromWire)
  }

  private async getRows(path: string): Promise<unknown[]> {
    const base = catalogApiBase(this.baseUrl)
    let response: Awaited<ReturnType<CatalogRequest>>
    try {
      response = await this.request({
        url: `${base}${path}`, method: 'GET', header: { Accept: 'application/json' }, timeout: 8_000,
      })
    } catch {
      // 网络失败向上反馈，但日志与异常中不包含完整地址和服务器数据。
      throw new Error('请求设备与游戏目录失败，请检查网络。')
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`目录接口请求失败（HTTP ${response.statusCode}）。`)
    }
    if (!isObject(response.data) || response.data.code !== 0 || !Array.isArray(response.data.data)) {
      throw new Error('目录接口未返回有效数据。')
    }
    return response.data.data
  }
}

/** 仅接受 HTTPS 公网域名地址，不发送带凭据、查询参数或内网 IP 的请求。 */
function catalogApiBase(value: string): string {
  const base = value.trim().replace(/\/+$/, '')
  const match = /^https:\/\/([a-z\d-]+(?:\.[a-z\d-]+)+)(?::443)?(?:\/[a-z\d._~/-]*)?$/i.exec(base)
  const hostname = match?.[1].toLowerCase()
  if (!hostname || !/[a-z]$/.test(hostname) || /\.(?:local|localhost|internal)$/.test(hostname)) {
    throw new Error('小程序目录服务需要可访问的 HTTPS 域名。')
  }
  // 仓库 API 契约提供带 /api/v1 的基址，已有只填域名的配置也能继续使用。
  return base.endsWith('/api/v1') ? base : `${base}/api/v1`
}

function deviceFromWire(value: unknown): DeviceModelInfo {
  if (!isObject(value) || typeof value.modelId !== 'string' || typeof value.name !== 'string'
    || !isStringList(value.capabilityTags) || !isStringList(value.supportedHandleTags)
    || !isStringList(value.namePatterns)) throw new Error('目录设备格式无效。')
  // Go 的公开目录没有 consumerOnly 字段，小程序沿用当前消费版目录契约。
  return { ...value, consumerOnly: true } as unknown as DeviceModelInfo
}

function gameFromWire(value: unknown): GameCatalogEntry {
  if (!isObject(value) || typeof value.gameId !== 'string' || typeof value.name !== 'string'
    || !isStringList(value.requiredTags) || !Array.isArray(value.durationPresetsMin)
    || (value.status !== 'on' && value.status !== 'off')) throw new Error('目录游戏格式无效。')
  return value as unknown as GameCatalogEntry
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}
