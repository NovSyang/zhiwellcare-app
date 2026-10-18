import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runTool } from '../scripts/release/check-inputs.mjs'

const root = resolve(import.meta.dirname, '..')
const signingNames = [
  'REHAB_ANDROID_KEYSTORE_PATH', 'REHAB_ANDROID_STORE_PASSWORD', 'REHAB_ANDROID_KEY_PASSWORD',
  'REHAB_ANDROID_KEY_ALIAS', 'REHAB_ANDROID_FUTURE_SIGNING_VALUE',
  'TAURI_SIGNING_PRIVATE_KEY', 'TAURI_SIGNING_PRIVATE_KEY_PATH', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD',
]
const environmentProbe = "const names=Object.keys(process.env).filter(name=>/^(REHAB_ANDROID_|TAURI_SIGNING_PRIVATE_KEY(?:_|$))/i.test(name)).sort();console.log(JSON.stringify(names))"

// 合成值只用于测试继承边界，不读取或显示真实签名材料。
function fixtureEnvironment() {
  const environment = { ...process.env }
  for (const name of signingNames) environment[name] = `synthetic-${name}`
  return environment
}

function psLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}

/** 用真实 Windows PowerShell 5 与 Node 子进程验证成功/失败时的环境恢复。 */
function powershellProbe(body: string) {
  const script = [
    "$ErrorActionPreference='Stop'",
    `. ${psLiteral(resolve(root, 'scripts/release/without-signing-env.ps1'))}`,
    '$before=@{}',
    "foreach($name in [Environment]::GetEnvironmentVariables('Process').Keys){if($name -match '^(REHAB_ANDROID_|TAURI_SIGNING_PRIVATE_KEY(?:_|$))'){$before[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}}",
    body,
  ].join('\n')
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { cwd: root, env: fixtureEnvironment(), encoding: 'utf8', stdio: 'pipe' }).trim()
}

const restoredProbe = "$restored=$true;foreach($name in $before.Keys){if([Environment]::GetEnvironmentVariable($name,'Process') -cne $before[$name]){$restored=$false}}"

describe.runIf(process.platform === 'win32')('发布子进程签名环境隔离', () => {
  it('公共子进程看不到签名变量，完成后原值全部恢复', () => {
    const output = powershellProbe([
      `$child=Invoke-WithoutSigningEnvironment -Command ${psLiteral(process.execPath)} -Arguments @('-e',${psLiteral(environmentProbe)})`,
      restoredProbe,
      // 子进程 JSON 保持字符串，避免 PowerShell 5 给空数组附加 Count 元数据。
      '[PSCustomObject]@{childJson=$child;restored=$restored}|ConvertTo-Json -Compress',
    ].join('\n'))
    const result = JSON.parse(output)
    expect(JSON.parse(result.childJson)).toEqual([])
    expect(result.restored).toBe(true)
  })

  it('子进程失败仍恢复环境，调用者可以继续签名', () => {
    const output = powershellProbe([
      '$failed=$false',
      `try{Invoke-WithoutSigningEnvironment -Command ${psLiteral(process.execPath)} -Arguments @('-e','process.exit(7)')}catch{$failed=$true}`,
      restoredProbe,
      '[PSCustomObject]@{failed=$failed;restored=$restored}|ConvertTo-Json -Compress',
    ].join('\n'))
    expect(JSON.parse(output)).toEqual({ failed: true, restored: true })
  })

  it('签名子进程只保留明确批准的密码，不继承另一平台材料', () => {
    const output = powershellProbe([
      `$child=Invoke-WithoutSigningEnvironment -Command ${psLiteral(process.execPath)} -Arguments @('-e',${psLiteral(environmentProbe)}) -AllowedSigningNames @('REHAB_ANDROID_STORE_PASSWORD')`,
      restoredProbe,
      '[PSCustomObject]@{childJson=$child;restored=$restored}|ConvertTo-Json -Compress',
    ].join('\n'))
    const result = JSON.parse(output)
    expect(JSON.parse(result.childJson)).toEqual(['REHAB_ANDROID_STORE_PASSWORD'])
    expect(result.restored).toBe(true)
  })

  it('Windows PowerShell 5 可读取两个中文脚本的 UTF-8 BOM', () => {
    for (const path of ['scripts/release.ps1', 'scripts/release/without-signing-env.ps1']) {
      expect([...readFileSync(resolve(root, path)).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    }
  })
})

describe('原生发布工具隔离与错误脱敏', () => {
  it('验签等普通工具子进程默认无签名变量', async () => {
    const output = await runTool(process.execPath, ['-e', environmentProbe], { env: fixtureEnvironment() })
    expect(JSON.parse(output)).toEqual([])
  })

  it('私钥操作只传指定变量', async () => {
    const output = await runTool(process.execPath, ['-e', environmentProbe], {
      env: fixtureEnvironment(), allowedSigningNames: ['TAURI_SIGNING_PRIVATE_KEY_PASSWORD'],
    })
    expect(JSON.parse(output)).toEqual(['TAURI_SIGNING_PRIVATE_KEY_PASSWORD'])
  })

  it('失败不会返回含模拟秘密的 stdout/stderr/cause/cmd', async () => {
    const marker = 'SYNTHETIC_PRIVATE_OUTPUT_DO_NOT_LOG'
    let failure: Error | undefined
    try {
      await runTool(process.execPath, ['-e', `console.log('${marker}');console.error('${marker}');process.exit(9)`])
    } catch (error) { failure = error as Error }
    expect(failure?.message).toMatch(/工具执行失败.*9/)
    expect(failure?.cause).toBeUndefined()
    expect(JSON.stringify(failure)).not.toContain(marker)
    expect(failure?.stack).not.toContain(marker)
  })
})
