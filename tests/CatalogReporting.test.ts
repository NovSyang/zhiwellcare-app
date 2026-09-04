import { describe, expect, it } from 'vitest'
import type { IKeyValueStore } from '../src/core/storage/IKeyValueStore'
import { LocalTrainingReportTransport, LOCAL_REPORT_QUEUE_KEY } from '../src/core/reporting/LocalTrainingReportTransport'
import { toReportPayload } from '../src/core/reporting/TrainingReport'
import type { TrainingRecord } from '../src/core/training/TrainingRecord'

/** vitest node 环境没有 localStorage，注入内存版键值存储。 */
function memoryStore(): IKeyValueStore {
  const data = new Map<string, string>()
  return {
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => { data.set(key, value) },
    remove: async (key) => { data.delete(key) },
  }
}

describe('训练上报载荷', () => {
  it('记录强制携带设备型号、能力标签快照与游戏 ID，统计字段扁平化', () => {
    const record = {
      schemaVersion: 2,
      id: 'record-1',
      gameId: 'target-reach',
      gameName: '四方挥腕挑战',
      completedAt: 1700000000000,
      device: { modelId: 'wobble-wrist-band', modelName: '不倒翁手腕训练仪', capabilityTags: ['posture-sensor'] },
      result: {
        successRate: 0.85,
        totalTargets: 20,
        directions: { left: { success: 4, total: 5 } },
      },
    } as unknown as TrainingRecord
    const payload = toReportPayload(record, '0.1.0')
    expect(payload.device.modelId).toBe('wobble-wrist-band')
    expect(payload.device.capabilityTags).toEqual(['posture-sensor'])
    expect(payload.gameId).toBe('target-reach')
    expect(payload.statistics.successRate).toBe(0.85)
    // 嵌套分组指标序列化为 JSON 字符串便于 PG JSONB。
    expect(payload.statistics.directions).toBeTypeOf('string')
    expect(JSON.parse(String(payload.statistics.directions)).left.success).toBe(4)
    expect(payload.clientVersion).toBe('0.1.0')
  })

  it('旧记录无设备上下文时载荷可容忍空字段', () => {
    const legacy = {
      schemaVersion: 2,
      id: 'record-old',
      gameId: 'trajectory-follow',
      gameName: '8字轨迹跟随',
      completedAt: 1,
      result: {},
    } as unknown as TrainingRecord
    const payload = toReportPayload(legacy, '0.1.0')
    expect(payload.device.modelId).toBe('')
    expect(payload.device.capabilityTags).toEqual([])
  })
})

describe('本地上报传输（待发队列）', () => {
  it('submit 追加队列并持久化，pendingCount 返回长度', async () => {
    const store = memoryStore()
    const transport = new LocalTrainingReportTransport(store)
    expect(await transport.pendingCount()).toBe(0)
    const payload = {
      recordId: 'r1', schemaVersion: 2, gameId: 'g', gameName: 'G', completedAt: 1,
      device: { modelId: 'm', modelName: 'M', capabilityTags: ['posture-sensor'] },
      statistics: {}, clientVersion: '0.1.0', uploadedAt: 1,
    }
    const first = await transport.submit(payload)
    expect(first.accepted).toBe(true)
    expect(first.queueLength).toBe(1)
    await transport.submit({ ...payload, recordId: 'r2' })
    expect(await transport.pendingCount()).toBe(2)
    const raw = await store.get(LOCAL_REPORT_QUEUE_KEY)
    expect(JSON.parse(raw ?? '[]')).toHaveLength(2)
    await store.remove(LOCAL_REPORT_QUEUE_KEY)
  })
})
