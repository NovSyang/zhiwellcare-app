import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ApiError, request } from '../src/api/http'
import { tokenStorage } from '../src/api/token'
import * as authApi from '../src/api/auth'
import { useAuthStore } from '../src/stores/auth'

/** node 环境 localStorage polyfill（token 模块按需读取）。 */
function installLocalStorage(): void {
  const data = new Map<string, string>()
  const storage: Storage = {
    get length() { return data.size },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => { data.delete(key) },
    setItem: (key, value) => { data.set(key, String(value)) },
  }
  ;(globalThis as Record<string, unknown>).localStorage = storage
}

function mockFetchOnce(payload: unknown, status = 200): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })))
}

const userPayload = {
  code: 0, message: 'ok',
  data: {
    user: { id: 'u1', phoneMasked: '138****8000', nickname: '康康', role: 'user', createdAt: '2026-01-01T00:00:00Z' },
    tokens: { accessToken: 'access-1', refreshToken: 'refresh-1', expiresInSeconds: 7200 },
  },
}

beforeEach(() => {
  setActivePinia(createPinia())
  installLocalStorage()
  tokenStorage.clear()
})

afterEach(() => { vi.unstubAllGlobals() })

describe('API 客户端', () => {
  it('注册请求路径与载荷正确', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(userPayload), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const result = await authApi.register('13800138000', 'abc123', '康康')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/auth/register')
    expect(JSON.parse(String(init.body))).toEqual({ phone: '13800138000', password: 'abc123', nickname: '康康' })
    expect(result.user.nickname).toBe('康康')
    expect(result.tokens.accessToken).toBe('access-1')
    // 持久化由 auth store 的 applySession 负责（见下方 store 用例）
    expect(tokenStorage.accessToken).toBe('')
  })

  it('业务错误映射为 ApiError 并携带后端中文提示', async () => {
    mockFetchOnce({ code: 409, message: '该手机号已注册，请直接登录', data: null }, 409)
    await expect(request('/x')).rejects.toMatchObject({ status: 409, message: '该手机号已注册，请直接登录' })
  })

  it('网络不可达提示友好', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    const error = await request('/x').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).message).toContain('无法连接服务器')
  })

  it('已登录请求自动携带 Authorization', async () => {
    tokenStorage.save('access-t', 'refresh-t')
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 0, message: 'ok', data: { id: 'u1' } }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    await request('/api/v1/me')
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer access-t')
  })
})

describe('auth store 登录态', () => {
  it('login 成功后进入已登录态并持久化令牌', async () => {
    mockFetchOnce(userPayload)
    const auth = useAuthStore()
    await auth.login('13800138000', 'abc123')
    expect(auth.isLoggedIn).toBe(true)
    expect(auth.displayName).toBe('康康')
    expect(tokenStorage.accessToken).toBe('access-1')
  })

  it('登录失败写入 lastError 且保持未登录', async () => {
    mockFetchOnce({ code: 401, message: '手机号或密码不正确', data: null }, 401)
    const auth = useAuthStore()
    await auth.login('13800138000', 'wrong').catch(() => { /* 预期失败 */ })
    expect(auth.isLoggedIn).toBe(false)
    expect(auth.lastError).toBe('手机号或密码不正确')
  })

  it('ensureProfile 拉取用户资料；令牌失效时清空会话', async () => {
    tokenStorage.save('expired', 'refresh-expired')
    mockFetchOnce({ code: 401, message: '登录状态已失效，请重新登录', data: null }, 401)
    const auth = useAuthStore()
    auth.restoreFromStorage()
    expect(auth.isLoggedIn).toBe(true)
    await auth.ensureProfile()
    expect(auth.isLoggedIn).toBe(false)
    expect(tokenStorage.accessToken).toBe('')
  })

  it('logout 清空本地会话', async () => {
    mockFetchOnce(userPayload)
    const auth = useAuthStore()
    await auth.login('13800138000', 'abc123')
    await auth.logout()
    expect(auth.isLoggedIn).toBe(false)
    expect(tokenStorage.refreshToken).toBe('')
  })
})
