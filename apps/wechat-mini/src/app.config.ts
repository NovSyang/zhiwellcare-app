// 同一份导航定义用于页面注册和微信原生 TabBar。
const tabs = [
  { pagePath: 'pages/device/index', text: '设备', iconPath: 'assets/tabbar/device.png', selectedIconPath: 'assets/tabbar/device-selected.png' },
  { pagePath: 'pages/training/index', text: '训练', iconPath: 'assets/tabbar/training.png', selectedIconPath: 'assets/tabbar/training-selected.png' },
  { pagePath: 'pages/courses/index', text: '课程', iconPath: 'assets/tabbar/courses.png', selectedIconPath: 'assets/tabbar/courses-selected.png' },
  { pagePath: 'pages/shop/index', text: '商城', iconPath: 'assets/tabbar/shop.png', selectedIconPath: 'assets/tabbar/shop-selected.png' },
  { pagePath: 'pages/profile/index', text: '我的', iconPath: 'assets/tabbar/profile.png', selectedIconPath: 'assets/tabbar/profile-selected.png' },
]

export default defineAppConfig({
  pages: tabs.map(({ pagePath }) => pagePath),
  // 详情页按需加载，五个 Tab 保持在主包。
  subPackages: [
    { root: 'features/content', pages: ['course/index', 'goods/index'] },
    { root: 'features/history', pages: ['list/index', 'detail/index', 'replay/index'] },
    { root: 'features/settings', pages: ['range/index'] },
    { root: 'features/training', pages: ['session/index', 'result/index'] },
  ],
  window: {
    navigationBarTitleText: '智为康乐',
    // 原生标题栏沿用 APP 品牌蓝，列表背景保持浅蓝。
    navigationBarBackgroundColor: '#0436a7',
    navigationBarTextStyle: 'white',
    backgroundColor: '#f6f9fd',
  },
  tabBar: {
    color: '#55637b',
    selectedColor: '#0436a7',
    backgroundColor: '#ffffff',
    borderStyle: 'black',
    list: tabs,
  },
})
