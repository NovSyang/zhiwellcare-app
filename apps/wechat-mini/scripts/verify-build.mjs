import assert from 'node:assert/strict'
import console from 'node:console'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath, URL } from 'node:url'

const output = fileURLToPath(new URL('../dist/', import.meta.url))
const app = JSON.parse(readFileSync(join(output, 'app.json'), 'utf8'))
const project = JSON.parse(readFileSync(join(output, 'project.config.json'), 'utf8'))
const packages = app.subPackages ?? []
const routes = [...app.pages, ...packages.flatMap(({ root, pages }) => pages.map((page) => `${root}/${page}`))]
const common = readFileSync(join(output, 'common.js'), 'utf8')
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const lockfile = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'))

// 确保开发者工具能把构建目录直接作为小程序项目加载。
assert.equal(project.miniprogramRoot, './')
assert.equal(project.compileType, 'miniprogram')
assert.deepEqual(app.tabBar.list.map(({ text }) => text), ['设备', '训练', '课程', '商城', '我的'])
assert.equal(routes.length, 17)
assert.equal(packages.length, 5)

// 版本来自小程序独立清单，锁文件与实际注入的构建号保持一致。
assert.match(manifest.version, /^\d+\.\d+\.\d+$/)
assert.equal(lockfile.version, manifest.version)
assert.equal(lockfile.packages[''].version, manifest.version)
assert.ok(common.includes(JSON.stringify(manifest.version)), '小程序构建号未进入主包')

// 同时校验页面绑定、原生滚动节点及 WXSS，避免编译成功却无法滑动。
assert.ok(common.includes('mini-page-header'), '主包缺少通用页头组件')
const scrollBody = readFileSync(new URL('../src/components/app/MiniTabScrollBody.vue', import.meta.url), 'utf8')
assert.match(scrollBody, /<view\b[^>]*v-if="fallback"/, '尺寸不可用时必须使用普通 view')
const scrollTag = scrollBody.match(/<scroll-view\b[^>]*>/)?.[0] ?? ''
assert.match(scrollTag, /:scroll-y="true"/, '竖向原生滚动须使用布尔值')
assert.match(scrollTag, /:style="scrollStyle"/, '原生滚动区须接收实测高度')
const compiledScrollProps = common.match(/\{[^{}]*["']mini-tab-scroll["'][^{}]*}/g) ?? []
assert.ok(compiledScrollProps.some((props) => /["']scroll-y["']\s*:\s*(?:true|!0)\s*[,}]/.test(props)),
  '编译后的 Vue 正文没有给 scroll-y 传入 true')
const nativeTemplates = readFileSync(join(output, 'base.wxml'), 'utf8')
assert.match(nativeTemplates, /<scroll-view\b[^>]*\bscroll-y="\{\{[^"]+\}\}"/, '缺少绑定 scroll-y 的原生模板')
for (const [name, css] of [
  ['源样式', readFileSync(new URL('../src/app.css', import.meta.url), 'utf8')],
  ['生产 WXSS', readFileSync(join(output, 'app-origin.wxss'), 'utf8')],
]) {
  const rule = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/\.mini-tab-scroll\s*\{([^}]*)\}/)?.[1] ?? ''
  assert.match(rule, /(?:^|;)\s*height\s*:\s*calc\(\s*100vh\s*-/, `${name}缺少正文初始高度`)
  assert.doesNotMatch(rule, /(?:^|;)\s*(?:height\s*:\s*0|flex\s*:\s*1)(?:[\w.]|\s|;|$)/, `${name}仍依赖零高度 Flex 布局`)
}
assert.notEqual(app.window?.disableScroll, true, '全局配置禁止了 Tab 的降级原生滚动')
for (const { pagePath } of app.tabBar.list) {
  const source = readFileSync(new URL(`../src/${pagePath}.vue`, import.meta.url), 'utf8')
  assert.match(source, /import MiniPageHeader from ['"][^'"]*\/MiniPageHeader\.vue['"]/, pagePath)
  assert.match(source, /<MiniPageHeader\b/, pagePath)
  assert.equal([...source.matchAll(/<view\b[^>]*\bid="mini-tab-header"/g)].length, 1, `${pagePath} 缺少唯一的页头测量节点`)
  assert.match(source, /{[^}]*\bviewport\b[^}]*\bscrollStyle\b[^}]*\bfallbackPageScroll\b[^}]*}\s*=\s*useMiniTabPage\s*\(/, pagePath)
  assert.match(source, /<MiniTabScrollBody\b[^>]*:fallback="fallbackPageScroll"[^>]*:scroll-style="scrollStyle"/, pagePath)
  assert.ok(readFileSync(join(output, `${pagePath}.js`), 'utf8').includes('mini-tab-header'), `${pagePath} 未生成页头测量节点`)
  const config = JSON.parse(readFileSync(join(output, `${pagePath}.json`), 'utf8'))
  assert.notEqual(config.disableScroll, true, `${pagePath} 禁止了降级原生滚动`)
}

