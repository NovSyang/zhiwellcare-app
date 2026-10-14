import releaseVersion from '../../../release-version.json'

/** 内部版本只取统一发布元数据，上报和比较时不添加展示前缀。 */
export const APP_PRODUCT_VERSION = releaseVersion.productVersion
export const APP_DISPLAY_VERSION = releaseVersion.displayVersion

/** 展示省略末尾的零补丁号；保持字符串处理，避免把 0.10 当浮点数。 */
export function formatDisplayVersion(version: string = APP_PRODUCT_VERSION): string {
  const value = version.trim().replace(/^v+/i, '')
  if (value === APP_PRODUCT_VERSION) return APP_DISPLAY_VERSION
  return value.replace(/^(\d+\.\d+)\.0$/, '$1')
}

/** 所有页面通过此函数添加一次 V，防止出现 VV0.1。 */
export function formatVersionLabel(version: string = APP_PRODUCT_VERSION): string {
  return `V${formatDisplayVersion(version)}`
}
