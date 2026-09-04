import type { ITrainingReportTransport, TrainingReportPayload } from './TrainingReport'

/**
 * HTTP 上报传输：POST {base}/api/v1/training/records 直传 Golang 后端（PG 训练摘要）。
 * 由 createTrainingReportTransport 依据 VITE_REPORT_MODE 选择；本类仅在配置了地址时实例化。
 */
export class HttpTrainingReportTransport implements ITrainingReportTransport {
  readonly kind = 'http' as const

  constructor(private readonly baseUrl: string) {}

  async submit(payload: TrainingReportPayload): Promise<{ accepted: boolean; queueLength?: number }> {
    const response = await fetch(`${this.baseUrl}/api/v1/training/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) throw new Error(`训练记录上报失败：${response.status}`)
    return { accepted: true }
  }

  async pendingCount(): Promise<number> {
    return 0
  }

  async flush(): Promise<{ flushed: number }> {
    return { flushed: 0 }
  }
}
