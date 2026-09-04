<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../../stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const nickname = ref('')
const phone = ref('')
const password = ref('')
const confirm = ref('')
const busy = ref(false)

function redirectTarget(): string {
  const query = typeof route.query.redirect === 'string' ? route.query.redirect : ''
  return query.startsWith('/') && !query.startsWith('//') ? query : '/mine'
}

async function submit(): Promise<void> {
  if (busy.value) return
  auth.lastError = ''
  if (nickname.value.trim().length > 20) {
    auth.lastError = '昵称最长 20 个字符'
    return
  }
  if (!/^1[3-9]\d{9}$/.test(phone.value.trim())) {
    auth.lastError = '请输入正确的手机号'
    return
  }
  if (password.value.length < 6) {
    auth.lastError = '密码至少 6 位'
    return
  }
  if (password.value !== confirm.value) {
    auth.lastError = '两次输入的密码不一致'
    return
  }
  busy.value = true
  try {
    // 注册成功即自动登录（后端返回令牌）
    await auth.register(phone.value, password.value, nickname.value)
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
          <h1>注册智为康乐账号</h1>
          <p>一个账号，同步全部训练数据</p>
        </div>
      </div>

      <form @submit.prevent="submit">
        <div class="auth-field">
          <label for="reg-nickname">昵称（选填）</label>
          <input id="reg-nickname" v-model="nickname" class="auth-input" type="text" maxlength="20"
                 autocomplete="nickname" placeholder="怎么称呼你？" />
        </div>
        <div class="auth-field">
          <label for="reg-phone">手机号</label>
          <input id="reg-phone" v-model="phone" class="auth-input" type="tel" inputmode="numeric"
                 maxlength="11" autocomplete="tel" placeholder="请输入 11 位手机号" />
        </div>
        <div class="auth-field">
          <label for="reg-password">设置密码</label>
          <input id="reg-password" v-model="password" class="auth-input" type="password" maxlength="64"
                 autocomplete="new-password" placeholder="至少 6 位，区分大小写" />
        </div>
        <div class="auth-field">
          <label for="reg-confirm">确认密码</label>
          <input id="reg-confirm" v-model="confirm" class="auth-input" type="password" maxlength="64"
                 autocomplete="new-password" placeholder="再次输入密码" />
        </div>

        <p v-if="auth.lastError" class="auth-error">{{ auth.lastError }}</p>

        <button class="button primary auth-submit" type="submit" :disabled="busy">
          {{ busy ? '注册中…' : '注册并登录' }}
        </button>
      </form>

      <p class="auth-switch">已有账号？<RouterLink to="/auth/login">直接登录</RouterLink></p>
      <RouterLink class="auth-guest" to="/devices">先逛逛，暂不登录 →</RouterLink>
    </section>
  </main>
</template>
