import { describe, expect, it } from 'vitest'
import releaseVersion from '../release-version.json'
import { APP_PRODUCT_VERSION, formatDisplayVersion, formatVersionLabel } from '../src/core/version/AppVersion'

/** 展示与内部版本分离，字符串格式化保留多位次版本和补丁号。 */
describe('AppVersion', () => {
  it('默认版本展示与本次发布元数据一致', () => {
    // 当前构建可以是 stable 或后续 staging 版本，不能要求默认值永远是首发版。
    expect(APP_PRODUCT_VERSION).toBe(releaseVersion.productVersion)
    expect(formatDisplayVersion()).toBe(releaseVersion.displayVersion)
    expect(formatVersionLabel()).toBe(`V${releaseVersion.displayVersion}`)
  })

  it('固定初始版本示例显示 V0.1，且只添加一次前缀', () => {
    // 初始版本是独立业务示例，不从正在构建的发布版本推断。
    expect(formatDisplayVersion('0.1.0')).toBe('0.1')
    expect(formatVersionLabel('0.1.0')).toBe('V0.1')
    expect(formatVersionLabel('V0.1')).toBe('V0.1')
    expect(formatVersionLabel('VV0.1')).toBe('V0.1')
  })

  it('后续补丁与两位次版本不按浮点数处理', () => {
    expect(formatVersionLabel('0.1.1')).toBe('V0.1.1')
    expect(formatVersionLabel('0.2.0')).toBe('V0.2')
    expect(formatVersionLabel('0.10.0')).toBe('V0.10')
  })
})
