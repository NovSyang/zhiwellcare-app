/** 登录令牌的本地持久化（仅存访问/刷新令牌，不存密码）。 */
const ACCESS_KEY = 'zhiwellcare.auth.accessToken'
const REFRESH_KEY = 'zhiwellcare.auth.refreshToken'

function read(key: string): string {
  try { return typeof localStorage === 'undefined' ? '' : (localStorage.getItem(key) ?? '') }
  catch { return '' }
}

function write(key: string, value: string): void {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(key, value) } catch { /* 忽略存储受限 */ }
}

export const tokenStorage = {
  get accessToken(): string { return read(ACCESS_KEY) },
  get refreshToken(): string { return read(REFRESH_KEY) },
  save(accessToken: string, refreshToken: string): void {
    write(ACCESS_KEY, accessToken)
    write(REFRESH_KEY, refreshToken)
  },
  clear(): void {
    write(ACCESS_KEY, '')
    write(REFRESH_KEY, '')
  },
}
