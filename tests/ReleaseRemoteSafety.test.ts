import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, open, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import release from '../release-version.json'
import { anonymousGet, verifyPublishedAssets } from '../scripts/release/verify-published-assets.mjs'
import { stagePublicFiles } from '../scripts/release/stage-public-files.mjs'

const temporary: string[] = []
const temporaryRoot = resolve(tmpdir())
const fixtureUrl = 'https://gitee.com/Syang03/zhiwell-care/releases/download/v0.1.0/fixture.apk'

async function directory(): Promise<string> {
  const value = await mkdtemp(join(temporaryRoot, 'zhiwellcare-remote-safety-'))
  temporary.push(value)
  return value
}

afterEach(async () => {
  // 删除前核对绝对路径，只清理本测试通过 mkdtemp 创建的目录。
  await Promise.all(temporary.splice(0).map(async (value) => {
    if (!value.startsWith(`${temporaryRoot}${sep}`) || !basename(value).startsWith('zhiwellcare-remote-safety-')) throw new Error('测试临时目录越界。')
    await rm(value, { recursive: true, force: true })
  }))
})

/** 保持正文未读完，才能确认提前失败真正取消了响应，而不是仅结束函数。 */
function waitingBody() {
  const cancel = vi.fn(async () => undefined)
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('abc')) },
    cancel,
  })
  return { body, cancel }
}

