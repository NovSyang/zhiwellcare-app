import type { CapacitorConfig } from '@capacitor/cli'

/**
 * 智为康乐多端统一架构：手机/平板/Windows/网页共享同一份 Vue+PixiJS 构建产物，
 * 平台差异只放在 src/platform 原生适配层（BLE、常亮、更新、返回键等）。
 */
const config: CapacitorConfig = {
  appId: 'com.zhiwellcare.app',
  appName: '智为康乐',
  webDir: 'dist',
  plugins: {
    App: {
      // 由应用统一处理训练确认、路由返回和根页面最小化。
      disableBackButtonHandler: true,
    },
  },
}

export default config
