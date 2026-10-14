import { lstat, readdir, readFile, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, parse, relative, resolve, sep } from 'node:path'
import { exists, isMain, parseArgs, readJson, requireArgs, root, semverPattern, validateVersionFile } from './common.mjs'
import { validateManifests } from './verify-published-assets.mjs'

export const publicFiles = ['android-latest.json', 'latest.json', 'release-notes.md', 'SHA256SUMS.txt', 'release-info.json']
const keysDirectory = 'D:/apps/dev/work/HandDevice/Keys'

/** 不存在的目标也解析其真实祖先，防止通过目录链接指向源码或 Keys。 */
export async function canonicalPath(value) {
  const absolute = resolve(value)
  if (await exists(absolute)) return realpath(absolute)
  const parent = dirname(absolute)
  if (parent === absolute) return absolute
  return resolve(await canonicalPath(parent), relative(parent, absolute))
}

function contains(parent, child) {
  const difference = relative(parent.toLowerCase(), child.toLowerCase())
  return difference === '' || (!difference.startsWith(`..${sep}`) && difference !== '..' && !isAbsolute(difference))
}

export async function assertSafeTarget(target, source = root, keys = keysDirectory) {
  const destination = await canonicalPath(target)
  const sourcePath = await canonicalPath(source)
  const keysPath = await canonicalPath(keys)
  if (destination === parse(destination).root || contains(destination, sourcePath) || contains(sourcePath, destination)
    || contains(destination, keysPath) || contains(keysPath, destination)) throw new Error('发布目标不能是磁盘根目录、源码、Keys 或其祖先/子目录。')
  return destination
}

export function assertPublicText(text) {
  // 公开文件禁止私钥、密码赋值、本机绝对路径；公钥与证书摘要可以公开。
  const privateMaterial = /-----BEGIN (?:[A-Z ]*PRIVATE KEY|ENCRYPTED PRIVATE KEY)-----|untrusted comment:\s*(?:minisign|tauri)\s+(?:encrypted\s+)?(?:secret|private) key\b/i
  if (privateMaterial.test(text)
    || /(?:password|passwd|token|secret|TAURI_SIGNING_PRIVATE_KEY|REHAB_ANDROID_STORE_PASSWORD|REHAB_ANDROID_KEY_PASSWORD)\s*["']?\s*[:=]\s*["']?[^\s"',}]+/i.test(text)
    || /\b[A-Z]:[\\/]|\\\\[^\s\\]+\\/i.test(text)
    || /https?:\/\/[^\s/]+:[^\s/]+@/i.test(text)) throw new Error('公开文件包含疑似秘密、凭据 URL 或本机绝对路径。')
  // Tauri 私钥采用外层 Base64；合法公开签名的“signature from tauri secret key”不属于私钥。
  for (const match of text.matchAll(/[A-Za-z0-9+/]{40,}={0,2}/g)) {
    if (privateMaterial.test(Buffer.from(match[0], 'base64').toString('utf8'))) {
      throw new Error('公开文件包含编码后的私钥材料。')
    }
  }
}

export async function checkPublicTree(directory, { bundle = false } = {}) {
  if (!await exists(directory)) return []
  const files = []
  async function visit(current, prefix = '') {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name
      const path = resolve(current, entry.name)
      const information = await lstat(path)
      if (information.isSymbolicLink()) throw new Error(`公开暂存不允许目录链接：${name}`)
      if (entry.name === '.git' && !prefix && !bundle && information.isDirectory()) continue
      if (entry.name === '.git' && !prefix && !bundle && information.isFile()) {
        // Git worktree 的 .git 是 gitdir 指针，属于 Git 元数据，不是公开发行资料。
        if (!/^gitdir: [^\r\n]+\r?\n?$/.test(await readFile(path, 'utf8'))) throw new Error('发布 worktree 的 .git 指针无效。')
        continue
      }
      if (information.isDirectory()) {
        if (bundle || !/^(?:health|channels|channels\/(?:stable|staging)|versions|versions\/(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)|versions\/staging|versions\/staging\/test-v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)-[A-Za-z0-9-]+)$/.test(name)) throw new Error(`公开暂存包含非白名单目录：${name}`)
        await visit(path, name)
      } else {
        const allowed = bundle ? publicFiles.includes(name) : ['README.md', '.gitignore', 'health/update-probe.json'].includes(name)
          || /^channels\/(stable|staging)\/(android-latest\.json|latest\.json)$/.test(name)
          || /^versions\/\d+\.\d+\.\d+\/(android-latest\.json|latest\.json|release-notes\.md|SHA256SUMS\.txt|release-info\.json)$/.test(name)
          || /^versions\/staging\/test-v\d+\.\d+\.\d+-[A-Za-z0-9-]+\/(android-latest\.json|latest\.json|release-notes\.md|SHA256SUMS\.txt|release-info\.json)$/.test(name)
        if (!allowed || !information.isFile()) throw new Error(`公开暂存包含非白名单文件：${name}`)
        if (information.size > 1024 * 1024) throw new Error(`公开资料超过 1 MiB：${name}`)
        assertPublicText(await readFile(path, 'utf8'))
        files.push(name)
      }
    }
  }
  await visit(directory)
  if (bundle && (files.length !== publicFiles.length || publicFiles.some((name) => !files.includes(name)))) throw new Error('公开候选必须且只能包含五份白名单资料。')
  return files
}