describe('匿名下载失败释放资源', () => {
  it('wx 创建失败取消正文和请求，原有文件保持完整', async () => {
    const output = join(await directory(), 'existing.apk')
    await writeFile(output, 'original-bytes')
    const response = waitingBody()
    const signals: AbortSignal[] = []
    await expect(anonymousGet(fixtureUrl, {
      maxBytes: 3, output,
      fetcher: async (_url, options) => {
        if (options?.signal) signals.push(options.signal)
        return new Response(response.body)
      },
    })).rejects.toMatchObject({ code: 'EEXIST' })
    expect(response.cancel).toHaveBeenCalledOnce()
    expect(signals[0].aborted).toBe(true)
    expect(await readFile(output, 'utf8')).toBe('original-bytes')
  })

  it.each([
    // 使用同一种 Headers 类型，避免严格模式把不同对象字段推断成 undefined。
    { status: 500, headers: new Headers(), message: 'HTTP 500' },
    { status: 200, headers: new Headers({ 'content-type': 'text/html' }), message: 'HTML' },
    { status: 200, headers: new Headers({ 'content-length': '4' }), message: '超限' },
  ])('响应检查失败也取消未消费正文 %#', async ({ status, headers, message }) => {
    const response = waitingBody()
    const signals: AbortSignal[] = []
    await expect(anonymousGet(fixtureUrl, {
      maxBytes: 3,
      fetcher: async (_url, options) => {
        if (options?.signal) signals.push(options.signal)
        return new Response(response.body, { status, headers })
      },
    })).rejects.toThrow(message)
    expect(response.cancel).toHaveBeenCalledOnce()
    expect(signals[0].aborted).toBe(true)
  })

  it('重定向先释放旧正文，下一跳失败终止请求', async () => {
    const response = waitingBody()
    const signals: AbortSignal[] = []
    const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.signal) signals.push(options.signal)
      if (signals.length === 1) return new Response(response.body, { status: 302, headers: { location: 'https://gitee.com/next' } })
      expect(response.cancel).toHaveBeenCalledOnce()
      throw new Error('下一跳连接失败')
    })
    await expect(anonymousGet(fixtureUrl, { maxBytes: 3, fetcher })).rejects.toThrow('下一跳连接失败')
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(signals.every((signal) => signal.aborted)).toBe(true)
  })

  it('部分写入循环完成，文件字节、大小和摘要一致且关闭句柄', async () => {
    const output = join(await directory(), 'download.apk')
    const close = vi.fn()
    const write = vi.fn()
    const result = await anonymousGet(fixtureUrl, {
      maxBytes: 6, output, fetcher: async () => new Response('abcdef'),
      openFile: async (path, flags) => {
        const handle = await open(path, flags)
        return {
          write: async (bytes, offset, length, position) => {
            write()
            return handle.write(bytes, offset, Math.min(2, length), position)
          },
          close: async () => { close(); await handle.close() },
        }
      },
    })
    expect(await readFile(output, 'utf8')).toBe('abcdef')
    expect(result).toEqual({ size: 6, sha256: 'bef57ec7f53a6d40beb640a780a639c83bc29ac8a9816f1fc6c5c6dcd93c4721', bytes: undefined })
    expect(write).toHaveBeenCalledTimes(3)
    expect(close).toHaveBeenCalledOnce()
  })

  it('零字节写入失败会关闭句柄、取消正文并删除本次坏文件', async () => {
    const output = join(await directory(), 'incomplete.apk')
    const response = waitingBody()
    const close = vi.fn()
    const signals: AbortSignal[] = []
    await expect(anonymousGet(fixtureUrl, {
      maxBytes: 3, output,
      fetcher: async (_url, options) => {
        if (options?.signal) signals.push(options.signal)
        return new Response(response.body)
      },
      openFile: async (path, flags) => {
        const handle = await open(path, flags)
        return { write: async () => ({ bytesWritten: 0 }), close: async () => { close(); await handle.close() } }
      },
    })).rejects.toThrow('写入未完成')
    expect(close).toHaveBeenCalledOnce()
    expect(response.cancel).toHaveBeenCalledOnce()
    expect(signals[0].aborted).toBe(true)
    await expect(stat(output)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

/** 合成资料只用于失败路径；不模拟通过远端下载、APK 验签或正式发布。 */
async function reportFixture() {
  const value = await directory()
  const publicDir = join(value, 'public')
  const artifactsDir = join(value, 'artifacts')
  await mkdir(publicDir)
  await mkdir(artifactsDir)
  const prefix = `https://gitee.com/Syang03/zhiwell-care/releases/download/v${release.productVersion}/`
  const names = [`ZhiWellCare-${release.productVersion}-android.apk`, `ZhiWellCare-${release.productVersion}-windows-x64-setup.exe`, `ZhiWellCare-${release.productVersion}-windows-x64-setup.exe.sig`]
  const signature = Buffer.from('untrusted comment: failure-path fixture\nnot-a-real-signature').toString('base64')
  const contents = ['apk-fixture', 'exe-fixture', signature]
  const assets = names.map((name, index) => ({ name, size: Buffer.byteLength(contents[index]), sha256: createHash('sha256').update(contents[index]).digest('hex') }))
  for (let index = 0; index < names.length; index += 1) await writeFile(join(artifactsDir, names[index]), contents[index])
  const android = { schemaVersion: 1, version: release.productVersion, displayVersion: release.displayVersion, versionCode: release.android.versionCode, publishedAt: '2026-10-14T01:00:00Z', notes: [], apk: { url: prefix + names[0], size: assets[0].size, sha256: assets[0].sha256 } }
  const tauri = { version: release.productVersion, notes: '', pub_date: android.publishedAt, platforms: { 'windows-x86_64': { url: prefix + names[1], signature } } }
  const info = { schemaVersion: 1, channel: 'stable', version: release.productVersion, displayVersion: release.displayVersion, versionCode: release.android.versionCode, publishedAt: android.publishedAt, assets }
  for (const [name, content] of [['android-latest.json', android], ['latest.json', tauri], ['release-info.json', info]] as const) await writeFile(join(publicDir, name), JSON.stringify(content))
  await writeFile(join(publicDir, 'release-notes.md'), '失败路径测试资料\n')
  await writeFile(join(publicDir, 'SHA256SUMS.txt'), assets.map(({ name, sha256 }) => `${sha256}  ${name}\n`).join(''))
  const report = join(value, 'remote-report.json')
  // 模拟磁盘上遗留的旧成功报告，验证新操作会先将其撤销。
  await writeFile(report, JSON.stringify({ schemaVersion: 1, verified: true, version: info.version, channel: info.channel, assets }))
  return { value, report, publicDir, options: { channel: 'stable', 'public-dir': publicDir, 'artifacts-dir': artifactsDir, output: report } }
}

describe('远端验收报告不能复用旧成功', () => {
  it('必填参数检查失败也撤销旧报告', async () => {
    const fixture = await reportFixture()
    await expect(verifyPublishedAssets({ ...fixture.options, 'public-dir': '' })).rejects.toThrow('缺少参数')
    expect(JSON.parse(await readFile(fixture.report, 'utf8'))).toMatchObject({ verified: false, status: 'failed' })
  })

  it('本地配置读取失败也撤销旧报告', async () => {
    const fixture = await reportFixture()
    await expect(verifyPublishedAssets({ ...fixture.options, config: join(fixture.value, 'missing-config.json') })).rejects.toMatchObject({ code: 'ENOENT' })
    expect(JSON.parse(await readFile(fixture.report, 'utf8')).verified).toBe(false)
  })

  it('网络请求前已作废旧报告，失败后 StagePublic 拒绝暂存', async () => {
    const fixture = await reportFixture()
    const fetcher = vi.fn(async () => {
      expect(JSON.parse(await readFile(fixture.report, 'utf8'))).toMatchObject({ verified: false, status: 'pending' })
      throw new Error('模拟网络不可达')
    })
    await expect(verifyPublishedAssets({ ...fixture.options, fetcher })).rejects.toThrow('模拟网络不可达')
    expect(fetcher).toHaveBeenCalledOnce()
    expect(JSON.parse(await readFile(fixture.report, 'utf8'))).toMatchObject({ verified: false, status: 'failed' })
    await expect(stagePublicFiles({ target: join(fixture.value, 'publish'), 'public-dir': fixture.publicDir, channel: 'stable', 'verification-report': fixture.report })).rejects.toThrow('验收报告')
  })
})
