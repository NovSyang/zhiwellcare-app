import { describe, expect, it } from 'vitest'
import { TauriBleTransport } from '../src/platform/tauri/TauriBleTransport'

describe('TauriBleTransport', () => {
  it('在浏览器外环境扫描时显示桌面端提示', async () => {
    const transport = new TauriBleTransport()

    await expect(transport.scan()).rejects.toThrow(
      '蓝牙扫描仅支持在 Tauri 桌面应用中运行，请执行 npm run tauri:dev 后在自动打开的应用窗口中操作。',
    )
  })
})
