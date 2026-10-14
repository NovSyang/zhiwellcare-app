/** 更新状态由服务统一维护，页面只负责根据状态展示操作。 */
export type UpdateState =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'waiting-install'
  // 来源授权与训练锁等待分开，只有来源授权任务允许回前台自动恢复。
  | 'waiting-permission'
  | 'installing'
  | 'installed'
  | 'unsupported'
  | 'error'
