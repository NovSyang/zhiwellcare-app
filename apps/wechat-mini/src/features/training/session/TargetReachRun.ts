import type { TrainingRecord } from '../../../../../../src/core/shared'
import { TargetReachController, type TargetReachFrame } from '../../../../../../src/games/target-reach/TargetReachController'
import {
  TARGET_REACH_GAME_ID, TARGET_REACH_GAME_NAME, type TargetReachGameConfig,
} from '../../../../../../src/games/target-reach/TargetReachGameConfig'
import type { TargetReachTrainingResult } from '../../../../../../src/games/target-reach/TargetReachTrainingResult'
import { MiniTrainingRun, type TrainingPauseReason, type TrainingRunOptions } from './MiniTrainingRun'

export type TargetReachPauseReason = TrainingPauseReason
export type TargetReachRecord = TrainingRecord<TargetReachTrainingResult, TargetReachGameConfig>

/** 保留四方挥腕的计分反馈，其余会话流程由两款训练共用。 */
export class TargetReachRun extends MiniTrainingRun<TargetReachTrainingResult, TargetReachGameConfig, TargetReachFrame> {
  private readonly score

  constructor(options: TrainingRunOptions & { config: TargetReachGameConfig; random?: () => number }) {
    const config = { ...options.config, enabledDirections: [...options.config.enabledDirections] }
    const score = { successTargets: 0, completedTargets: 0 }
    super(options, { id: TARGET_REACH_GAME_ID, name: TARGET_REACH_GAME_NAME, config }, (events) =>
      new TargetReachController(options.clock, config, {
        ...events,
        onScoreChanged: (success, completed) => {
          score.successTargets = success
          score.completedTargets = completed
        },
      }, options.random))
    this.score = score
  }

  getStatus() { return { ...super.getStatus(), ...this.score } }
}
