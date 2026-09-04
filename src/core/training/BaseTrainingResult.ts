/** 所有正式训练结果都必须包含的公共时间信息。 */
export interface BaseTrainingResult {
  startedAt: number
  endedAt: number
  durationMs: number
}
