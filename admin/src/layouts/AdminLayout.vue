<script setup lang="ts">
import { computed } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { useAdminAuthStore } from '../stores/adminAuth'

const auth = useAdminAuthStore()
const route = useRoute()
const router = useRouter()

const menus = [
  { path: '/dashboard', label: '仪表盘', icon: '📊' },
  { path: '/devices', label: '设备型号', icon: '⌚' },
  { path: '/games', label: '游戏目录', icon: '🎯' },
  { path: '/users', label: '用户管理', icon: '👥' },
  { path: '/records', label: '训练记录', icon: '📈' },
]

const activeMenu = computed(() => menus.find((item) => route.path.startsWith(item.path))?.path ?? '/dashboard')

function logout(): void {
  auth.logout()
  void router.replace('/login')
}
</script>

<template>
  <el-container class="shell">
    <el-aside width="210px" class="aside">
      <div class="brand">
        <span class="brand-logo">康</span>
        <div class="brand-text">
          <strong>智为康乐</strong>
          <small>运营管理后台</small>
        </div>
      </div>
      <el-menu :default-active="activeMenu" router class="menu">
        <el-menu-item v-for="menu in menus" :key="menu.path" :index="menu.path">
          <span class="menu-ic">{{ menu.icon }}</span>
          <span>{{ menu.label }}</span>
        </el-menu-item>
      </el-menu>
      <div class="aside-foot">
        <a class="to-app" href="http://localhost:1420/" target="_blank" rel="noreferrer">打开用户端 APP ↗</a>
        <p class="comply">纯消费版主动训练目录管理 · 医疗红线同 APP</p>
      </div>
    </el-aside>
    <el-container>
      <el-header class="header">
        <h2>{{ menus.find((item) => item.path === activeMenu)?.label ?? '' }}</h2>
        <el-dropdown @command="logout">
          <span class="user">
            <el-avatar :size="30" style="background: #0436a7">{{ (auth.user?.nickname || '管').slice(0, 1) }}</el-avatar>
            <span class="user-name">{{ auth.user?.nickname || auth.user?.phoneMasked || '管理员' }}</span>
            <span class="caret">⌄</span>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="logout">退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </el-header>
      <el-main class="main">
        <RouterView />
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.shell { height: 100vh; }
.aside { background: #fff; border-right: 1px solid #e4eaf2; display: flex; flex-direction: column; }
.brand { display: flex; gap: 10px; align-items: center; padding: 18px 16px 12px; }
.brand-logo { width: 38px; height: 38px; border-radius: 10px; display: grid; place-items: center;
  background: linear-gradient(135deg, #0436a7, #0dd5c1); color: #fff; font-size: 20px; font-weight: 800; }
.brand-text { display: grid; line-height: 1.3; }
.brand-text strong { font-size: 16px; }
.brand-text small { color: #8593a8; font-size: 12px; }
.menu { border-right: 0; flex: 1; }
.menu-ic { margin-right: 8px; }
.aside-foot { padding: 12px 16px; }
.to-app { font-size: 13px; color: #0436a7; text-decoration: none; }
.comply { color: #8593a8; font-size: 11px; line-height: 1.6; margin: 8px 0 0; }
.header { background: #fff; border-bottom: 1px solid #e4eaf2; display: flex; align-items: center;
  justify-content: space-between; }
.header h2 { font-size: 17px; margin: 0; }
.user { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.user-name { font-size: 14px; }
.caret { color: #8593a8; font-size: 12px; }
.main { background: #f3f6fb; padding: 18px; }
</style>
