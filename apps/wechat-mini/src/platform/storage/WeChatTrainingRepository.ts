import { copyTrainingReplay, type IKeyValueStore, type ITrainingRepository, type TrainingRecord } from '../../../../../src/core/shared'

/** 回放文件单独保存，列表和索引只读取训练摘要。 */
export interface IReplayFiles {
  read(name: string): Promise<string | null>
  write(name: string, content: string): Promise<void>
  remove(name: string): Promise<void>
}

interface StoredRecord {
  summary: TrainingRecord
  replayFile: string | null
}

interface Index {
  version: 1
  nextFile: number
  entries: StoredRecord[]
  cleanup: string[]
}

const INDEX_KEY = 'zhiwellcare.mini.training.index.v1'
const REPLAY_NAME = /^training-replay-[1-9]\d*\.json$/

export class WeChatTrainingRepository implements ITrainingRepository {
  private tail = Promise.resolve()

  constructor(private readonly store: IKeyValueStore, private readonly files: IReplayFiles) {}

  save(record: TrainingRecord): Promise<void> {
    return this.run(async () => {
      const index = await this.readIndex()
      await this.finishCleanup(index)
      const { replay, ...summary } = record
      const replayFile = replay ? `training-replay-${index.nextFile}.json` : null
      const oldFile = index.entries.find((entry) => entry.summary.id === summary.id)?.replayFile
      const next: Index = {
        ...index,
        entries: [{ summary, replayFile }, ...index.entries.filter((entry) => entry.summary.id !== summary.id)],
        nextFile: index.nextFile + (replayFile ? 1 : 0),
        cleanup: oldFile ? [oldFile] : [],
      }
      if (replay && replayFile) {
        // 文件写完前保留原索引，进程中断时也能重试清理未提交的回放。
        await this.writeIndex({ ...index, cleanup: [replayFile] })
        await this.files.write(replayFile, JSON.stringify(copyTrainingReplay(replay)))
      }
      await this.writeIndex(next)
      await this.finishCleanup(next)
    })
  }

  getAll(): Promise<TrainingRecord[]> {
    return this.run(async () => (await this.readIndex()).entries
      .map(({ summary }) => summary).sort((a, b) => b.completedAt - a.completedAt))
  }

  getById(id: string): Promise<TrainingRecord | null> {
    return this.run(async () => {
      const entry = (await this.readIndex()).entries.find(({ summary }) => summary.id === id)
      if (!entry) return null
      const raw = entry.replayFile ? await this.files.read(entry.replayFile) : null
      return { ...entry.summary, replay: readReplay(raw) }
    })
  }

  delete(id: string): Promise<void> {
    return this.run(async () => {
      const index = await this.readIndex()
      await this.finishCleanup(index)
      const entry = index.entries.find(({ summary }) => summary.id === id)
      if (!entry) return
      const next = {
        ...index,
        entries: index.entries.filter(({ summary }) => summary.id !== id),
        cleanup: entry.replayFile ? [entry.replayFile] : [],
      }
      await this.writeIndex(next)
      await this.finishCleanup(next)
    })
  }

  /** 读写均串行，避免在索引提交后读取到正在删除的旧回放文件。 */
  private run<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation)
    this.tail = next.then(() => undefined, () => undefined)
    return next
  }

  private async readIndex(): Promise<Index> {
    const raw = await this.store.get(INDEX_KEY)
    if (raw === null) return { version: 1, nextFile: 1, entries: [], cleanup: [] }
    try {
      const index: unknown = JSON.parse(raw)
      if (isIndex(index)) return index
    } catch { /* 保留损坏索引，避免后续保存覆盖历史。 */ }
    throw new Error('训练历史索引无法读取，本地记录已保留。')
  }

  private async writeIndex(index: Index): Promise<void> {
    await this.store.set(INDEX_KEY, JSON.stringify(index))
  }

  private async finishCleanup(index: Index): Promise<void> {
    if (!index.cleanup.length) return
    try {
      for (const name of index.cleanup) await this.files.remove(name)
      await this.writeIndex({ ...index, cleanup: [] })
      index.cleanup = []
    } catch (error) {
      throw new Error('旧回放文件清理失败，请检查存储后重试。', { cause: error })
    }
  }
}

/** 缺失或损坏的回放以空值返回，详情仍能展示摘要。 */
function readReplay(raw: string | null): NonNullable<TrainingRecord['replay']> | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<NonNullable<TrainingRecord['replay']>> | null
    if (value?.schemaVersion === 1 && Array.isArray(value.samples) && Array.isArray(value.events)) {
      return copyTrainingReplay(value as NonNullable<TrainingRecord['replay']>)
    }
  } catch { /* 交由详情页提示回放不可用。 */ }
  return null
}

function isIndex(value: unknown): value is Index {
  if (!value || typeof value !== 'object') return false
  const index = value as Partial<Index>
  return index.version === 1 && Number.isSafeInteger(index.nextFile) && (index.nextFile ?? 0) > 0
    && Array.isArray(index.entries) && index.entries.every(isEntry)
    && Array.isArray(index.cleanup) && index.cleanup.every(isReplayName)
    && index.cleanup.every((name) => !index.entries?.some((entry) => entry.replayFile === name))
}

function isEntry(value: unknown): value is StoredRecord {
  if (!value || typeof value !== 'object') return false
  const { summary, replayFile } = value as Partial<StoredRecord>
  return !!summary && (summary.schemaVersion === 1 || summary.schemaVersion === 2)
    && typeof summary.id === 'string' && typeof summary.gameName === 'string'
    && Number.isFinite(summary.completedAt) && !!summary.result
    && (replayFile === null || isReplayName(replayFile))
}

function isReplayName(value: unknown): value is string {
  return typeof value === 'string' && REPLAY_NAME.test(value)
}
