/** 本地持久化键名集中定义，避免不同模块使用不一致字符串（zhiwellcare 品牌前缀）。 */
export const StorageKeys = {
  motionProfile: 'zhiwellcare.motion-profile.v1',
  lastDevice: 'zhiwellcare.last-device.v1',
  /** 设备库：用户已绑定/管理的全部消费设备（多设备体系，运行时激活设备由 lastDevice 决定）。 */
  deviceLibrary: 'zhiwellcare.device-library.v1',
  /** 训练摘要上报待发队列（local 模式）。 */
  reportQueue: 'zhiwellcare.training.report.queue.v1',
} as const
