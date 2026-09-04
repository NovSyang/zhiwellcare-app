import { LocalStorageStore } from '../storage/LocalStorageStore'
import { HttpTrainingReportTransport } from './HttpTrainingReportTransport'
import { LocalTrainingReportTransport } from './LocalTrainingReportTransport'
import type { ITrainingReportTransport } from './TrainingReport'

/** 上报传输工厂：VITE_REPORT_MODE=http 且配置 VITE_API_BASE 时直传后端，否则落本地队列。 */
export function createTrainingReportTransport(): ITrainingReportTransport {
  const mode = import.meta.env.VITE_REPORT_MODE ?? 'local'
  const base = import.meta.env.VITE_API_BASE ?? ''
  if (mode === 'http' && base) {
    return new HttpTrainingReportTransport(base.replace(/\/$/, ''))
  }
  return new LocalTrainingReportTransport(new LocalStorageStore())
}
