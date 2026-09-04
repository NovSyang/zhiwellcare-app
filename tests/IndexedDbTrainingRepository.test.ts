import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { IndexedDbTrainingRepository } from '../src/core/training/IndexedDbTrainingRepository'
import { createDefaultMotionProfile } from '../src/core/motion/MotionProfile'
import type { TrainingRecord } from '../src/core/training/TrainingRecord'
import type { TrainingReplay } from '../src/core/replay/TrainingReplay'
import type { TargetReachTrainingResult } from '../src/games/target-reach/TargetReachTrainingResult'
import { defaultTrajectoryFollowGameConfig } from '../src/games/trajectory-follow/TrajectoryFollowGameConfig'
import type { TrajectoryFollowTrainingResult } from '../src/games/trajectory-follow/TrajectoryFollowTrainingResult'

function record(id: string, completedAt: number): TrainingRecord<TargetReachTrainingResult> {
  return {
    schemaVersion: 1, id, gameId: 'target-reach', gameName: '四方挥腕挑战', completedAt,
    motionProfile: createDefaultMotionProfile(1), gameConfig: {},
    result: { startedAt: 1, endedAt: 2, durationMs: 1, totalTargets: 1, successTargets: 1, failedTargets: 0, successRate: 1, averageReactionTimeMs: 1, averageReachTimeMs: 1, attempts: [], directions: { left: { total: 0, success: 0, failed: 0, averageReachTimeMs: null }, right: { total: 0, success: 0, failed: 0, averageReachTimeMs: null }, forward: { total: 0, success: 0, failed: 0, averageReachTimeMs: null }, backward: { total: 0, success: 0, failed: 0, averageReachTimeMs: null } } },
  }
}

/** 第二款游戏复用同一个 Store，只让 Result 与 Config 拥有自己的类型。 */
function trajectoryRecord(id: string, completedAt: number): TrainingRecord<TrajectoryFollowTrainingResult, typeof defaultTrajectoryFollowGameConfig> {
  return {
    schemaVersion: 2, id, gameId: 'trajectory-follow', gameName: '8字轨迹跟随', completedAt,
    motionProfile: createDefaultMotionProfile(1), gameConfig: structuredClone(defaultTrajectoryFollowGameConfig),
    result: { startedAt: 1, endedAt: 1001, durationMs: 1000, sampleCount: 25, averageTrackingError: 0.1, maxTrackingError: 0.2, inToleranceRatio: 0.8, inToleranceDurationMs: 800 },
    replay: { schemaVersion: 1, durationMs: 1000, sampleRateHz: 25, samples: [], events: [{ elapsedMs: 0, type: 'reference-path', payload: { samples: [] } }] },
  }
}

beforeEach(async () => { await new Promise<void>((resolve) => { const request = indexedDB.deleteDatabase('zhiwellcare-training'); request.onsuccess = () => resolve(); request.onerror = () => resolve() }) })

describe('IndexedDbTrainingRepository', () => {
  it('保存、倒序读取、按 ID 查询和删除，并兼容 V1/V2 Replay', async () => {
    const repository = new IndexedDbTrainingRepository()
    const replay: TrainingReplay = { schemaVersion: 1, durationMs: 40, sampleRateHz: 25, samples: [{ elapsedMs: 0, x: 0, y: 0 }], events: [] }
    await repository.save(record('old', 1))
    await repository.save({ ...record('new', 2), schemaVersion: 2, replay })
    await repository.save(trajectoryRecord('trajectory', 3))
    expect((await repository.getAll()).map((item) => item.id)).toEqual(['trajectory', 'new', 'old'])
    expect((await repository.getById('old'))?.completedAt).toBe(1)
    expect((await repository.getById('old'))?.replay).toBeUndefined()
    expect((await repository.getById('new'))?.replay).toEqual(replay)
    expect((await repository.getById('trajectory'))?.gameId).toBe('trajectory-follow')
    await repository.delete('old')
    expect(await repository.getById('old')).toBeNull()
  })
})
