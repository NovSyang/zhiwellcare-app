import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import releaseVersion from '../release-version.json'
import tauriConfig from '../src-tauri/tauri.conf.json'

describe('release version', () => {
  it('产品、桌面与 Android 始终使用同一份有效发布版本', () => {
    // 验证版本契约而不是写死 0.8.0，确保发布工具可以安全递增版本。
    expect(releaseVersion.productVersion).toMatch(/^\d+\.\d+\.\d+$/)
    expect(releaseVersion.android.versionCode).toBeGreaterThan(0)
    expect(releaseVersion).toMatchObject({
      schemaVersion: 1,
      desktop: { version: releaseVersion.productVersion },
      android: { versionName: releaseVersion.productVersion },
    })
  })

  it('同步检查确认所有构建配置没有版本漂移', () => {
    // 使用真实 --check 入口，但不会修改任何项目文件。
    expect(() => execFileSync(process.execPath, ['scripts/sync-version.mjs', '--check'], {
      cwd: resolve(import.meta.dirname, '..'),
      stdio: 'pipe',
    })).not.toThrow()
  })

  it('Windows 产品名、主程序名和跨平台包标识保持一致', () => {
    expect(tauriConfig).toMatchObject({
      productName: 'ZhiWellCare',
      mainBinaryName: 'ZhiWellCare',
      identifier: 'com.zhiwellcare.app',
    })
  })
})
