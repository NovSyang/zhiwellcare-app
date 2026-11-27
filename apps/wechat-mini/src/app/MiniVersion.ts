type Environment = 'release' | 'trial' | 'develop' | 'unknown'
interface AccountVersion { envVersion?: string; version?: string }

/** 正式版优先使用微信平台号，其他环境明确标记构建版本。 */
export function readMiniVersion(buildVersion: string, read?: () => AccountVersion | undefined) {
  let account: AccountVersion | undefined
  try { account = read?.() } catch { /* 旧基础库回退构建号。 */ }
  const env = account?.envVersion
  const envVersion: Environment = env === 'release' || env === 'trial' || env === 'develop' ? env : 'unknown'
  const raw = typeof account?.version === 'string' ? account.version.trim().replace(/^v/i, '') : ''
  const runtimeVersion = envVersion === 'release' && raw && /^\d+\.\d+\.\d+$/.test(raw) ? raw : null
  const suffix = { release: '构建版本', trial: '体验版', develop: '开发版', unknown: '环境未确认' }[envVersion]
  return { buildVersion, runtimeVersion, envVersion, displayLabel: runtimeVersion ? `V${runtimeVersion}` : `V${buildVersion}（${suffix}）` }
}
