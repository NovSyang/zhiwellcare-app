/** 单个标准化游戏输入样本；时间只包含有效训练时间。 */
export interface ReplaySample {
  elapsedMs: number
  x: number
  y: number
}

/** 游戏写入的历史事实事件，payload 由具体游戏定义。 */
export interface ReplayEvent {
  elapsedMs: number
  type: string
  payload?: unknown
}

/** 可持久化的训练过程轨迹与事件时间线。 */
export interface TrainingReplay {
  schemaVersion: 1
  durationMs: number
  sampleRateHz: number
  samples: ReplaySample[]
  events: ReplayEvent[]
}
