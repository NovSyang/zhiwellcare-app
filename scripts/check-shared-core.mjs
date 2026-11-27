import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('../', import.meta.url))
const configPath = path.join(root, 'tsconfig.shared.json')
const config = ts.readConfigFile(configPath, ts.sys.readFile)
const options = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
const program = ts.createProgram(options.fileNames, options.options)
const errors = []
const forbidden = new Set([
  'window', 'document', 'HTMLElement', 'localStorage', 'indexedDB', 'ResizeObserver',
  'requestAnimationFrame', 'performance', 'wx', 'fetch', 'structuredClone', 'process',
])

// 用 TypeScript 解析后的文件检查真实传递依赖，注释不参与检查。
for (const source of program.getSourceFiles()) {
  if (source.isDeclarationFile) continue
  const relative = path.relative(root, source.fileName).split(path.sep).join('/')
  if (!relative.startsWith('src/core/') && !relative.startsWith('src/games/target-reach/')
    && !relative.startsWith('src/games/trajectory-follow/') && !relative.startsWith('src/games/river-drift/')
    && !relative.startsWith('src/games/kart-racing/') && relative !== 'src/data/catalog.ts') {
    errors.push(`共享代码引用了边界以外的文件：${relative}`)
    continue
  }
  const visit = (node, parent) => {
    const specifier = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier
    if (specifier && ts.isStringLiteral(specifier) && !specifier.text.startsWith('.')) {
      errors.push(`${relative} 引用了外部运行时：${specifier.text}`)
    }
    // 方法名和 obj.method 中的属性名不是全局变量引用。
    const memberName = parent && parent.name === node && (ts.isMethodDeclaration(parent)
      || ts.isPropertyAccessExpression(parent) && parent.expression.getText(source) !== 'globalThis')
    if (ts.isIdentifier(node) && forbidden.has(node.text) && !memberName) {
      errors.push(`${relative} 引用了平台变量：${node.text}`)
    }
    if (ts.isMetaProperty(node) || ts.isCallExpression(node)
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(source) === 'require')) {
      errors.push(`${relative} 使用了平台环境或动态模块加载`)
    }
    ts.forEachChild(node, (child) => visit(child, node))
  }
  visit(source)
}

if (errors.length) {
  console.error(errors.join('\n'))
  process.exitCode = 1
} else {
  console.log('共享 Core 依赖检查通过。')
}
