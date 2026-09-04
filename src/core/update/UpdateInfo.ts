/** 各平台检查更新后统一返回的版本与发布信息。 */
export interface UpdateInfo {
  currentVersion: string
  latestVersion: string
  displayVersion: string
  notes: string[]
  publishedAt: string | null
  sizeBytes: number | null
}

/** 下载进度同时保留字节数和便于页面展示的百分比。 */
export interface UpdateProgress {
  downloadedBytes: number
  totalBytes: number | null
  percent: number | null
}
