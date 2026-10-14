import type { PublicReleaseInfo } from './common.mjs'

/** 三份最终产物汇总为公开资料；参数明确区分产物目录和公开输出目录。 */
export interface GeneratePublicMetadataOptions {
  channel: string
  'public-dir': string
  'artifacts-dir': string
  notes: string
  'version-file'?: string
  config?: string
}

export function generatePublicMetadata(options: GeneratePublicMetadataOptions): Promise<PublicReleaseInfo>
