import { describe, expect, it, vi } from 'vitest'
import { WeChatTrainingRepository } from '../apps/wechat-mini/src/platform/storage/WeChatTrainingRepository'
import { createDefaultMotionProfile, type TrainingRecord } from '../src/core/shared'

/** 用独立内存模拟文件和索引，失败时可检查两者的提交顺序。 */
function fixture() {
  const index = new Map<string, string>()
  const data = new Map<string, string>()
  const store = {
    get: vi.fn(async (key: string) => index.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => { index.set(key, value) }),
    remove: vi.fn(async (key: string) => { index.delete(key) }),
  }
  const files = {
    read: vi.fn(async (name: string) => data.get(name) ?? null),
    write: vi.fn(async (name: string, content: string) => { data.set(name, content) }),
    remove: vi.fn(async (name: string) => { data.delete(name) }),
  }
  return { store, data, files, repository: new WeChatTrainingRepository(store, files) }
}

function record(id: string, completedAt = 10): TrainingRecord {
  return {
    schemaVersion: 2, id, completedAt, gameId: 'target-reach', gameName: '四方挥腕挑战',
    result: { startedAt: 0, endedAt: 100, durationMs: 100 },
    motionProfile: createDefaultMotionProfile(1), gameConfig: {},
    replay: { schemaVersion: 1, durationMs: 100, sampleRateHz: 25, samples: [{ elapsedMs: 0, x: 0, y: 0 }], events: [] },
  }
}

describe('微信训练历史', () => {
  it('并发保存不会覆盖索引，列表只读摘要，详情按需读取文件', async () => {
    const { repository, files, store } = fixture()
    await Promise.all([repository.save(record('old')), repository.save(record('new', 20))])
    const restarted = new WeChatTrainingRepository(store, files)
    expect((await restarted.getAll()).map(({ id, replay }) => [id, replay])).toEqual([['new', undefined], ['old', undefined]])
    expect(files.read).not.toHaveBeenCalled()
    expect((await restarted.getById('old'))?.replay).toEqual(record('old').replay)
    await restarted.delete('old')
    expect(await restarted.getById('old')).toBeNull()
    expect(files.remove).toHaveBeenCalledWith('training-replay-1.json')
  })

  it('文件写入失败时保留原记录，重试后可消费待清理清单', async () => {
    const { repository, files } = fixture()
    await repository.save(record('same'))
    files.write.mockRejectedValueOnce(new Error('无剩余空间'))
    await expect(repository.save(record('same', 20))).rejects.toThrow('无剩余空间')
    expect((await repository.getById('same'))?.completedAt).toBe(10)
    await repository.save(record('same', 20))
    expect((await repository.getById('same'))?.completedAt).toBe(20)
    expect(files.remove).toHaveBeenCalledWith('training-replay-2.json')
  })

  it('回放不可用时仍返回可读取的训练摘要', async () => {
    const { repository, data } = fixture()
    await repository.save(record('lost'))
    data.delete('training-replay-1.json')
    expect(await repository.getById('lost')).toMatchObject({ id: 'lost', replay: null, completedAt: 10 })
  })
})
