import { createRouter, createWebHashHistory } from 'vue-router'
import { adminToken } from './api/token'
import AdminLayout from './layouts/AdminLayout.vue'
import LoginView from './views/LoginView.vue'
import DashboardView from './views/DashboardView.vue'
import DevicesView from './views/catalog/DevicesView.vue'
import GamesView from './views/catalog/GamesView.vue'
import UsersView from './views/users/UsersView.vue'
import RecordsView from './views/records/RecordsView.vue'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/login', component: LoginView, meta: { public: true } },
    {
      path: '/',
      component: AdminLayout,
      redirect: '/dashboard',
      children: [
        { path: 'dashboard', component: DashboardView, meta: { title: '仪表盘' } },
        { path: 'devices', component: DevicesView, meta: { title: '设备型号' } },
        { path: 'games', component: GamesView, meta: { title: '游戏目录' } },
        { path: 'users', component: UsersView, meta: { title: '用户管理' } },
        { path: 'records', component: RecordsView, meta: { title: '训练记录' } },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
  ],
})

router.beforeEach((to) => {
  if (!to.meta.public && !adminToken.get()) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }
  if (to.path === '/login' && adminToken.get()) return { path: '/dashboard' }
  return true
})
