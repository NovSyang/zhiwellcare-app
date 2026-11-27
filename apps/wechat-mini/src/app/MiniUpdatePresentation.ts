import type { MiniUpdateService } from './MiniUpdateService'

// 首页和更新页使用同一组文案，状态仍由微信原生更新服务提供。
export function miniUpdateStatusText(snapshot: ReturnType<MiniUpdateService['getSnapshot']>, compact = false) {
  if (snapshot.applying) return '正在应用更新'
  switch (snapshot.state) {
    case 'waiting-check': return '等待微信检查更新'
    case 'up-to-date': return '本次检查未发现新版本'
    case 'downloading': return '微信正在下载新版本'
    case 'ready': return compact || snapshot.safe ? '新版本已下载' : '新版本已下载，将在安全时机提示'
    case 'failed': return compact ? '更新下载失败' : '下载失败，请检查网络并稍后重新打开小程序'
    case 'applying': return '正在应用更新'
    case 'unsupported': return '当前环境不支持自动更新'
  }
}
