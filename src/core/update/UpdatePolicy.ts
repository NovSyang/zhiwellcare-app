export type UpdatePolicy = 'silent' | 'prompt' | 'manual'

export const DEFAULT_UPDATE_POLICY: UpdatePolicy = 'prompt'

/** 损坏或旧版本的本地配置统一回退为提醒更新。 */
export function isUpdatePolicy(value: unknown): value is UpdatePolicy {
  return value === 'silent' || value === 'prompt' || value === 'manual'
}
