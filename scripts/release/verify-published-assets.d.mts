import type { PublicAsset, ReleaseChannel } from './common.mjs'

/** 匿名下载的文本结果与落盘结果分开，调用方只有读取正文时才得到 Buffer。 */
export interface AnonymousOutputHandle {
  write(buffer: Uint8Array, offset: number, length: number, position: null): Promise<{ bytesWritten: number }>
  close(): Promise<void>
}

export interface AnonymousGetOptions {
  allowedHosts?: string[]
  maxBytes: number
  timeoutMs?: number
  output?: string
  fetcher?: (url: string, init?: RequestInit) => Promise<Response>
  /** 测试可注入部分写入或创建失败；生产默认使用 node:fs/promises.open。 */
  openFile?: (path: string, flags: 'wx') => Promise<AnonymousOutputHandle>
}

export interface AnonymousGetResult {
  size: number
  sha256: string
  bytes: Buffer | undefined
}

export interface WindowsUpdateAsset {
  url: string
  signature: string
}

export interface VerifyPublishedAssetsOptions {
  channel: string
  'public-dir': string
  'artifacts-dir': string
  config?: string
  'version-file'?: string
  signing?: string
  'remote-manifests'?: boolean
  'signature-url'?: string
  output?: string
  /** 仅用于构造网络故障，CLI 不接收此函数参数。 */
  fetcher?: (url: string, init?: RequestInit) => Promise<Response>
}

export interface PublishedAssetsReport {
  schemaVersion: 1
  verified: true
  channel: ReleaseChannel
  version: string
  mode: 'remote-manifests' | 'local-manifests'
  checkedAt: string
  assets: PublicAsset[]
}

export function anonymousGet(url: string, options: AnonymousGetOptions & { output: string }): Promise<AnonymousGetResult & { bytes: undefined }>
export function anonymousGet(url: string, options: AnonymousGetOptions & { output?: undefined }): Promise<AnonymousGetResult & { bytes: Buffer }>
export function anonymousGet(url: string, options: AnonymousGetOptions): Promise<AnonymousGetResult>
export function validateManifests(android: unknown, tauri: unknown, release: unknown, config: unknown, channel?: string): WindowsUpdateAsset
export function verifyPublishedAssets(options: VerifyPublishedAssetsOptions): Promise<PublishedAssetsReport>
