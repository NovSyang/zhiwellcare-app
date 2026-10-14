import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import release from '../release-version.json'
import signing from '../release-signing.json'
import { assertPublicText, checkPublicTree } from '../scripts/release/check-public-staging.mjs'
import { stagePublicFiles } from '../scripts/release/stage-public-files.mjs'

const directories: string[] = []
afterEach(async () => {
  // 测试目录均由 mkdtemp 创建，清理范围不包含源码或 Keys。
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

/** 此处模拟已验收输入，只验证公开快照路径隔离，不声称进行真实下载和签包。 */
async function candidate(parent: string, channel: 'stable' | 'staging', runId = 'run-01') {
  const tag = channel === 'stable' ? `v${release.productVersion}` : `test-v${release.productVersion}-${runId}`
  const prefix = `ZhiWellCare-${release.productVersion}${channel === 'staging' ? '-staging' : ''}`
  const folder = join(parent, `${channel}-${runId}`)
  await mkdir(folder)
  const names = [`${prefix}-android.apk`, `${prefix}-windows-x64-setup.exe`, `${prefix}-windows-x64-setup.exe.sig`]
  const assets = names.map(name => ({ name, size: 100, sha256: 'a'.repeat(64) }))
  const base = `https://gitee.com/Syang03/zhiwell-care/releases/download/${tag}/`
  const signature = Buffer.from('untrusted comment: signature from tauri secret key\nfixture-not-real').toString('base64')
  const publishedAt = '2026-10-14T00:00:00Z'
  const android = { schemaVersion: 1, version: release.productVersion, displayVersion: release.displayVersion, versionCode: release.android.versionCode, publishedAt, notes: [], apk: { url: base + names[0], size: 100, sha256: 'a'.repeat(64) } }
  const desktop = { version: release.productVersion, notes: '', pub_date: publishedAt, platforms: { 'windows-x86_64': { url: base + names[1], signature } } }
  const info = { schemaVersion: 1, channel, version: release.productVersion, displayVersion: release.displayVersion, versionCode: release.android.versionCode, publishedAt, assets }
  for (const [name, value] of [['android-latest.json', android], ['latest.json', desktop], ['release-info.json', info]]) {
    await writeFile(join(folder, name as string), JSON.stringify(value))
  }
  await writeFile(join(folder, 'release-notes.md'), '公开版本说明')
  await writeFile(join(folder, 'SHA256SUMS.txt'), assets.map(({ name, sha256 }) => `${sha256}  ${name}\n`).join(''))
  const report = join(parent, `${channel}-${runId}-report.json`)
  await writeFile(report, JSON.stringify({ verified: true, version: info.version, channel, assets }))
  return { target: join(parent, 'publish'), 'public-dir': folder, channel, 'verification-report': report }
}

describe('验证与正式快照隔离', () => {
  it('先 staging 0.1.0 再 stable 同版本，两份不可变资料均保留', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'zhiwellcare-snapshot-'))
    directories.push(parent)
    await stagePublicFiles(await candidate(parent, 'staging'))
    await stagePublicFiles(await candidate(parent, 'stable'))
    const files = await checkPublicTree(join(parent, 'publish'))
    expect(files).toContain(`versions/staging/test-v${release.productVersion}-run-01/latest.json`)
    expect(files).toContain(`versions/${release.productVersion}/latest.json`)
    const stable = JSON.parse(await readFile(join(parent, 'publish/channels/stable/latest.json'), 'utf8'))
    expect(stable.platforms['windows-x86_64'].url).toContain(`/v${release.productVersion}/`)
  })

  it('同一验证版本的独立运行标签各有快照', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'zhiwellcare-snapshot-'))
    directories.push(parent)
    await stagePublicFiles(await candidate(parent, 'staging', 'run-01'))
    await stagePublicFiles(await candidate(parent, 'staging', 'run-02'))
    const files = await checkPublicTree(join(parent, 'publish'))
    for (const id of ['run-01', 'run-02']) expect(files).toContain(`versions/staging/test-v${release.productVersion}-${id}/latest.json`)
  })

  it('拒绝外层 Base64 私钥，同时接受公开公钥与正常 Tauri 签名标记', () => {
    // 只使用合成秘密标记，测试文件中不保存真实私钥。
    const secret = Buffer.from('untrusted comment: minisign encrypted secret key\nsynthetic-test-value').toString('base64')
    expect(() => assertPublicText(JSON.stringify({ notes: secret }))).toThrow('私钥')
    expect(() => assertPublicText(signing.tauri.publicKey)).not.toThrow()
    expect(() => assertPublicText(Buffer.from('untrusted comment: signature from tauri secret key\npublic-signature-fixture').toString('base64'))).not.toThrow()
  })
})
