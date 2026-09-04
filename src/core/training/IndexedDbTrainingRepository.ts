import type { ITrainingRepository } from './ITrainingRepository'
import type { TrainingRecord } from './TrainingRecord'

const DATABASE_NAME = 'zhiwellcare-training'
const STORE_NAME = 'trainingRecords'
const DATABASE_VERSION = 1

/** 使用 IndexedDB 保存逐渐增长的训练记录，避免 localStorage 容量限制。 */
export class IndexedDbTrainingRepository implements ITrainingRepository {
  private databasePromise: Promise<IDBDatabase> | null = null

  async save(record: TrainingRecord): Promise<void> {
    const database = await this.open()
    await transaction(database, 'readwrite', (store) => store.put(structuredClone(record)))
  }

  async getAll(): Promise<TrainingRecord[]> {
    const database = await this.open()
    const records = await request<TrainingRecord[]>(database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll())
    return records.map((record) => structuredClone(record)).sort((a, b) => b.completedAt - a.completedAt)
  }

  async getById(id: string): Promise<TrainingRecord | null> {
    const database = await this.open()
    const record = await request<TrainingRecord | undefined>(database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id))
    return record ? structuredClone(record) : null
  }

  async delete(id: string): Promise<void> {
    const database = await this.open()
    await transaction(database, 'readwrite', (store) => store.delete(id))
  }

  private open(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('当前环境不支持 IndexedDB，无法保存训练历史。'))
    this.databasePromise = new Promise((resolve, reject) => {
      const openRequest = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
      openRequest.onupgradeneeded = () => {
        const database = openRequest.result
        const store = database.objectStoreNames.contains(STORE_NAME)
          ? openRequest.transaction!.objectStore(STORE_NAME)
          : database.createObjectStore(STORE_NAME, { keyPath: 'id' })
        if (!store.indexNames.contains('completedAt')) store.createIndex('completedAt', 'completedAt')
        if (!store.indexNames.contains('gameId')) store.createIndex('gameId', 'gameId')
      }
      openRequest.onsuccess = () => resolve(openRequest.result)
      openRequest.onerror = () => reject(openRequest.error ?? new Error('无法打开训练历史数据库。'))
    })
    return this.databasePromise
  }
}

/** 将一个 IndexedDB 请求包装为 Promise，统一处理请求级错误。 */
function request<T>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result)
    operation.onerror = () => reject(operation.error ?? new Error('数据库操作失败。'))
  })
}

/** 等待写事务真正提交，避免页面切换前记录尚未落盘。 */
function transaction(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, mode)
    const request = operation(tx.objectStore(STORE_NAME))
    request.onerror = () => reject(request.error ?? new Error('数据库写入失败。'))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('数据库事务失败。'))
    tx.onabort = () => reject(tx.error ?? new Error('数据库事务已取消。'))
  })
}
