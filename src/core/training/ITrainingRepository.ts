import type { TrainingRecord } from './TrainingRecord'

/** 训练历史的持久化接口，页面不依赖具体的 IndexedDB 实现。 */
export interface ITrainingRepository {
  save(record: TrainingRecord): Promise<void>
  getAll(): Promise<TrainingRecord[]>
  getById(id: string): Promise<TrainingRecord | null>
  delete(id: string): Promise<void>
}
