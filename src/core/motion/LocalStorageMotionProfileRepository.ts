import type { IKeyValueStore } from '../storage/IKeyValueStore'
import { StorageKeys } from '../storage/StorageKeys'
import type { IMotionProfileRepository } from './IMotionProfileRepository'
import type { MotionProfile } from './MotionProfile'

/** 使用 localStorage 保存当前唯一 MotionProfile，并过滤损坏或旧版本数据。 */
export class LocalStorageMotionProfileRepository implements IMotionProfileRepository {
  constructor(private readonly store: IKeyValueStore) {}

  async load(): Promise<MotionProfile | null> {
    const raw = await this.store.get(StorageKeys.motionProfile)
    if (!raw) return null
    try {
      const value: unknown = JSON.parse(raw)
      return isMotionProfile(value) ? structuredClone(value) : null
    } catch { return null }
  }

  async save(profile: MotionProfile): Promise<void> {
    await this.store.set(StorageKeys.motionProfile, JSON.stringify(profile))
  }

  async clear(): Promise<void> { await this.store.remove(StorageKeys.motionProfile) }
}

function isMotionProfile(value: unknown): value is MotionProfile {
  if (!value || typeof value !== 'object') return false
  const profile = value as Partial<MotionProfile>
  const range = profile.activeRange
  return profile.schemaVersion === 1
    && typeof profile.id === 'string'
    && typeof profile.name === 'string'
    && typeof profile.horizontalDeadZone === 'number'
    && typeof profile.verticalDeadZone === 'number'
    && typeof profile.trainingRatio === 'number'
    && !!range
    && [range.leftMax, range.rightMax, range.forwardMax, range.backwardMax].every((item) => typeof item === 'number')
}
