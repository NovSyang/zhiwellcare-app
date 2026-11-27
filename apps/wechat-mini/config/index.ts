import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { defineConfig } from '@tarojs/cli'

const sharedCore = resolve(__dirname, '../../../src/core')
const sharedData = resolve(__dirname, '../../../src/data')
const sharedTargetReach = resolve(__dirname, '../../../src/games/target-reach')
const sharedTrajectory = resolve(__dirname, '../../../src/games/trajectory-follow')
const sharedRiver = resolve(__dirname, '../../../src/games/river-drift')
const sharedKart = resolve(__dirname, '../../../src/games/kart-racing')
// 小程序版本只读取自己的清单，独立于 APP 发布版本。
const { version } = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8')) as { version?: string }
if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('小程序版本需要三个数字段。')

export default defineConfig({
  projectName: 'zhiwellcare-wechat-mini',
  designWidth: 750,
  sourceRoot: 'src',
  outputRoot: 'dist',
  framework: 'vue3',
  compiler: 'webpack5',
  // 始终替换为字面量，微信运行时没有 Node 的 process 对象。
  defineConstants: {
    __MINI_BUILD_VERSION__: JSON.stringify(version),
    __MINI_CATALOG_BASE_URL__: JSON.stringify(process.env.TARO_APP_API_BASE ?? ''),
  },
  // 复用 APP 原图，输出稳定的微信包根路径。
  copy: {
    patterns: [{
      from: resolve(__dirname, '../../../src/assets/mall'),
      to: resolve(__dirname, '../dist/assets/mall'),
    }],
    options: {},
  },
  alias: {
    // 微信使用受依赖检查的入口，避免引入 APP 专属模块。
    '@/shared/core': resolve(sharedCore, 'shared.ts'),
    '@/shared/courses': resolve(sharedData, 'courses.ts'),
    '@/shared/mall': resolve(__dirname, '../src/app/MiniMall.ts'),
    '@/shared/mall-catalog': resolve(sharedData, 'mall.catalog.ts'),
    '@/shared/target-replay': resolve(sharedTargetReach, 'replay/TargetReachReplayTimeline.ts'),
    '@/shared/target-viewport': resolve(sharedTargetReach, 'TargetReachViewportMapper.ts'),
    '@/shared/target-controller': resolve(sharedTargetReach, 'TargetReachController.ts'),
    '@/shared/target-config': resolve(sharedTargetReach, 'TargetReachGameConfig.ts'),
    '@/shared/target-result': resolve(sharedTargetReach, 'TargetReachResultPresentation.ts'),
    '@/shared/trajectory': resolve(sharedTrajectory, 'shared.ts'),
    '@/shared/river': resolve(sharedRiver, 'shared.ts'),
    '@/shared/kart': resolve(sharedKart, 'shared.ts'),
  },
  mini: {
    // 外部文件不在小程序的 src 目录内，需明确交给 Taro 编译。
    compile: { include: [sharedCore, sharedData, sharedTargetReach, sharedTrajectory, sharedRiver, sharedKart] },
  },
})
