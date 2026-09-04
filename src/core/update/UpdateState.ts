/** 更新状态由服务统一维护，页面只负责根据状态展示操作。 */
export type UpdateState =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'waiting-install'
  | 'installing'
  | 'unsupported'
  | 'error'
