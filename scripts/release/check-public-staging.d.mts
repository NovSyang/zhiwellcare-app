import type { PublicReleaseInfo } from './common.mjs'

/** 公开目录检查只返回白名单文件和经过校验的发布资料，不暴露本机秘密。 */
export const publicFiles: string[]
export function canonicalPath(value: string): Promise<string>
export function assertSafeTarget(target: string, source?: string, keys?: string): Promise<string>
export function assertPublicText(text: string): void
export function checkPublicTree(directory: string, options?: { bundle?: boolean }): Promise<string[]>
export function checkPublicBundle(directory: string, channel: string, release: unknown, config: unknown): Promise<PublicReleaseInfo>
