import { describe, expect, it } from 'vitest'
import config from '../release-config.json'
import { validateAssetUrl, validateReleaseConfig } from '../scripts/release/common.mjs'

// 独立验证 URL 的最终路径边界，不依赖安装包或公网下载。
const version = '0.1.0'
const base = 'https://gitee.com/Syang03/zhiwell-care/releases/download/'
const filename = `ZhiWellCare-${version}-android.apk`
const identity = { version, platform: 'android' }

describe('发布附件 URL 仓库边界', () => {
  it.each(['android', 'windows', 'signature'])('正常 stable %s 附件保留原仓库及版本命名', (platform) => {
    const suffix = platform === 'android' ? 'android.apk' : platform === 'windows' ? 'windows-x64-setup.exe' : 'windows-x64-setup.exe.sig'
    const value = `${base}v${version}/ZhiWellCare-${version}-${suffix}`
    expect(validateAssetUrl(value, config, { version, platform }).href).toBe(value)
  })

  it.each(['android', 'windows', 'signature'])('正常 staging %s 附件保留验证标识', (platform) => {
    const suffix = platform === 'android' ? 'android.apk' : platform === 'windows' ? 'windows-x64-setup.exe' : 'windows-x64-setup.exe.sig'
    const value = `${base}test-v${version}-run-01/ZhiWellCare-${version}-staging-${suffix}`
    expect(validateAssetUrl(value, config, { version, platform, channel: 'staging' }).href).toBe(value)
  })

  it.each([
    `${base}../../../../Other/repo/releases/download/v${version}/${filename}`,
    `${base}%2e%2e/%2e%2e/%2e%2e/%2e%2e/Other/repo/releases/download/v${version}/${filename}`,
    `${base}.%2e/.%2e/.%2e/.%2e/Other/repo/releases/download/v${version}/${filename}`,
    `${base}../download-other/v${version}/${filename}`,
    `${base}v${version}/extra/${filename}`,
    `${base}/v${version}/${filename}`,
    `${base}v${version}/${filename}/`,
    `${base}v${version}/`,
  ])('拒绝规范化后越界或包含额外路径段的 URL %#', (value) => {
    expect(() => validateAssetUrl(value, config, identity)).toThrow()
  })

  it.each([
    `${base}%2e%2e%2fOther/v${version}-${filename}`,
    `${base}v${version}/${filename}%2f..%2fOther`,
    `${base}v${version}/${filename}%5cOther`,
    `${base}v${version}/${filename}%252fOther`,
    `${base}v${version}/${filename}%252e%252e`,
    `${base}v${version}/${filename}%00`,
  ])('逐段解码后拒绝路径分隔符、双重编码和控制字符 %#', (value) => {
    expect(() => validateAssetUrl(value, config)).toThrow()
  })

  it('使用规范化 origin 比较，默认 HTTPS 端口和主机大小写不改变仓库', () => {
    const value = `https://GITEE.COM:443/Syang03/zhiwell-care/releases/download/v${version}/${filename}`
    expect(validateAssetUrl(value, config, identity).href).toBe(`${base}v${version}/${filename}`)
    expect(() => validateAssetUrl(value.replace(':443', ':8443'), config, identity)).toThrow()
  })

  it('staging 不接受空运行标识、模糊文件标识或 stable 文件名', () => {
    for (const value of [
      `${base}test-v${version}-/ZhiWellCare-${version}-staging-android.apk`,
      `${base}test-v${version}-run/ ZhiWellCare-${version}-staging-android.apk`,
      `${base}test-v${version}-run/ZhiWellCare-${version}-not-staging-android.apk`,
      `${base}test-v${version}-run/${filename}`,
      `${base}v${version}/ZhiWellCare-${version}-staging-android.apk`,
    ]) expect(() => validateAssetUrl(value, config, { ...identity, channel: 'staging' })).toThrow()
  })
})

describe('显式批准的附件扩展路由', () => {
  it('批准 CDN 主机和具体目录后，仍严格限定 tag/file 与版本命名', () => {
    const prefix = 'https://approved.example/zhiwellcare/releases/download/'
    const approved = { ...config, allowedDownloadHosts: [...config.allowedDownloadHosts, 'approved.example'], approvedAssetUrlPrefixes: [prefix] }
    const value = `${prefix}v${version}/${filename}`
    expect(validateAssetUrl(value, approved, identity).href).toBe(value)
    expect(() => validateAssetUrl(`${prefix}../../../../other/releases/download/v${version}/${filename}`, approved, identity)).toThrow()
    expect(() => validateAssetUrl(`${prefix}v${version}/extra/${filename}`, approved, identity)).toThrow()
  })

  it.each([
    'https://gitee.com/',
    'https://gitee.com/Other/repo/releases/download/',
    `${base}../../../../Other/repo/releases/download/`,
    'https://unapproved.example/releases/download/',
    'http://gitee.com/Syang03/zhiwell-care/releases/download/',
    'https://user:password@gitee.com/Syang03/zhiwell-care/releases/download/',
    `${base}?token=secret`,
    base.slice(0, -1),
  ])('配置校验拒绝扩大仓库或未经批准的前缀 %#', (prefix) => {
    const invalid = { ...config, approvedAssetUrlPrefixes: [prefix] }
    expect(() => validateReleaseConfig(invalid)).toThrow()
    expect(() => validateAssetUrl(`${base}v${version}/${filename}`, invalid, identity)).toThrow()
  })

  it('扩展项必须是数组，不能传入一个任意字符串', () => {
    expect(() => validateReleaseConfig({ ...config, approvedAssetUrlPrefixes: 'https://gitee.com/' })).toThrow('数组')
  })
})
