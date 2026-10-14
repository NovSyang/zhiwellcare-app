import type { ExecFileOptions } from 'node:child_process'

/** 最终产物检查的返回值只包含公开元数据，不声明密码或私钥内容。 */
export interface AndroidTools {
  aapt: string
  signerJar: string
  version: string
}

export interface ApkMetadata {
  applicationId: string
  versionName: string
  versionCode: number
  debuggable: boolean
}

export interface CertificateDigests {
  certificateMd5?: string
  certificateSha1?: string
  certificateSha256?: string
}

export interface VerifiedApk extends ApkMetadata {
  certificateSha256: string
  sdkBuildTools: string
}

export interface VerifiedKeystore {
  privateKeyEntry: true
  certificateSha256: string
}

export interface VerifiedWindows {
  version: string
  signature: string
}

export interface CheckInputsOptions {
  'version-file'?: string
  signing?: string
  keystore?: string
  'tauri-key'?: string
  'check-sdk'?: boolean
  'require-published'?: boolean
  'first-release'?: boolean
  'published-android'?: string
  'published-tauri'?: string
  apk?: string
  artifact?: string
  signature?: string
}

export interface InputsReport {
  version: string
  keystore?: VerifiedKeystore
  tauriKeyPair?: { paired: true }
  androidTools?: AndroidTools
  versionAdvance?: 'passed'
  android?: VerifiedApk
  windows?: VerifiedWindows
}

/** 私钥操作只保留明确批准的签名环境变量，普通工具默认全部隔离。 */
export type ReleaseToolOptions = ExecFileOptions & { allowedSigningNames?: readonly string[] }
export function runTool(command: string, args: readonly string[], options?: ReleaseToolOptions & { encoding?: BufferEncoding }): Promise<string>
export function runTool(command: string, args: readonly string[], options: ReleaseToolOptions & { encoding: 'buffer' | null }): Promise<Buffer>
export function androidTools(): Promise<AndroidTools>
export function parseApkBadging(output: string): ApkMetadata
export function assertApkIdentity(metadata: ApkMetadata, certificates: readonly CertificateDigests[], release: unknown, signing: unknown): void
export function verifyApk(path: string, release: unknown, signing: unknown): Promise<VerifiedApk>
export function verifyKeystore(path: string, signing: unknown): Promise<VerifiedKeystore>
export function verifyUpdaterSignature(path: string, signaturePath: string, signing: unknown): Promise<string>
export function verifyTauriKeyPair(privateKeyPath: string, signing: unknown): Promise<{ paired: true }>
export function verifyWindows(path: string, signaturePath: string, release: unknown, signing: unknown): Promise<VerifiedWindows>
export function checkInputs(options: CheckInputsOptions): Promise<InputsReport>