// 「我的」只负责导航，四个入口的目标均为可返回的分包竖屏页面。
const profileSource = readFileSync(new URL('../src/pages/profile/index.vue', import.meta.url), 'utf8')
assert.doesNotMatch(profileSource, /getTrainingRepository|TrainingGameHistoryCard|MiniUpdateSettingsCard|openPrivacyContract/)
for (const route of [
  'features/profile/settings/index', 'features/history/overview/index',
  'features/profile/update/index', 'features/profile/privacy/index',
]) {
  assert.ok(routes.includes(route) && !app.pages.includes(route), `缺少「我的」分包入口 ${route}`)
  assert.ok(profileSource.includes(`/${route}`), `「我的」未链接 ${route}`)
  const config = JSON.parse(readFileSync(join(output, `${route}.json`), 'utf8'))
  assert.equal(config.pageOrientation, 'portrait', route)
  assert.notEqual(config.disableScroll, true, route)
}
// 原生 Tab 的两态图标都必须来自构建包，且保持制作时的像素尺寸。
const tabIcons = app.tabBar.list.flatMap(({ iconPath, selectedIconPath }) => [iconPath, selectedIconPath])
assert.equal(new Set(tabIcons).size, 10)
for (const icon of tabIcons) {
  assert.match(icon, /^assets\/tabbar\/[a-z-]+\.png$/)
  const png = readFileSync(join(output, icon))
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', icon)
  assert.equal(png.readUInt32BE(16), 81, icon)
  assert.equal(png.readUInt32BE(20), 81, icon)
  assert.equal(png[25], 6, `${icon} 必须带透明通道`)
}

// 校验编译后的商品 ID 与包根路径，并确认复制的是 APP 原图。
const mallImages = new Map([
  ['wrist-wobble-trainer', 'wrist-motion-home-trainer.jpg'],
  ['adult-finger-separator-board', 'adult-finger-separator-board.jpg'],
  ['head-massager', 'head-massager.jpg'],
])
for (const [id, name] of mallImages) {
  const asset = `assets/mall/${name}`
  assert.ok(common.includes(`"${id}":"/${asset}"`), `商品 ${id} 缺少正确的包内图片映射`)
  const jpeg = readFileSync(join(output, asset))
  assert.equal(jpeg.subarray(0, 3).toString('hex'), 'ffd8ff', asset)
  assert.equal(jpeg.subarray(-2).toString('hex'), 'ffd9', asset)
  assert.ok(jpeg.equals(readFileSync(new URL(`../../../src/${asset}`, import.meta.url))), `${asset} 与 APP 原图不一致`)
}
for (const page of ['pages/shop/index.vue', 'features/content/goods/index.vue']) {
  const source = readFileSync(new URL(`../src/${page}`, import.meta.url), 'utf8')
  assert.match(source, /import GoodsCover from ['"][^'"]*\/GoodsCover\.vue['"]/, page)
  assert.match(source, /<GoodsCover\b/, page)
  assert.doesNotMatch(source, /<image\b/, page)
}

