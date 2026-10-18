import type { ReleaseChannel } from './common.mjs'

/** 暂存必须显式指定来源、目标、通道和远端验收报告，结果仅列公开文件。 */
export interface StagePublicFilesOptions {
  target: string
  'public-dir': string
  channel: string
  'verification-report': string
  'version-file'?: string
  config?: string
}

export interface StagePublicFilesResult {
  staged: true
  version: string
  channel: ReleaseChannel
  files: string[]
}

export function stagePublicFiles(options: StagePublicFilesOptions): Promise<StagePublicFilesResult>
