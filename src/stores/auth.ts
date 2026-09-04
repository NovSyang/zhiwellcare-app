import { defineStore } from 'pinia'
import { tokenStorage } from '../api/token'
import * as authApi from '../api/auth'
import type { SafeUser, TokenPair } from '../api/auth'

/**
 * 登录态 store：令牌持久化在 localStorage，用户信息内存缓存；
 * 训练等本地功能不依赖登录，登录仅用于云端同步/订单/共享等能力。
 */
export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null as SafeUser | null,
    accessToken: '',
    refreshToken: '',
    /** idle 未加载 / ready 已就绪 / busy 请求中 */
    status: 'idle' as 'idle' | 'ready' | 'busy',
    lastError: '',
  }),

  getters: {
    isLoggedIn: (state) => state.accessToken !== '' && state.status !== 'idle',
    displayName(state): string {
      if (state.user?.nickname) return state.user.nickname
      if (state.user?.phoneMasked) return state.user.phoneMasked
      return '智为康乐用户'
    },
    hasError: (state) => state.lastError !== '',
  },

  actions: {
    /** 应用启动时恢复本地令牌（惰性，不强制请求用户信息）。 */
    restoreFromStorage(): void {
      const access = tokenStorage.accessToken
      const refresh = tokenStorage.refreshToken
      this.accessToken = access
      this.refreshToken = refresh
      if (access) this.status = 'ready'
      else this.status = 'idle'
    },

    /** 登录成功后统一落库（store 状态 + localStorage）。 */
    applySession(payload: authApi.AuthPayload): void {
      this.accessToken = payload.tokens.accessToken
      this.refreshToken = payload.tokens.refreshToken
      this.user = payload.user
      this.status = 'ready'
      this.lastError = ''
      tokenStorage.save(payload.tokens.accessToken, payload.tokens.refreshToken)
    },

    async login(phone: string, password: string): Promise<void> {
      this.status = 'busy'
      this.lastError = ''
      try {
        this.applySession(await authApi.login(phone.trim(), password))
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : '登录失败，请稍后重试'
        this.status = this.accessToken ? 'ready' : 'idle'
        throw error
      }
    },

    async register(phone: string, password: string, nickname: string): Promise<void> {
      this.status = 'busy'
      this.lastError = ''
      try {
        this.applySession(await authApi.register(phone.trim(), password, nickname.trim()))
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : '注册失败，请稍后重试'
        this.status = this.accessToken ? 'ready' : 'idle'
        throw error
      }
    },

    /** 拉取最新用户资料（登录状态校验：令牌失效会抛 401 并清空会话）。 */
    async ensureProfile(): Promise<void> {
      if (!this.accessToken) return
      try {
        this.user = await authApi.fetchMe()
        this.status = 'ready'
      } catch {
        // 401 已由 api 客户端清空令牌
        this.user = null
        this.accessToken = ''
        this.refreshToken = ''
        this.status = 'idle'
      }
    },

    async updateNickname(nickname: string): Promise<void> {
      this.user = await authApi.updateMe(nickname)
    },

    /** 退出登录：尽力通知后端撤销刷新令牌，失败不阻塞本地登出。 */
    async logout(): Promise<void> {
      const refreshToken = this.refreshToken || tokenStorage.refreshToken
      tokenStorage.clear()
      this.user = null
      this.accessToken = ''
      this.refreshToken = ''
      this.status = 'idle'
      this.lastError = ''
      if (refreshToken) {
        try { await authApi.logout(refreshToken) } catch { /* 忽略离线登出失败 */ }
      }
    },
  },
})

export type { TokenPair }