// 检查实际生成的局部方向配置，五个 Tab 继续使用默认方向。
const immersiveRoutes = [
  ['features/training/session/index', 'landscape', 'custom'],
  ['features/history/replay/index', 'landscape', 'custom'],
  ['features/training/result/index', 'portrait', 'default'],
  ['features/history/list/index', 'portrait', undefined],
  ['features/history/detail/index', 'portrait', undefined],
]
assert.notEqual(app.window?.pageOrientation, 'landscape')
for (const [route, orientation, navigationStyle] of immersiveRoutes) {
  assert.ok(routes.includes(route) && !app.pages.includes(route), `缺少分包页面 ${route}`)
  const config = JSON.parse(readFileSync(join(output, `${route}.json`), 'utf8'))
  assert.equal(config.pageOrientation, orientation, route)
  if (navigationStyle) assert.equal(config.navigationStyle, navigationStyle, route)
  if (orientation === 'landscape') assert.equal(config.disableScroll, true, route)
}

// 校验实际生成的训练页，避免把旧工具栏产物重新拿去扫码预览。
const trainingPage = join(output, 'features/training/session/index')
const trainingJs = readFileSync(`${trainingPage}.js`, 'utf8')
const trainingStyles = [...readFileSync(`${trainingPage}.wxss`, 'utf8').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
assert.ok(trainingJs.includes('--training-hud-top') && trainingJs.includes('training-action--trajectory'), '训练页缺少胶囊同排工具栏')
assert.match(trainingJs, / (?:↑|\\u2191)/i, '实时路线小窗缺少向上指示')
function assertTrainingStyle(selector, declaration) {
  const matches = trainingStyles.filter(([, selectors]) => selectors.split(',').some((item) => item.trim().endsWith(selector)))
  assert.ok(matches.some(([, , body]) => body.split(';').some((item) => declaration.test(item.trim()))), `训练页缺少样式 ${selector} ${declaration}`)
}
assertTrainingStyle('.training-hud-actions', /^flex-wrap:\s*nowrap$/)
assertTrainingStyle('button.training-action', /^width:\s*52px$/i)
assertTrainingStyle('button.training-action', /^height:\s*32px$/i)
assertTrainingStyle('button.training-action', /^align-items:\s*center$/)
assertTrainingStyle('button.training-action', /^justify-content:\s*center$/)
assertTrainingStyle('button.training-action--trajectory', /^width:\s*88px$/i)

for (const route of routes) {
  for (const extension of ['js', 'json', 'wxml']) {
    assert.ok(statSync(join(output, `${route}.${extension}`)).size > 0, `缺少 ${route}.${extension}`)
  }
}

const sizes = new Map([['主包', 0], ...packages.map(({ root }) => [root, 0])])
for (const file of readdirSync(output, { recursive: true, withFileTypes: true })) {
  if (!file.isFile()) continue
  const absolute = join(file.parentPath, file.name)
  const name = relative(output, absolute).replaceAll('\\', '/')
  if (file.name.endsWith('.js')) {
    // 独立检查生产产物，避免原 APP 的渲染器或 Node 运行时进入小程序。
    const js = readFileSync(absolute, 'utf8')
    assert.doesNotMatch(js, /pixi\.js|@pixi\/|@capacitor(?:-community)?\/|@tauri-apps\/|process\.env\.|require\(['"](?:node:|electron)/, name)
    assert.doesNotMatch(js, /(?:\.\.\/assets\/mall\/|assets\/images\/(?:wrist-motion-home-trainer|adult-finger-separator-board|head-massager))/, name)
  }
  const originalName = [...mallImages.values()].find((image) => file.name.startsWith(image.slice(0, -4)) && file.name.endsWith('.jpg'))
  if (originalName) assert.equal(name, `assets/mall/${originalName}`, `商品图片重复打包 ${name}`)
  const group = packages.find(({ root }) => name.startsWith(`${root}/`))?.root ?? '主包'
  sizes.set(group, sizes.get(group) + statSync(absolute).size)
}

console.log(`已验证构建版本 V${manifest.version}、${app.tabBar.list.length} 个 Tab 的共用页头、${tabIcons.length} 个两态图标、${routes.length} 个页面和 ${packages.length} 个分包。`)
for (const [name, bytes] of sizes) console.log(`${name}  ${(bytes / 1024).toFixed(1)} KiB`)
console.log(`总计  ${([...sizes.values()].reduce((total, size) => total + size, 0) / 1024).toFixed(1)} KiB`)
