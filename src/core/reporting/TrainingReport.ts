import type { TrainingRecord } from '../training/TrainingRecord'

/** 上报到服务端的训练记录载荷：与 PG 训练摘要表结构对齐（高频采样文件另走 S3）。 */
export interface TrainingReportPayload {
  recordId: string
  schemaVersion: number
  gameId: string
  gameName: string
  completedAt: number
  device: {
    modelId: string
    modelName: string
    capabilityTags: string[]
  }
  statistics: Record<string, number | string | null>
  clientVersion: string
  uploadedAt: number
}

/** 上报传输层统一接口：local（待发队列）/ http（直传后端）。 */
export interface ITrainingReportTransport {
  readonly kind: 'local' | 'http'
  submit(payload: TrainingReportPayload): Promise<{ accepted: boolean; queueLength?: number }>
  /** 待上报队列长度（local 模式有意义）。 */
  pendingCount(): Promise<number>
  flush(): Promise<{ flushed: number }>
}

export function toReportPayload(record: TrainingRecord, clientVersion: string): TrainingReportPayload {
  const statistics: Record<string, number | string | null> = {}
  const value = record.result as unknown
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (typeof item === 'number' || typeof item === 'string' || item === null) {
        statistics[key] = item
      } else if (item && typeof item === 'object' && !Array.isArray(item)) {
        // 结果中的分组指标（如分方向表现）展平为 JSON 字符串便于 PG JSONB 存储。
        statistics[key] = JSON.stringify(item)
      }
    }
  }
  return {
    recordId: record.id,
    schemaVersion: record.schemaVersion,
    gameId: record.gameId,
    gameName: record.gameName,
    completedAt: record.completedAt,
    device: {
      modelId: record.device?.modelId ?? '',
      modelName: record.device?.modelName ?? '',
      capabilityTags: record.device?.capabilityTags ?? [],
    },
    statistics,
    clientVersion,
    uploadedAt: Date.now(),
  }
}
