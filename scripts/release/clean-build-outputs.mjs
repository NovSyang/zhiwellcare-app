import { realpath, unlink } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { exists, isMain, parseArgs, requireArgs, root } from './common.mjs'

/** 只清理三个明确构建文件，强制重新输出最终包，避免误用增量构建遗留包。 */
export async function cleanBuildOutputs(options) {
  requireArgs(options, ['apk', 'artifact', 'signature'])
  const allowedApk = resolve(root, 'android/app/build/outputs/apk/release/app-release.apk')
  const allowedExe = resolve(root, 'src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis')
  const candidates = [resolve(options.apk), resolve(options.artifact), resolve(options.signature)]
  if (candidates[0] !== allowedApk || !candidates[1].startsWith(`${allowedExe}${sep}`)
    || !/^ZhiWellCare_\d+\.\d+\.\d+_x64-setup\.exe$/.test(relative(allowedExe, candidates[1]))
    || candidates[2] !== `${candidates[1]}.sig`) throw new Error('只允许清理本工作区明确的 APK/NSIS 构建输出。')
  // 先核对所有真实路径，再删除文件；不允许借助目录链接越过工程边界。
  for (const path of candidates) if (await exists(path)) {
    const difference = relative(await realpath(root), await realpath(path))
    if (isAbsolute(difference) || difference === '..' || difference.startsWith(`..${sep}`)) throw new Error('构建输出真实路径超出源码工作区。')
  }
  for (const path of candidates) if (await exists(path)) await unlink(path)
}

if (isMain(import.meta.url)) {
  await cleanBuildOutputs(parseArgs(process.argv.slice(2), ['apk', 'artifact', 'signature']))
  console.log('已清理三个明确构建产物，归档文件未受影响。')
}
