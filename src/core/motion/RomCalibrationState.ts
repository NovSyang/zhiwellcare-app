/** 四方向 ROM 标定流程的页面与逻辑状态。 */
export type RomCalibrationState =
  | 'idle'
  | 'ready'
  | 'measuring'
  | 'review'
  | 'completed'
  | 'cancelled'

/** ROM 标定与训练共享的标准方向名称。 */
export type RomDirection = 'forward' | 'backward' | 'left' | 'right'

/** 固定标定顺序，帮助页面给出清晰且一致的动作提示。 */
export const ROM_DIRECTION_ORDER: readonly RomDirection[] = ['forward', 'backward', 'left', 'right']
