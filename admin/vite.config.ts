import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 管理后台开发：/api 代理到本地 Golang 后端，规避跨域。
export default defineConfig({
  plugins: [vue()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
  build: { target: 'es2022' },
})
