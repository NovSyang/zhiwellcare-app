import { defineStore } from 'pinia'
import { api } from '../api/http'
import { adminToken } from '../api/token'

export interface AdminUser {
  id: string
  phoneMasked: string
  nickname: string
  role: string
}

export const useAdminAuthStore = defineStore('adminAuth', {
  state: () => ({
    token: '',
    user: null as AdminUser | null,
    busy: false,
    error: '',
  }),
  getters: {
    isLoggedIn: (state) => state.token !== '',
  },
  actions: {
    restore(): void {
      this.token = adminToken.get()
    },
    async login(phone: string, password: string): Promise<void> {
      this.busy = true
      this.error = ''
      try {
        const data = await api.post<{ user: AdminUser; tokens: { accessToken: string } }>('/auth/login', { phone, password })
        this.user = data.user
        this.token = data.tokens.accessToken
        adminToken.set(data.tokens.accessToken)
      } catch (error) {
        this.error = error instanceof Error ? error.message : '登录失败'
        throw error
      } finally {
        this.busy = false
      }
    },
    logout(): void {
      this.token = ''
      this.user = null
      adminToken.clear()
    },
  },
})
