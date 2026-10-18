import { ref } from 'vue'
import type { TrainingRecord } from '../training/TrainingRecord'
import type { ITrainingReportTransport } from './TrainingReport'
import { toReportPayload } from './TrainingReport'
import { APP_PRODUCT_VERSION } from '../version/AppVersion'

/**
 * 训练记录上报服务：训练完成并本地入库后调用 report()，
 * 在 UI 层（我的-训练数据）可通过 pendingCount 展示“待上报 N 条”状态。
 */
export class TrainingReportService {
  /** 待上报队列长度（响应式，UI 订阅）。 */
  readonly pendingCount = ref(0)

  constructor(private readonly transport: ITrainingReportTransport) {}

  async initialize(): Promise<void> {
    await this.refreshPendingCount()
  }

  async report(record: TrainingRecord): Promise<void> {
    // 上报保留完整内部版本，与最终构建使用的发布元数据一致。
    const payload = toReportPayload(record, APP_PRODUCT_VERSION)
    try {
      const result = await this.transport.submit(payload)
      if (result.accepted && result.queueLength !== undefined) {
        this.pendingCount.value = result.queueLength
      }
    } catch (error) {
      // 上报失败不打断训练流程：记录已本地入库（IndexedDB），可稍后补报。
      console.warn('[report] 训练记录上报失败，已保留在本地记录库：', error)
    }
  }

  async refreshPendingCount(): Promise<void> {
    try {
      this.pendingCount.value = await this.transport.pendingCount()
    } catch {
      this.pendingCount.value = 0
    }
  }
}
