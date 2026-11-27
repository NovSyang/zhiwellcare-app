import { describe, expect, it, vi } from 'vitest'
import { WeChatCatalogSource, type CatalogRequest } from '../apps/wechat-mini/src/platform/WeChatCatalogSource'
import { CatalogService } from '../src/core/shared'
import { mockCatalog } from '../src/data/catalog'

describe('微信公开目录', () => {
  it('读取 Go 接口的统一响应并调用型号匹配路径', async () => {
    // 模拟后端 Envelope，验证设备、游戏与匹配走各自的公开路由。
    const request = vi.fn<CatalogRequest>(async ({ url }) => ({
      statusCode: 200,
      data: { code: 0, message: 'ok', data: url.endsWith('/devices') ? mockCatalog.deviceModels : mockCatalog.games },
    }))
    // 使用与后端部署文档相同的版本化基址，确认请求只包含一个 /api/v1。
    const source = new WeChatCatalogSource('https://api.example.com/api/v1/', request)
    const snapshot = await source.loadSnapshot()
    expect(snapshot.deviceModels[0]?.modelId).toBe('wobble-wrist-band')
    expect(snapshot.games[0]?.gameId).toBe('target-reach')
    await source.listModelGames(snapshot.deviceModels[0].modelId)
    expect(request.mock.calls.map(([option]) => option.url)).toEqual([
      'https://api.example.com/api/v1/catalog/devices',
      'https://api.example.com/api/v1/catalog/games',
      'https://api.example.com/api/v1/device/wobble-wrist-band/games',
    ])
  })

  it('不向 HTTP 或内网 IP 发送目录请求，错误时可以回退离线快照', async () => {
    const request = vi.fn<CatalogRequest>()
    for (const address of ['http://api.example.com', 'https://127.0.0.1']) {
      const source = new WeChatCatalogSource(address, request)
      await expect(source.loadSnapshot()).rejects.toThrow('HTTPS 域名')
    }
    expect(request).not.toHaveBeenCalled()
    request.mockResolvedValue({ statusCode: 200, data: { code: 400, message: 'bad response' } })
    const catalog = new CatalogService(new WeChatCatalogSource('https://api.example.com', request))
    expect((await catalog.listAllGames())[0]?.gameId).toBe('target-reach')
  })
})
