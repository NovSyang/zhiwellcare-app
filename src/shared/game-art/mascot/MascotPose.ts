/** 游戏只传递姿态意图，不直接操作角色内部绘制节点。 */
export interface MascotPose {
  steering?: number
  throttle?: number
  braking?: number
  hit?: boolean
  celebrating?: boolean
}
