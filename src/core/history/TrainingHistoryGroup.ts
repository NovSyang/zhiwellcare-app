import type { TrainingRecord } from '../training/TrainingRecord'

/** History 一级卡片需要的通用游戏训练汇总。 */
export interface TrainingHistoryGroup {
  gameId: string
  gameName: string
  records: TrainingRecord[]
  trainingCount: number
  latestCompletedAt: number
  totalDurationMs: number
}

export type TrainingGameNameResolver = (gameId: string) => string | null | undefined

/**
 * 按稳定 gameId 分组并生成统计，不修改 Repository 返回的原数组。
 * 当前 Registry 名称由调用方注入，Core 不反向依赖具体游戏模块。
 */
export function buildTrainingHistoryGroups(
  records: readonly TrainingRecord[],
  resolveGameName?: TrainingGameNameResolver,
): TrainingHistoryGroup[] {
  const grouped = new Map<string, TrainingRecord[]>()
  for (const record of records) {
    const group = grouped.get(record.gameId) ?? []
    group.push(record)
    grouped.set(record.gameId, group)
  }

  return [...grouped.entries()].map(([gameId, groupRecords]) => {
    const sortedRecords = [...groupRecords].sort((a, b) => safeCompletedAt(b.completedAt) - safeCompletedAt(a.completedAt))
    const registeredName = safeResolveName(resolveGameName, gameId)
    const latestStoredName = sortedRecords[0]?.gameName?.trim()
    return {
      gameId,
      gameName: registeredName || latestStoredName || gameId || '未知游戏',
      records: sortedRecords,
      trainingCount: sortedRecords.length,
      latestCompletedAt: safeCompletedAt(sortedRecords[0]?.completedAt),
      totalDurationMs: sortedRecords.reduce((sum, record) => sum + safeDuration(record.result.durationMs), 0),
    }
  }).sort((a, b) => b.latestCompletedAt - a.latestCompletedAt || a.gameName.localeCompare(b.gameName, 'zh-CN'))
}

function safeResolveName(resolver: TrainingGameNameResolver | undefined, gameId: string): string {
  if (!resolver) return ''
  try { return resolver(gameId)?.trim() ?? '' } catch { return '' }
}

function safeDuration(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

function safeCompletedAt(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}