/** 通道来自公开 release-info，验证版不能被复制成 stable 指针。 */
export async function checkPublicBundle(directory, channel, release, config) {
  await checkPublicTree(directory, { bundle: true })
  validateVersionFile(release)
  if (!['stable', 'staging'].includes(channel)) throw new Error('未知发布通道。')
  const info = await readJson(resolve(directory, 'release-info.json'))
  const allowedKeys = ['schemaVersion', 'channel', 'version', 'displayVersion', 'versionCode', 'publishedAt', 'assets']
  if (Object.keys(info).some((name) => !allowedKeys.includes(name)) || info.schemaVersion !== 1 || info.channel !== channel
    || !semverPattern.test(info.version) || info.version !== release.productVersion || info.displayVersion !== release.displayVersion
    || info.versionCode !== release.android.versionCode || !Array.isArray(info.assets) || info.assets.length !== 3) throw new Error('公开 release-info 与本次版本/通道不一致或包含非公开字段。')
  const android = await readJson(resolve(directory, 'android-latest.json'))
  const tauri = await readJson(resolve(directory, 'latest.json'))
  const windows = validateManifests(android, tauri, release, config, channel)
  if (info.publishedAt !== android.publishedAt) throw new Error('公开资料发布时间不一致。')
  const urls = [android.apk.url, windows.url]
  const names = urls.map((url) => decodeURIComponent(new URL(url).pathname.split('/').at(-1)))
  names.push(`${names[1]}.sig`)
  const sums = await readFile(resolve(directory, 'SHA256SUMS.txt'), 'utf8')
  for (let index = 0; index < info.assets.length; index += 1) {
    const asset = info.assets[index]
    if (Object.keys(asset).some((name) => !['name', 'size', 'sha256'].includes(name)) || asset.name !== names[index]
      || !/^[a-f\d]{64}$/i.test(asset.sha256) || !Number.isSafeInteger(asset.size) || asset.size < 1) throw new Error('公开附件摘要列表无效。')
  }
  if (sums !== info.assets.map(({ name, sha256 }) => `${sha256}  ${name}\n`).join('')
    || info.assets[0].sha256 !== android.apk.sha256 || info.assets[0].size !== android.apk.size) throw new Error('汇总摘要与 Android 清单不一致。')
  const testUrl = (url) => /(?:staging|\/test-)/i.test(new URL(url).pathname)
  if (channel === 'stable' && urls.some(testUrl)) throw new Error('staging 附件不能进入 stable 清单。')
  if (channel === 'staging' && urls.some((url) => !testUrl(url))) throw new Error('staging 附件必须使用明显的验证版路由/文件名。')
  // 同一验证批次两端共用一个测试标签，快照按该标签归档。
  if (channel === 'staging' && new URL(urls[0]).pathname.split('/').at(-2) !== new URL(urls[1]).pathname.split('/').at(-2)) {
    throw new Error('staging 两端附件必须来自同一验证批次。')
  }
  return info
}

if (isMain(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2), ['target', 'source', 'keys'])
  requireArgs(options, ['target'])
  const target = await assertSafeTarget(options.target, options.source ?? root, options.keys ?? keysDirectory)
  console.log(JSON.stringify({ passed: true, files: await checkPublicTree(target) }, null, 2))
}
