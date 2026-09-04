export type SensorTransportErrorCode =
  | 'permission-denied'
  | 'permission-permanently-denied'
  | 'bluetooth-disabled'
  | 'unsupported'
  | 'operation-failed'

/** 平台层统一错误，连接管理器可据此判断是否应停止自动重试。 */
export class SensorTransportError extends Error {
  constructor(
    public readonly code: SensorTransportErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'SensorTransportError'
  }
}

/** 权限、蓝牙开关和平台能力不会通过短时间重复扫描自行恢复。 */
export function isTerminalSensorTransportError(error: unknown): error is SensorTransportError {
  return error instanceof SensorTransportError && error.code !== 'operation-failed'
}
