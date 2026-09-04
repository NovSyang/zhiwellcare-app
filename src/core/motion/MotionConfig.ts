export interface MotionRange {
  leftMax: number
  rightMax: number
  forwardMax: number
  backwardMax: number
}

export interface MotionConfig {
  horizontalDeadZone: number
  verticalDeadZone: number
  range: MotionRange
}

export const defaultMotionConfig: MotionConfig = {
  horizontalDeadZone: 0.5,
  verticalDeadZone: 0.5,
  range: {
    leftMax: 20,
    rightMax: 20,
    forwardMax: 20,
    backwardMax: 20,
  },
}
