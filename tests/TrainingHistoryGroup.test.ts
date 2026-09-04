import { describe, expect, it } from 'vitest'
import { createDefaultMotionProfile } from '../src/core/motion/MotionProfile'
import { buildTrainingHistoryGroups } from '../src/core/history/TrainingHistoryGroup'
import type { TrainingRecord } from '../src/core/training/TrainingRecord'

function record(id: string, gameId: string, gameName: string, completedAt: number, durationMs: number): TrainingRecord {
  return {
    schemaVersion: 2,
    id,
    gameId,
    gameName,
    completedAt,
    result: { startedAt: 0, endedAt: durationMs, durationMs },
    motionProfile: createDefaultMotionProfile(1),
    gameConfig: {},
    replay: null,
  }
}

describe('buildTrainingHistoryGroups', () => {
  it('按 gameId 分组，同名不同 ID 仍是两组', () => {
    const groups = buildTrainingHistoryGroups([
      record('1', 'game-a', '同名游戏', 100, 1000),
      record('2', 'game-b', '同名游戏', 200, 1000),
    ])
    expect(groups.map((group) => group.gameId)).toEqual(['game-b', 'game-a'])
  })

  it('同 ID 不同名称保持一组并使用最新记录名称', () => {
    const groups = buildTrainingHistoryGroups([
      record('old', 'game-a', '旧名称', 100, 1000),
      record('new', 'game-a', '新名称', 200, 2000),
    ])
    expect(groups[0]).toMatchObject({ gameName: '新名称', trainingCount: 2, latestCompletedAt: 200, totalDurationMs: 3000 })
    expect(groups[0].records.map((item) => item.id)).toEqual(['new', 'old'])
  })

  it('当前 Registry 名称优先于历史保存名称', () => {
    const groups = buildTrainingHistoryGroups([record('1', 'target-reach', '旧名称', 100, 1000)], (gameId) => gameId === 'target-reach' ? '四方向目标触达' : null)
    expect(groups[0].gameName).toBe('四方向目标触达')
  })

  it('未知游戏仍按历史名称分组，缺少名称时回退 ID', () => {
    expect(buildTrainingHistoryGroups([record('1', 'legacy', '旧游戏', 100, 1000)])[0].gameName).toBe('旧游戏')
    expect(buildTrainingHistoryGroups([record('1', 'legacy', '', 100, 1000)])[0].gameName).toBe('legacy')
  })

  it('异常时长按零统计，避免累计值变为 NaN', () => {
    const groups = buildTrainingHistoryGroups([
      record('1', 'game', '游戏', 100, Number.NaN),
      record('2', 'game', '游戏', 200, -100),
      record('3', 'game', '游戏', 300, 500),
    ])
    expect(groups[0].totalDurationMs).toBe(500)
  })

  it('按最近训练倒序排列 Group 与组内记录', () => {
    const groups = buildTrainingHistoryGroups([
      record('a-old', 'a', 'A', 100, 1),
      record('b', 'b', 'B', 250, 1),
      record('a-new', 'a', 'A', 300, 1),
    ])
    expect(groups.map((group) => group.gameId)).toEqual(['a', 'b'])
    expect(groups[0].records.map((item) => item.id)).toEqual(['a-new', 'a-old'])
  })

  it('空输入不生成 Group，且不会修改原数组顺序', () => {
    const records = [record('old', 'a', 'A', 100, 1), record('new', 'a', 'A', 200, 1)]
    expect(buildTrainingHistoryGroups([])).toEqual([])
    buildTrainingHistoryGroups(records)
    expect(records.map((item) => item.id)).toEqual(['old', 'new'])
  })
})
