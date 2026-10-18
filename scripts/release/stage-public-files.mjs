import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { compareVersions, exists, isMain, parseArgs, readJson, requireArgs, root, validateVersionFile } from './common.mjs'
import { assertSafeTarget, canonicalPath, checkPublicBundle, checkPublicTree, publicFiles } from './check-public-staging.mjs'
import { manifestBindingSha256, validateManifests } from './verify-published-assets.mjs'

/** Prepare 之后可能已有新版发布，暂存前再次检查本地目标的两端指针。 */
async function assertChannelVersion(directory, channel, release, config) {
  const androidPath = resolve(directory, 'android-latest.json')
  const tauriPath = resolve(directory, 'latest.json')
  const hasAndroid = await exists(androidPath)
  const hasTauri = await exists(tauriPath)
  if (hasAndroid !== hasTauri) throw new Error('当前通道只有一端清单，不能视为首次发布。')
  if (!hasAndroid) return
  let current
  try {
    const android = await readJson(androidPath)
    const tauri = await readJson(tauriPath)
    // 先核对既有两端版本和清单身份，不从矛盾或损坏的指针推断基线。
    current = validateVersionFile({ schemaVersion: 1, productVersion: android?.version, displayVersion: android?.displayVersion,
      desktop: { version: tauri?.version }, android: { versionName: android?.version, versionCode: android?.versionCode } })
    validateManifests(android, tauri, current, config, channel)
  } catch {
    throw new Error('当前通道清单无效或两端版本不一致，暂存已停止。')
  }
  const versionChange = compareVersions(release.productVersion, current.productVersion)
  const codeChange = release.android.versionCode - current.android.versionCode
  if (versionChange < 0 || codeChange < 0) {
    throw new Error('候选产品版本或 Android versionCode 会使当前通道回退，暂存已停止。')
  }
  // 两者均相等允许幂等暂存；真正推进时必须保证 Windows 与 Android 都能升级。
  if ((versionChange !== 0 || codeChange !== 0) && (versionChange <= 0 || codeChange <= 0)) {
    throw new Error('推进通道时产品版本和 Android versionCode 必须同时严格递增，暂存已停止。')
  }
}

/** 只复制明确白名单，版本快照已存在且内容不同则失败，绝不递归复制整仓库。 */
export async function stagePublicFiles(options) {
  requireArgs(options, ['target', 'public-dir', 'channel', 'verification-report'])
  const target = await assertSafeTarget(options.target)
  const publicDir = await canonicalPath(resolve(root, options['public-dir']))
  const release = validateVersionFile(await readJson(options['version-file'] ?? 'release-version.json'))
  const config = await readJson(options.config ?? 'release-config.json')
  const info = await checkPublicBundle(publicDir, options.channel, release, config)
  // 远端完整附件验收与本批摘要一致后，才能暂存公开指针。
  const verification = await readJson(options['verification-report'])
  const android = await readJson(resolve(publicDir, 'android-latest.json'))
  const tauri = await readJson(resolve(publicDir, 'latest.json'))
  if (verification.verified !== true || verification.version !== info.version || verification.channel !== info.channel
    || JSON.stringify(verification.assets) !== JSON.stringify(info.assets)
    // 旧报告缺少绑定也必须拒绝，避免未验收的 URL、签名或发布时间进入通道。
    || verification.manifestBindingSha256 !== manifestBindingSha256(android, tauri)) throw new Error('缺少与本批附件及清单一致的远端完整下载验收报告。')
  await checkPublicTree(target)
  const channelDirectory = resolve(target, 'channels', options.channel)
  await assertChannelVersion(channelDirectory, options.channel, release, config)
  // staging 基线和正式首发都是 0.1.0，测试快照必须按通道及运行标签单独保存。
  const snapshot = options.channel === 'staging'
    ? `staging/${new URL((await readJson(resolve(publicDir, 'latest.json'))).platforms['windows-x86_64'].url).pathname.split('/').at(-2)}`
    : release.productVersion
  const versionDirectory = resolve(target, 'versions', snapshot)
  // 全部目标先检查再复制，避免检查到后一个文件才发现将覆盖正式版本。
  for (const name of publicFiles) {
    const destination = resolve(versionDirectory, name)
    if (await exists(destination) && !(await readFile(destination)).equals(await readFile(resolve(publicDir, name)))) throw new Error(`已存在不可变版本快照：${snapshot}/${name}。`)
  }
  await mkdir(versionDirectory, { recursive: true })
  await mkdir(channelDirectory, { recursive: true })
  for (const name of publicFiles) await copyFile(resolve(publicDir, name), resolve(versionDirectory, name))
  for (const name of ['android-latest.json', 'latest.json']) await copyFile(resolve(publicDir, name), resolve(channelDirectory, name))
  // 初始化仓库只放公开说明、忽略规则和健康探针，不创建伪造更新清单。
  if (!await exists(resolve(target, 'README.md'))) await writeFile(resolve(target, 'README.md'), '# 智为康乐发行资料\n\n本仓库仅提供安装包发行资料。软件源码授权请联系权利人。\n', 'utf8')
  if (!await exists(resolve(target, '.gitignore'))) await writeFile(resolve(target, '.gitignore'), '*.apk\n*.exe\n*.sig\n*.p12\n*.key\n.env*\nprivate/\n', 'utf8')
  await mkdir(resolve(target, 'health'), { recursive: true })
  if (!await exists(resolve(target, 'health/update-probe.json'))) await writeFile(resolve(target, 'health/update-probe.json'), '{"schemaVersion":1,"service":"zhiwellcare-release-probe","purpose":"anonymous-json-download-check"}\n', 'utf8')
  const files = await checkPublicTree(target)
  return { staged: true, version: info.version, channel: info.channel, files }
}

if (isMain(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2), ['target', 'public-dir', 'channel', 'version-file', 'config', 'verification-report'])
  console.log(JSON.stringify(await stagePublicFiles(options), null, 2))
}
