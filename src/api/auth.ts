import { api } from './http'

/** 登录用户视图（与后端 model.SafeUser 对齐）。 */
export interface SafeUser {
  id: string
  phoneMasked: string
  nickname: string
  avatarUrl?: string
  role: string
  createdAt: string
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
  expiresInSeconds: number
}

export interface AuthPayload {
  user: SafeUser
  tokens: TokenPair
}

export function register(phone: string, password: string, nickname: string): Promise<AuthPayload> {
  return api.post<AuthPayload>('/api/v1/auth/register', { phone, password, nickname })
}

export function login(phone: string, password: string): Promise<AuthPayload> {
  return api.post<AuthPayload>('/api/v1/auth/login', { phone, password })
}

export function refresh(refreshToken: string): Promise<AuthPayload> {
  return api.post<AuthPayload>('/api/v1/auth/refresh', { refreshToken })
}

export function logout(refreshToken: string): Promise<{ loggedOut: boolean }> {
  return api.post<{ loggedOut: boolean }>('/api/v1/auth/logout', { refreshToken })
}

export function fetchMe(): Promise<SafeUser> {
  return api.get<SafeUser>('/api/v1/me')
}

export function updateMe(nickname: string): Promise<SafeUser> {
  return api.patch<SafeUser>('/api/v1/me', { nickname })
}
