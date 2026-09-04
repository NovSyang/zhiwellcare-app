import { describe, expect, it } from 'vitest'
import { LocalStorageMotionProfileRepository } from '../src/core/motion/LocalStorageMotionProfileRepository'
import { activeRangeFromMeasured, createDefaultMotionProfile, motionConfigFromProfile } from '../src/core/motion/MotionProfile'
import { MotionProfileService } from '../src/core/motion/MotionProfileService'
import type { IKeyValueStore } from '../src/core/storage/IKeyValueStore'

class MemoryStore implements IKeyValueStore {
  readonly values = new Map<string, string>()
  async get(key: string): Promise<string | null> { return this.values.get(key) ?? null }
  async set(key: string, value: string): Promise<void> { this.values.set(key, value) }
  async remove(key: string): Promise<void> { this.values.delete(key) }
}

describe('MotionProfile', () => {
  it('按训练比例生成实际使用的 ROM，并正确转换 MotionConfig', () => {
    const profile = createDefaultMotionProfile(1)
    profile.measuredRange = { leftMax: 10, rightMax: 20, forwardMax: 15, backwardMax: 5 }
    profile.activeRange = activeRangeFromMeasured(profile.measuredRange, 0.8)
    const config = motionConfigFromProfile(profile)

    expect(config.range).toEqual({ leftMax: 8, rightMax: 16, forwardMax: 12, backwardMax: 4 })
  })

  it('损坏 Profile 回退默认配置，并动态应用至传感器服务', async () => {
    const store = new MemoryStore()
    store.values.set('rehab.motion-profile.v1', '{broken')
    let received = 0
    const sensor = { updateMotionConfig: () => { received += 1 } }
    const service = new MotionProfileService(new LocalStorageMotionProfileRepository(store), sensor as never)
    const profile = await service.load()

    expect(profile.activeRange.rightMax).toBe(20)
    expect(received).toBe(1)
  })
})
