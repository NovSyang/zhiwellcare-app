export const UPDATE_ENDPOINTS = {
  // 桌面端和 Android 都从当前项目仓库的 GitHub Release 获取更新清单。
  tauri: 'https://github.com/NovSyang/zhiwellcare-app/releases/latest/download/latest.json',
  android: 'https://github.com/NovSyang/zhiwellcare-app/releases/latest/download/android-latest.json',
} as const
