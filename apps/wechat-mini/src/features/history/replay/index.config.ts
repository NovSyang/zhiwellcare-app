// 只让全屏回放横屏，原详情页继续显示竖屏成绩和回放。
export default definePageConfig({
  navigationBarTitleText: '训练回放',
  pageOrientation: 'landscape',
  navigationStyle: 'custom',
  disableScroll: true,
  backgroundColor: '#08111f',
})
