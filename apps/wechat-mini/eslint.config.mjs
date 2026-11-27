import js from '@eslint/js'
import vue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'

export default [
  { ignores: ['dist/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/essential'],
  {
    files: ['babel.config.cjs'],
    // Babel 从 Node 的 CommonJS 配置中读取 module.exports。
    languageOptions: { sourceType: 'commonjs' },
  },
  {
    files: ['**/*.vue'],
    // Vue 解析器负责模板，TypeScript 解析器负责 script 块。
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
      // 微信运行时提供计时器，活动范围页用它推进测量流程。
      globals: { setInterval: 'readonly', clearInterval: 'readonly' },
    },
  },
]
