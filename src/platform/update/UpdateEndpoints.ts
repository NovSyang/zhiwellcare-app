// 此文件由 release-config.json 生成；Windows 实际入口还需同步 Tauri 配置。
export const UPDATE_CHANNEL: 'stable' | 'staging' = 'stable'

export const UPDATE_ENDPOINTS = {
  tauri: 'https://gitee.com/Syang03/zhiwell-care/raw/main/channels/stable/latest.json',
  android: 'https://gitee.com/Syang03/zhiwell-care/raw/main/channels/stable/android-latest.json',
} as const
