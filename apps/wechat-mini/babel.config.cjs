// 由 Taro 统一转换 Vue 3 和 TypeScript，供微信端运行。
module.exports = {
  presets: [['taro', { framework: 'vue3', ts: true, compiler: 'webpack5' }]],
}
