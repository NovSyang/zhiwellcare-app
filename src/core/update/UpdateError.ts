/** 用明确错误代码区分用户取消和故障，不根据含糊的错误文案猜测。 */
export class UpdateError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
    this.name = 'UpdateError'
  }
}

/** Capacitor 的拒绝对象可能不是 Error，仍可读取原生插件的错误代码。 */
export function hasUpdateErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

/** 保留平台提供的中文消息，也兼容普通 Error 和桥接对象。 */
export function updateErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return String(error)
}
