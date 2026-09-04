/** 当前由连接管理器执行的设备连接工作流类型。 */
export type ConnectionOperation =
  | 'idle'
  | 'startup'
  | 'manual-reconnect'
  | 'runtime-reconnect'
  | 'switch-device'
