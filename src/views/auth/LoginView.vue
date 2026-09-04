<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../../stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const phone = ref('')
const password = ref('')
const busy = ref(false)

/** 登录成功后的落地页（校验只允许站内路径）。 */
function redirectTarget(): string {
  const query = typeof route.query.redirect === 'string' ? route.query.redirect : ''
  return query.startsWith('/') && !query.startsWith('//') ? query : '/mine'
}

async function submit(): Promise<void> {
  if (busy.value) return
  auth.lastError = ''
  if (!/^1[3-9]\d{9}$/.test(phone.value.trim())) {
    auth.lastError = '请输入正确的手机号'
    return
  }
  if (!password.value) {
    auth.lastError = '请输入密码'
    return
  }
  busy.value = true
  try {
    await auth.login(phone.value, password.value)
    await router.replace(redirectTarget())
  } catch {
    // 错误信息已写入 auth.lastError
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="auth-page">
    <section class="auth-card">
      <div class="auth-brand">
        <span class="auth-brand-logo">康</span>
        <div>
          <h1>登录智为康乐</h1>
          <p>同步训练数据 · 订单与服务统一管理</p>
        </div>
      </div>

      <form @submit.prevent="submit">
        <div class="auth-field">
          <label for="login-phone">手机号</label>
          <input id="login-phone" v-model="phone" class="auth-input" type="tel" inputmode="numeric"
                 maxlength="11" autocomplete="tel" placeholder="请输入 11 位手机号" />
        </div>
        <div class="auth-field">
          <label for="login-password">密码</label>
          <input id="login-password" v-model="password" class="auth-input" type="password"
                 maxlength="64" autocomplete="current-password" placeholder="请输入密码（至少 6 位）" />
        </div>

        <p v-if="auth.lastError" class="auth-error">{{ auth.lastError }}</p>

        <button class="button primary auth-submit" type="submit" :disabled="busy">
          {{ busy ? '登录中…' : '登 录' }}
        </button>
      </form>

      <p class="auth-switch">还没有账号？<RouterLink to="/auth/register">立即注册</RouterLink></p>
      <p class="auth-tip">注册即表示同意《免责声明与隐私说明》</p>
      <RouterLink class="auth-guest" to="/devices">先逛逛，暂不登录 →</RouterLink>
    </section>
  </main>
</template>
