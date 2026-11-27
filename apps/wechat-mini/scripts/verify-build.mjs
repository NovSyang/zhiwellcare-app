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

// 商品图从主项目共享，只有实际进入微信包的资源才能在手机上读取。
for (const name of ['wrist-motion-home-trainer', 'adult-finger-separator-board', 'head-massager']) {
  const asset = common.match(new RegExp(`assets/images/${name}\\.[0-9a-f]+\\.jpg`))?.[0]
  assert.ok(asset, `缺少包内商品图引用 ${name}`)
  assert.ok(statSync(join(output, asset)).size > 0, `缺少商品图文件 ${asset}`)
}
assert.ok(routes.includes('features/training/session/index'), '缺少训练分包入口')
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
    assert.doesNotMatch(readFileSync(absolute, 'utf8'),
      /pixi\.js|@pixi\/|@capacitor(?:-community)?\/|@tauri-apps\/|process\.env\.|require\(['"](?:node:|electron)/, name)
  }
  const group = packages.find(({ root }) => name.startsWith(`${root}/`))?.root ?? '主包'
  sizes.set(group, sizes.get(group) + statSync(absolute).size)
}

console.log(`已验证 ${app.tabBar.list.length} 个 Tab、${tabIcons.length} 个两态图标、${routes.length} 个页面和 ${packages.length} 个分包。`)
for (const [name, bytes] of sizes) console.log(`${name}  ${(bytes / 1024).toFixed(1)} KiB`)
console.log(`总计  ${([...sizes.values()].reduce((total, size) => total + size, 0) / 1024).toFixed(1)} KiB`)
