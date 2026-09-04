import type { MotionProfile } from '../motion/MotionProfile'
import type { TrainingReplay } from '../replay/TrainingReplay'
import type { BaseTrainingResult } from './BaseTrainingResult'

/** 可跨应用重启保存的单次训练快照，不包含任何个人身份信息。 */
export interface TrainingRecord<
  TResult extends BaseTrainingResult = BaseTrainingResult,
  TConfig = unknown,
> {
  schemaVersion: 1 | 2
  id: string
  gameId: string
  gameName: string
  completedAt: number
  result: TResult
  motionProfile: MotionProfile
  gameConfig: TConfig
  /** V1 旧记录没有回放数据；V2 训练会保存完整 Replay。 */
  replay?: TrainingReplay | null
  /**
   * 设备上下文快照（智为康乐上报规范：每条训练记录强制携带设备型号、能力标签快照）。
   * 新训练由持久化服务自动填充；历史 V1/V2 记录可为空。
   */
  device?: TrainingRecordDeviceSnapshot | null
}

/** 训练记录中的设备上下文（消费版：型号 + 能力标签快照）。 */
export interface TrainingRecordDeviceSnapshot {
  modelId: string
  modelName: string
  /** 参与本次训练的设备能力标签（含启用配件），服务端据此做游戏/统计匹配。 */
  capabilityTags: string[]
}
