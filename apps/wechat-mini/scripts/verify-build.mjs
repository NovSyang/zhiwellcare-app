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

// 确保开发者工具能把构建目录直接作为小程序项目加载。
assert.equal(project.miniprogramRoot, './')
assert.equal(project.compileType, 'miniprogram')
assert.deepEqual(app.tabBar.list.map(({ text }) => text), ['设备', '训练', '课程', '商城', '我的'])
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

console.log(`已验证 ${app.tabBar.list.length} 个 Tab、${tabIcons.length} 个两态图标、${routes.length} 个页面和 ${packages.length} 个分包。`)
for (const [name, bytes] of sizes) console.log(`${name}  ${(bytes / 1024).toFixed(1)} KiB`)
console.log(`总计  ${([...sizes.values()].reduce((total, size) => total + size, 0) / 1024).toFixed(1)} KiB`)
