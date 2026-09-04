import { describe, expect, it } from 'vitest'
import type { IKeyValueStore } from '../src/core/storage/IKeyValueStore'
import { UpdatePolicyRepository } from '../src/core/update/UpdatePolicyRepository'

// 内存存储隔离浏览器 localStorage，便于验证默认值和持久化行为。
class MemoryStore implements IKeyValueStore {
  values = new Map<string, string>()
  async get(key: string): Promise<string | null> { return this.values.get(key) ?? null }
  async set(key: string, value: string): Promise<void> { this.values.set(key, value) }
  async remove(key: string): Promise<void> { this.values.delete(key) }
}

describe('UpdatePolicyRepository', () => {
  it('空值和损坏值回退为 prompt', async () => {
    const store = new MemoryStore()
    const repository = new UpdatePolicyRepository(store)
    await expect(repository.load()).resolves.toBe('prompt')
    store.values.set('rehab.update-policy', 'unknown')
    await expect(repository.load()).resolves.toBe('prompt')
  })

  it('保存并读取三种合法策略', async () => {
    const repository = new UpdatePolicyRepository(new MemoryStore())
    for (const policy of ['silent', 'prompt', 'manual'] as const) {
      await repository.save(policy)
      await expect(repository.load()).resolves.toBe(policy)
    }
  })
})
