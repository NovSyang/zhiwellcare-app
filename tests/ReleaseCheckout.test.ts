import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { UPDATE_CHANNEL } from '../src/platform/update/UpdateEndpoints'

describe('Windows 新检出工作树', () => {
  it('版本和通道检查接受 CRLF 且不重写文件', () => {
    // 使用实际脚本和配置重现 Git autocrlf 检出，避免同版本的干净工作树误报漂移。
    const root = resolve(import.meta.dirname, '..')
    const temporary = mkdtempSync(join(tmpdir(), 'zhiwellcare-checkout-'))
    const files = [
      'release-version.json', 'release-config.json', 'release-signing.json',
      'package.json', 'package-lock.json', 'src-tauri/tauri.conf.json',
      'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'android/app/build.gradle',
      'android/update-config.json', 'src/platform/update/UpdateEndpoints.ts',
      'scripts/sync-version.mjs', 'scripts/sync-release-config.mjs', 'scripts/release/common.mjs',
    ]
    const snapshots = new Map<string, string>()
    try {
      for (const file of files) {
        const content = readFileSync(resolve(root, file), 'utf8').replace(/\r?\n/g, '\r\n')
        const destination = join(temporary, file)
        mkdirSync(dirname(destination), { recursive: true })
        writeFileSync(destination, content)
        snapshots.set(destination, content)
      }
      expect(() => execFileSync(process.execPath, ['scripts/sync-version.mjs', '--check'], { cwd: temporary, stdio: 'pipe' })).not.toThrow()
      expect(() => execFileSync(process.execPath, ['scripts/sync-release-config.mjs', '--check', '--channel', UPDATE_CHANNEL], { cwd: temporary, stdio: 'pipe' })).not.toThrow()
      for (const [file, content] of snapshots) expect(readFileSync(file, 'utf8')).toBe(content)
    } finally {
      // 只删除本测试通过 mkdtemp 创建的目录，不操作项目或用户数据。
      rmSync(temporary, { recursive: true, force: true })
    }
  })
})
