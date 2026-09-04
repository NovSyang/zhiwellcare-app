import type { IKeyValueStore } from '../storage/IKeyValueStore'
import type { ITrainingReportTransport, TrainingReportPayload } from './TrainingReport'

/** 本地待发队列键（VITE_REPORT_MODE=local 默认模式）。 */
export const LOCAL_REPORT_QUEUE_KEY = 'zhiwellcare.training.report.queue.v1'

/**
 * 本地上报传输：后端未接入前把训练摘要写入待发队列（localStorage），
 * 切换 http 模式后由 HttpTrainingReportTransport 批量回传，数据不丢失。
 */
export class LocalTrainingReportTransport implements ITrainingReportTransport {
  readonly kind = 'local' as const

  constructor(private readonly store: IKeyValueStore) {}

  async submit(payload: TrainingReportPayload): Promise<{ accepted: boolean; queueLength?: number }> {
    const queue = await this.readQueue()
    queue.push(payload)
    await this.store.set(LOCAL_REPORT_QUEUE_KEY, JSON.stringify(queue))
    return { accepted: true, queueLength: queue.length }
  }

  async pendingCount(): Promise<number> {
    return (await this.readQueue()).length
  }

  async flush(): Promise<{ flushed: number }> {
    // 纯本地模式不发送；接入 http 模式后由统一服务编排迁移队列。
    return { flushed: 0 }
  }

  private async readQueue(): Promise<TrainingReportPayload[]> {
    const raw = await this.store.get(LOCAL_REPORT_QUEUE_KEY)
    if (!raw) return []
    try {
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as TrainingReportPayload[]) : []
    } catch {
      return []
    }
  }
}
