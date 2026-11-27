import { createApp } from 'vue'
import { launchMiniServices, miniPinia, resumeMiniServices, suspendMiniServices } from './app/MiniServices'
import './app.css'

// 应用级生命周期覆盖进入系统后台的情况，避免仅依赖某个 Tab 的事件。
const app = createApp({
  onLaunch: launchMiniServices,
  onShow: resumeMiniServices,
  onHide: suspendMiniServices,
})

// 页面与设备服务使用同一个状态实例。
app.use(miniPinia)
export default app
