import { describe, expect, it } from 'vitest'
import { createDefaultMotionProfile } from '../src/core/motion/MotionProfile'
import { presentTrainingRecord } from '../src/games/TrainingRecordPresentation'
import type { TrainingRecord } from '../src/core/training/TrainingRecord'
import { defaultTargetReachGameConfig } from '../src/games/target-reach/TargetReachGameConfig'
import { buildTargetReachTrainingResult } from '../src/games/target-reach/TargetReachTrainingResult'
import { defaultTrajectoryFollowGameConfig } from '../src/games/trajectory-follow/TrajectoryFollowGameConfig'
import { buildTrajectoryFollowTrainingResult } from '../src/games/trajectory-follow/TrajectoryFollowTrainingResult'

describe('游戏结果 Presenter', () => {
  it('分别生成 TargetReach 与 TrajectoryFollow 主指标', () => {
    const common = { schemaVersion: 2 as const, id: 'id', completedAt: 1, motionProfile: createDefaultMotionProfile(1), replay: null }
    const target: TrainingRecord<any, any> = { ...common, gameId: 'target-reach', gameName: '四方挥腕挑战', result: buildTargetReachTrainingResult(0, 1, 1, []), gameConfig: defaultTargetReachGameConfig }
    const trajectory: TrainingRecord<any, any> = { ...common, gameId: 'trajectory-follow', gameName: '8字轨迹跟随', result: buildTrajectoryFollowTrainingResult(0, 1000, 1000, [0.1], 0.18), gameConfig: defaultTrajectoryFollowGameConfig }
    expect(presentTrainingRecord(target)?.metrics[0]).toEqual({ label: '成功率', value: '0%' })
    expect(presentTrainingRecord(trajectory)?.metrics[0]).toEqual({ label: '范围内比例', value: '100%' })
  })

  it('未知游戏返回安全降级结果', () => {
    const record: TrainingRecord = { schemaVersion: 1, id: 'unknown', gameId: 'unknown', gameName: '旧游戏', completedAt: 1, result: { startedAt: 0, endedAt: 1, durationMs: 1 }, motionProfile: createDefaultMotionProfile(1), gameConfig: {} }
    expect(presentTrainingRecord(record)).toBeNull()
  })
})
