import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import release from '../release-version.json'
import config from '../release-config.json'
import { assertPublicText, assertSafeTarget, checkPublicBundle, checkPublicTree, publicFiles } from '../scripts/release/check-public-staging.mjs'
import { stagePublicFiles } from '../scripts/release/stage-public-files.mjs'
import { generatePublicMetadata } from '../scripts/release/generate-public-metadata.mjs'
import { hashFile } from '../scripts/release/common.mjs'
import { manifestBindingSha256 } from '../scripts/release/verify-published-assets.mjs'

const temporary: string[] = []
// 从当前源码版本派生后继版本，staging 提升后测试仍保持相同语义。
const versionParts = release.productVersion.split('.')
const nextVersion = `${versionParts[0]}.${versionParts[1]}.${BigInt(versionParts[2]) + 1n}`
const nextRelease = { ...release, productVersion: nextVersion, displayVersion: nextVersion,
  desktop: { ...release.desktop, version: nextVersion },
  android: { ...release.android, versionName: nextVersion, versionCode: release.android.versionCode + 1 } }
afterEach(async () => {
  // 每个测试只删除自身创建的临时目录。
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function fixture(candidateRelease = release) {
  const directory = await mkdtemp(join(tmpdir(), 'zhiwellcare-public-test-'))
  temporary.push(directory)
  const bundle = join(directory, 'public')
  await mkdir(bundle)
  const prefix = `https://gitee.com/Syang03/zhiwell-care/releases/download/v${candidateRelease.productVersion}/ZhiWellCare-${candidateRelease.productVersion}`
  const sig = Buffer.from('untrusted comment: test fixture\nnot-a-real-signature').toString('base64')
  const names = [`ZhiWellCare-${candidateRelease.productVersion}-android.apk`, `ZhiWellCare-${candidateRelease.productVersion}-windows-x64-setup.exe`, `ZhiWellCare-${candidateRelease.productVersion}-windows-x64-setup.exe.sig`]
  const assets = names.map((name) => ({ name, size: 100, sha256: 'a'.repeat(64) }))
  const android = { schemaVersion: 1, version: candidateRelease.productVersion, displayVersion: candidateRelease.displayVersion, versionCode: candidateRelease.android.versionCode, publishedAt: '2026-10-14T01:00:00Z', notes: [], apk: { url: `${prefix}-android.apk`, size: 100, sha256: 'a'.repeat(64) } }
  const tauri = { version: candidateRelease.productVersion, notes: '', pub_date: android.publishedAt, platforms: { 'windows-x86_64': { url: `${prefix}-windows-x64-setup.exe`, signature: sig } } }
  const info = { schemaVersion: 1, channel: 'stable', version: candidateRelease.productVersion, displayVersion: candidateRelease.displayVersion, versionCode: candidateRelease.android.versionCode, publishedAt: android.publishedAt, assets }
  for (const [name, value] of [['android-latest.json', android], ['latest.json', tauri], ['release-info.json', info]]) await writeFile(join(bundle, name as string), JSON.stringify(value))
  await writeFile(join(bundle, 'release-notes.md'), '# V0.1\n修复更新。\n')
  await writeFile(join(bundle, 'SHA256SUMS.txt'), assets.map(({ name, sha256 }) => `${sha256}  ${name}\n`).join(''))
  const report = join(directory, 'remote-report.json')
  // 合成报告只用于暂存边界测试，不能作为真实附件验收证据。
  await writeFile(report, JSON.stringify({ verified: true, version: info.version, channel: info.channel, assets, manifestBindingSha256: manifestBindingSha256(android, tauri) }))
  // 后继候选使用独立临时版本文件，不改工作树中的真实版本配置。
  const versionFile = join(directory, 'release-version.json')
  await writeFile(versionFile, JSON.stringify(candidateRelease))
  return { directory, bundle, report, info, options: { target: join(directory, 'publish'), 'public-dir': bundle, channel: 'stable', 'verification-report': report, 'version-file': versionFile } }
}

/** 只写合成的既有指针，验证准备候选后通道已被另一批发布推进的时序。 */
async function currentChannel(value: Awaited<ReturnType<typeof fixture>>, version: string, versionCode: number) {
  const directory = join(value.options.target, 'channels/stable')
  await mkdir(directory, { recursive: true })
  for (const name of ['android-latest.json', 'latest.json']) {
    const manifest = JSON.parse((await readFile(join(value.bundle, name), 'utf8')).replaceAll(value.info.version, version))
    if (name === 'android-latest.json') {
      manifest.displayVersion = version.endsWith('.0') ? version.slice(0, -2) : version
      manifest.versionCode = versionCode
    }
    await writeFile(join(directory, name), JSON.stringify(manifest))
  }
  return directory
}

describe('公开发布白名单', () => {
  it('拒绝源码、Keys、磁盘根目录及危险祖先/子目录', async () => {
    const source = resolve(import.meta.dirname, '..')
    for (const target of [source, resolve(source, 'release-output'), resolve(source, '..'), 'D:/', 'D:/apps/dev/work/HandDevice/Keys', 'D:/apps/dev/work/HandDevice/Keys/Tauri']) {
      await expect(assertSafeTarget(target)).rejects.toThrow('发布目标')
    }
  })

  it('只复制五份公开资料，完整保留三份摘要且快照不能覆盖', async () => {
    const value = await fixture()
    await expect(stagePublicFiles(value.options)).resolves.toMatchObject({ staged: true, version: release.productVersion })
    // 内容完全相同的候选重跑允许成功，避免把幂等操作误判成回退。
    await expect(stagePublicFiles(value.options)).resolves.toMatchObject({ staged: true })
    const files = await checkPublicTree(value.options.target)
    for (const name of publicFiles) expect(files).toContain(`versions/${release.productVersion}/${name}`)
    expect(files).not.toContain('remote-report.json')
    expect((await readFile(join(value.options.target, 'versions', release.productVersion, 'SHA256SUMS.txt'), 'utf8')).trim().split('\n')).toHaveLength(3)
    await writeFile(join(value.bundle, 'release-notes.md'), '改写已发布同版本')
    await expect(stagePublicFiles(value.options)).rejects.toThrow('不可变')
  })

  it('目标或候选意外包含私钥、环境文件、日志时拒绝', async () => {
    for (const name of ['test.p12', 'secret.key', '.env', '签名信息文档.txt', 'validation-report.json']) {
      const value = await fixture()
      await writeFile(join(value.bundle, name), 'private')
      await expect(stagePublicFiles(value.options)).rejects.toThrow('白名单')
    }
    const value = await fixture()
    await mkdir(value.options.target)
    await writeFile(join(value.options.target, 'secret.key'), 'private')
    await expect(stagePublicFiles(value.options)).rejects.toThrow('白名单')
  })

  it('由三个真实文件一次生成摘要，保留 APK、EXE 和 EXE.sig', async () => {
    // 此处验证聚合摘要，不把文本测试文件当成经过签名的真实安装包。
    const value = await fixture()
    const artifacts = join(value.directory, 'artifacts')
    await mkdir(artifacts)
    const android = JSON.parse(await readFile(join(value.bundle, 'android-latest.json'), 'utf8'))
    const tauri = JSON.parse(await readFile(join(value.bundle, 'latest.json'), 'utf8'))
    const contents = ['apk-test-bytes', 'exe-test-bytes', tauri.platforms['windows-x86_64'].signature]
    for (let index = 0; index < 3; index += 1) await writeFile(join(artifacts, value.info.assets[index].name), contents[index])
    const apkDigest = await hashFile(join(artifacts, value.info.assets[0].name))
    await writeFile(join(value.bundle, 'android-latest.json'), JSON.stringify({ ...android, apk: { ...android.apk, ...apkDigest } }))
    const info = await generatePublicMetadata({ channel: 'stable', 'public-dir': value.bundle, 'artifacts-dir': artifacts, notes: join(value.bundle, 'release-notes.md') })
    expect(info.assets).toHaveLength(3)
    for (const asset of info.assets) expect(asset).toMatchObject(await hashFile(join(artifacts, asset.name)))
    expect((await readFile(join(value.bundle, 'SHA256SUMS.txt'), 'utf8')).trim().split('\n')).toHaveLength(3)
  })

  it('拒绝通道混入、绝对路径、密码和不一致远端验收', async () => {
    const value = await fixture()
    await writeFile(join(value.bundle, 'release-info.json'), JSON.stringify({ ...value.info, channel: 'staging' }))
    await expect(checkPublicBundle(value.bundle, 'stable', release, config)).rejects.toThrow('通道')
    for (const text of ['password=secret-value', 'D:\\apps\\secret.txt', '-----BEGIN PRIVATE KEY-----', 'https://user:pass@example.com/app']) expect(() => assertPublicText(text)).toThrow('秘密')
    const other = await fixture()
    await writeFile(other.report, JSON.stringify({ verified: false }))
    await expect(stagePublicFiles(other.options)).rejects.toThrow('验收报告')
  })

  it.each(['signature', 'publishedAt'])('候选 %s 改动后不能复用原远端成功报告', async (field) => {
    // 附件摘要保持不变，单独复现旧报告未绑定清单内容的问题。
    const value = await fixture()
    const android = JSON.parse(await readFile(join(value.bundle, 'android-latest.json'), 'utf8'))
    const tauri = JSON.parse(await readFile(join(value.bundle, 'latest.json'), 'utf8'))
    if (field === 'signature') {
      tauri.platforms['windows-x86_64'].signature = Buffer.from('untrusted comment: changed signature\nnot-a-real-signature').toString('base64')
    } else {
      android.publishedAt = '2026-10-15T01:00:00Z'
      tauri.pub_date = android.publishedAt
      await writeFile(join(value.bundle, 'release-info.json'), JSON.stringify({ ...value.info, publishedAt: android.publishedAt }))
    }
    await writeFile(join(value.bundle, 'android-latest.json'), JSON.stringify(android))
    await writeFile(join(value.bundle, 'latest.json'), JSON.stringify(tauri))
    await expect(stagePublicFiles(value.options)).rejects.toThrow('验收报告')
  })

  it('拒绝缺少清单绑定的旧成功报告', async () => {
    // 不能把历史 verified:true 自动升级为本次完整清单的验收结果。
    const value = await fixture()
    const report = JSON.parse(await readFile(value.report, 'utf8'))
    delete report.manifestBindingSha256
    await writeFile(value.report, JSON.stringify(report))
    await expect(stagePublicFiles(value.options)).rejects.toThrow('验收报告')
  })

  it.each([
    { kind: '产品版本', version: nextVersion, versionCode: release.android.versionCode },
    { kind: 'Android code', version: release.productVersion, versionCode: release.android.versionCode + 1 },
  ])('旧候选不能降低目标通道的 $kind', async ({ version, versionCode }) => {
    const value = await fixture()
    const directory = await currentChannel(value, version, versionCode)
    const original = await readFile(join(directory, 'android-latest.json'), 'utf8')
    await expect(stagePublicFiles(value.options)).rejects.toThrow('回退')
    expect(await readFile(join(directory, 'android-latest.json'), 'utf8')).toBe(original)
  })

  it.each(['一端缺失', '两端版本不一致'])('既有通道%s时拒绝推进', async (failure) => {
    // 不完整或自相矛盾的基线不能当成首次发布处理。
    const value = await fixture()
    const directory = await currentChannel(value, release.productVersion, release.android.versionCode)
    const windowsPath = join(directory, 'latest.json')
    if (failure === '一端缺失') await rm(windowsPath)
    else {
      const windows = JSON.parse(await readFile(windowsPath, 'utf8'))
      windows.version = nextVersion
      await writeFile(windowsPath, JSON.stringify(windows))
    }
    await expect(stagePublicFiles(value.options)).rejects.toThrow('通道')
  })

  it('既有通道基线有效且候选版本更高时允许推进', async () => {
    // 产品版本与 code 同时递增，模拟真实后继候选，基线 code 无须降为零。
    const value = await fixture(nextRelease)
    const directory = await currentChannel(value, release.productVersion, release.android.versionCode)
    await expect(stagePublicFiles(value.options)).resolves.toMatchObject({ staged: true })
    expect(JSON.parse(await readFile(join(directory, 'latest.json'), 'utf8')).version).toBe(nextVersion)
  })

  it.each(['仅产品版本递增', '仅 Android code 递增'])('%s时拒绝推进', async (kind) => {
    // 单端版本不动会使另一套设备看不到可安装更新，不能写入新活动指针。
    const candidate = kind === '仅产品版本递增'
      ? { ...nextRelease, android: { ...nextRelease.android, versionCode: release.android.versionCode } }
      : { ...release, android: { ...release.android, versionCode: release.android.versionCode + 1 } }
    const value = await fixture(candidate)
    await currentChannel(value, release.productVersion, release.android.versionCode)
    await expect(stagePublicFiles(value.options)).rejects.toThrow('严格递增')
  })
})
