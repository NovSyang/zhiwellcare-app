import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import releaseVersion from '../release-version.json'
import tauriConfig from '../src-tauri/tauri.conf.json'
import { assertVersionAdvance, compareVersions, validateVersionFile } from '../scripts/release/common.mjs'

// 发版比较使用固定示例，当前源码版本递增后依然能测试首次与第二次发布规则。
const baseline = {
  schemaVersion: 1, productVersion: '0.1.0', displayVersion: '0.1',
  desktop: { version: '0.1.0' }, android: { versionName: '0.1.0', versionCode: 1 },
}
const next = {
  schemaVersion: 1, productVersion: '0.1.1', displayVersion: '0.1.1',
  desktop: { version: '0.1.1' }, android: { versionName: '0.1.1', versionCode: 2 },
}

describe('release version', () => {
  it('产品、桌面与 Android 始终使用同一份有效发布版本', () => {
    // 验证版本契约而不是写死 0.8.0，确保发布工具可以安全递增版本。
    expect(releaseVersion.productVersion).toMatch(/^\d+\.\d+\.\d+$/)
    expect(releaseVersion.android.versionCode).toBeGreaterThan(0)
    expect(() => validateVersionFile(releaseVersion)).not.toThrow()
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

  it('严格比较整数版本段，同时要求 Android code 递增', () => {
    // 同版本覆盖和浮点数比较都不能用于第二次正式发布。
    expect(compareVersions('0.10.0', '0.2.0')).toBe(1)
    expect(() => assertVersionAdvance(baseline, { version: '0.1.0', versionCode: 1 }, { version: '0.1.0' })).toThrow('严格高于')
    expect(() => assertVersionAdvance(baseline, null, null)).toThrow('网络失败')
    expect(() => assertVersionAdvance(baseline, null, null, true)).not.toThrow()
    expect(() => assertVersionAdvance(next, null, null, true)).toThrow('首次 stable')
    expect(() => assertVersionAdvance(next, { version: '0.1.0', versionCode: 1 }, { version: '0.1.0' })).not.toThrow()
    expect(() => validateVersionFile({ ...next, displayVersion: 'V0.1.1' })).toThrow()
  })
})
