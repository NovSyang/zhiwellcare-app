/** 管理后台登录态（独立于用户端账号体系存储，避免混淆）。 */
const TOKEN_KEY = 'zhiwellcare.admin.token'

export const adminToken = {
  get(): string {
    try { return typeof localStorage === 'undefined' ? '' : (localStorage.getItem(TOKEN_KEY) ?? '') }
    catch { return '' }
  },
  set(token: string): void {
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(TOKEN_KEY, token) } catch { /* ignore */ }
  },
  clear(): void {
    try { if (typeof localStorage !== 'undefined') localStorage.removeItem(TOKEN_KEY) } catch { /* ignore */ }
  },
}
