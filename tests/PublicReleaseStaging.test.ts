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

const temporary: string[] = []
afterEach(async () => {
  // 每个测试只删除自身创建的临时目录。
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'zhiwellcare-public-test-'))
  temporary.push(directory)
  const bundle = join(directory, 'public')
  await mkdir(bundle)
  const prefix = `https://gitee.com/Syang03/zhiwell-care/releases/download/v${release.productVersion}/ZhiWellCare-${release.productVersion}`
  const sig = Buffer.from('untrusted comment: test fixture\nnot-a-real-signature').toString('base64')
  const names = [`ZhiWellCare-${release.productVersion}-android.apk`, `ZhiWellCare-${release.productVersion}-windows-x64-setup.exe`, `ZhiWellCare-${release.productVersion}-windows-x64-setup.exe.sig`]
  const assets = names.map((name) => ({ name, size: 100, sha256: 'a'.repeat(64) }))
  const android = { schemaVersion: 1, version: release.productVersion, displayVersion: release.displayVersion, versionCode: release.android.versionCode, publishedAt: '2026-10-14T01:00:00Z', notes: [], apk: { url: `${prefix}-android.apk`, size: 100, sha256: 'a'.repeat(64) } }
  const tauri = { version: release.productVersion, notes: '', pub_date: android.publishedAt, platforms: { 'windows-x86_64': { url: `${prefix}-windows-x64-setup.exe`, signature: sig } } }
  const info = { schemaVersion: 1, channel: 'stable', version: release.productVersion, displayVersion: release.displayVersion, versionCode: release.android.versionCode, publishedAt: android.publishedAt, assets }
  for (const [name, value] of [['android-latest.json', android], ['latest.json', tauri], ['release-info.json', info]]) await writeFile(join(bundle, name as string), JSON.stringify(value))
  await writeFile(join(bundle, 'release-notes.md'), '# V0.1\n修复更新。\n')
  await writeFile(join(bundle, 'SHA256SUMS.txt'), assets.map(({ name, sha256 }) => `${sha256}  ${name}\n`).join(''))
  const report = join(directory, 'remote-report.json')
  await writeFile(report, JSON.stringify({ verified: true, version: info.version, channel: info.channel, assets }))
  return { directory, bundle, report, info, options: { target: join(directory, 'publish'), 'public-dir': bundle, channel: 'stable', 'verification-report': report } }
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
})
