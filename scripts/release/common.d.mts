/** 发布脚本的公开类型；外部 JSON 使用 unknown，只有运行时校验后才取得可信结构。 */
export type ReleaseChannel = 'stable' | 'staging'

export interface ReleaseVersion {
  schemaVersion: 1
  productVersion: string
  displayVersion: string
  desktop: { version: string }
  android: { versionName: string; versionCode: number }
}

export interface ReleaseSigning {
  schemaVersion: 1
  android: {
    applicationId: string
    keyAlias: string
    keyStoreType: string
    certificateMd5: string
    certificateSha1: string
    certificateSha256: string
  }
  tauri: { publicKey: string }
}

export interface ReleaseConfig {
  schemaVersion: 1
  publishRepository: string
  publishBranch: string
  defaultChannel: ReleaseChannel
  allowedDownloadHosts: string[]
  /** 额外路由必须是白名单主机上的规范目录 URL，不得扩大 Gitee 仓库边界。 */
  approvedAssetUrlPrefixes?: string[]
  channels: Record<ReleaseChannel, { androidManifestUrl: string; tauriManifestUrl: string }>
}

export interface FileDigest {
  size: number
  sha256: string
}

export interface PublicAsset extends FileDigest {
  name: string
}

export interface PublicReleaseInfo {
  schemaVersion: 1
  channel: ReleaseChannel
  version: string
  displayVersion: string
  versionCode: number
  publishedAt: string
  assets: PublicAsset[]
}

export const root: string
export const semverPattern: RegExp
export function parseArgs<ValueName extends string, FlagName extends string = never>(
  args: readonly string[], valueNames: readonly ValueName[], flagNames?: readonly FlagName[],
): Partial<Record<ValueName, string> & Record<FlagName, true>>
export function requireArgs(options: Record<string, unknown>, names: readonly string[]): void
export function readJson<T = unknown>(path: string): Promise<T>
export function writeJson(path: string, value: unknown): Promise<void>
export function exists(path: string): Promise<boolean>
export function compareVersions(left: string, right: string): -1 | 0 | 1
export function validateVersionFile(value: unknown): ReleaseVersion
export function assertVersionAdvance(release: unknown, publishedAndroid: unknown, publishedTauri: unknown, firstRelease?: boolean): void
export function validatePublishedAt(value: unknown): string
export function validateSigning(signing: unknown): ReleaseSigning
export function validateReleaseConfig(config: unknown): ReleaseConfig
export function validateAssetUrl(value: string, config: unknown, identity?: { version: string; channel?: string; platform: string }): URL
export function hashFile(path: string): Promise<FileDigest>
export function isMain(url: string): boolean | undefined
