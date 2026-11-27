import type { MotionRange, RomDirection } from '@/shared/core'

// 顺序由共享 ROM 定义决定，这里只映射展示文案、箭头和范围字段。
export const rangeDirections: Record<RomDirection, {
  label: string
  arrow: string
  key: keyof MotionRange
  guide: string
}> = {
  forward: { label: '前', arrow: '↑', key: 'forwardMax', guide: '从自然中心开始，缓慢向前移动至舒适的最大活动位置。' },
  backward: { label: '后', arrow: '↓', key: 'backwardMax', guide: '从自然中心开始，缓慢向后移动至舒适的最大活动位置。' },
  left: { label: '左', arrow: '←', key: 'leftMax', guide: '从自然中心开始，缓慢向左移动至舒适的最大活动位置。' },
  right: { label: '右', arrow: '→', key: 'rightMax', guide: '从自然中心开始，缓慢向右移动至舒适的最大活动位置。' },
}
