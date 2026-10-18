import { execFile } from 'node:child_process'
import { createHash, X509Certificate } from 'node:crypto'
import { promisify } from 'node:util'
import { mkdtemp, open, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, resolve } from 'node:path'
import { assertVersionAdvance, exists, isMain, parseArgs, readJson, root, validateSigning, validateVersionFile } from './common.mjs'

const execute = promisify(execFile)

/** 工具使用参数数组启动，不把文件路径或秘密插入 shell 命令。 */
export async function runTool(command, args, options = {}) {
  const { allowedSigningNames = [], ...executionOptions } = options
  const environment = { ...(executionOptions.env ?? process.env) }
  // 原生工具也按用途隔离签名环境，验签工具与 Cargo 无须读取私钥密码。
  for (const name of Object.keys(environment)) {
    if (/^(REHAB_ANDROID_|TAURI_SIGNING_PRIVATE_KEY(?:_|$))/i.test(name)
      && !allowedSigningNames.some(allowed => allowed.toUpperCase() === name.toUpperCase())) delete environment[name]
  }
  try {
    const result = await execute(command, args, { cwd: root, windowsHide: true, shell: false, maxBuffer: 4 * 1024 * 1024, timeout: 180000, ...executionOptions, env: environment })
    return result.stdout
  } catch (error) {
    // 构建工具错误只报告工具名和退出码，避免第三方输出包含本机秘密。
    const exitCode = typeof error.code === 'number' || /^[A-Z][A-Z0-9_]*$/.test(String(error.code)) ? error.code : '未知错误'
    // 不保留原异常 cause：Node 顶层会递归打印其中的 stdout、stderr 和完整参数。
    throw new Error(`工具执行失败：${basename(command)}（${exitCode}）。`)
  }
}

export async function androidTools() {
  let sdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME
  if (!sdk && await exists(resolve(root, 'android/local.properties'))) {
    const local = await readFile(resolve(root, 'android/local.properties'), 'utf8')
    sdk = local.match(/^sdk\.dir=(.+)$/m)?.[1].trim().replace(/\\:/g, ':').replace(/\\\\/g, '\\')
  }
  if (!sdk) throw new Error('未配置 Android SDK（ANDROID_SDK_ROOT、ANDROID_HOME 或 local.properties）。')
  const directories = (await readdir(resolve(sdk, 'build-tools'))).filter((value) => /^\d+\.\d+\.\d+$/.test(value))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  for (const version of directories) {
    const directory = resolve(sdk, 'build-tools', version)
    const aapt = resolve(directory, process.platform === 'win32' ? 'aapt.exe' : 'aapt')
    const signerJar = resolve(directory, 'lib/apksigner.jar')
    if (await exists(aapt) && await exists(signerJar)) return { aapt, signerJar, version }
  }
  throw new Error('Android SDK 缺少 aapt 与 apksigner；不能仅凭文件名验证 APK。')
}

/** 解析最终 APK 的真实元数据，签名验证失败时不会生成清单。 */
export function parseApkBadging(output) {
  const packageLine = output.match(/^package:.*$/m)?.[0] ?? ''
  const applicationId = packageLine.match(/name='([^']+)'/)?.[1]
  const versionName = packageLine.match(/versionName='([^']+)'/)?.[1]
  const versionCode = Number(packageLine.match(/versionCode='(\d+)'/)?.[1])
  if (!applicationId || !versionName || !Number.isSafeInteger(versionCode)) throw new Error('无法读取 APK 包名或真实版本。')
  return { applicationId, versionName, versionCode, debuggable: /^application-debuggable(?:\s|$)/m.test(output) }
}

export function assertApkIdentity(metadata, certificates, release, signing) {
  if (metadata.applicationId !== signing.android.applicationId || metadata.versionName !== release.android.versionName
    || metadata.versionCode !== release.android.versionCode || metadata.debuggable) throw new Error('APK 包名、版本或 debuggable 与本次正式配置不一致。')
  // 本方案只有一个正式签名身份，额外签名者也必须拒绝。
  if (certificates.length !== 1) throw new Error('APK 必须只有一个正式签名证书。')
  for (const field of ['certificateMd5', 'certificateSha1', 'certificateSha256']) {
    if (certificates[0][field]?.toLowerCase() !== signing.android[field].toLowerCase()) throw new Error(`APK 正式证书不匹配：${field}。`)
  }
}

export async function verifyApk(path, release, signing) {
  validateVersionFile(release)
  validateSigning(signing)
  const tools = await androidTools()
  const metadata = parseApkBadging(await runTool(tools.aapt, ['dump', 'badging', path]))
  const output = await runTool('java', ['-jar', tools.signerJar, 'verify', '--verbose', '--print-certs', path])
  const certificates = []
  for (const match of output.matchAll(/Signer #(\d+) certificate SHA-256 digest:\s*([a-f\d]+)/gi)) {
    const number = match[1]
    const digest = (name) => output.match(new RegExp(`Signer #${number} certificate ${name} digest:\\s*([a-f\\d]+)`, 'i'))?.[1]
    certificates.push({ certificateSha256: match[2], certificateSha1: digest('SHA-1'), certificateMd5: digest('MD5') })
  }
  assertApkIdentity(metadata, certificates, release, signing)
  return { ...metadata, certificateSha256: certificates[0].certificateSha256, sdkBuildTools: tools.version }
}

/** 原 .p12 的密码通过受控环境交给 keytool，不出现在参数或报告中。 */
export async function verifyKeystore(path, signing) {
  validateSigning(signing)
  if (!process.env.REHAB_ANDROID_STORE_PASSWORD) throw new Error('Android 签名密码未注入，无法核验原密钥。')
  const common = ['-J-Duser.language=en', '-keystore', path, '-storetype', 'PKCS12', '-alias', 'zhiwellcare', '-storepass:env', 'REHAB_ANDROID_STORE_PASSWORD']
  const signingEnvironment = { allowedSigningNames: ['REHAB_ANDROID_STORE_PASSWORD'] }
  const listing = await runTool('keytool', ['-list', '-v', ...common], signingEnvironment)
  if (!listing.includes('PrivateKeyEntry')) throw new Error('原 .p12 选定别名没有私钥条目。')
  const pem = await runTool('keytool', ['-exportcert', '-rfc', ...common], signingEnvironment)
  const certificate = new X509Certificate(pem)
  for (const [algorithm, field] of [['md5', 'certificateMd5'], ['sha1', 'certificateSha1'], ['sha256', 'certificateSha256']]) {
    if (createHash(algorithm).update(certificate.raw).digest('hex') !== signing.android[field].toLowerCase()) throw new Error(`原 .p12 证书与登记基准不一致：${field}。`)
  }
  return { privateKeyEntry: true, certificateSha256: signing.android.certificateSha256 }
}

export async function verifyUpdaterSignature(path, signaturePath, signing) {
  validateSigning(signing)
  const signature = (await readFile(signaturePath, 'utf8')).trim()
  // 签名是 Tauri 外层 Base64 的 Minisign 文本，路径、URL、任意非空字符串都不接受。
  if (!/^[A-Za-z\d+/=]+$/.test(signature) || !Buffer.from(signature, 'base64').toString('utf8').startsWith('untrusted comment:')) {
    throw new Error('Tauri .sig 必须是有效签名内容，不能是路径、URL 或占位字符串。')
  }
  const executable = resolve(root, 'tools/release-signature-verifier/target/release/release-signature-verifier.exe')
  const args = ['--artifact', path, '--signature', signaturePath, '--public-key', signing.tauri.publicKey]
  if (await exists(executable)) await runTool(executable, args)
  else await runTool('cargo', ['run', '--locked', '--quiet', '--manifest-path', resolve(root, 'tools/release-signature-verifier/Cargo.toml'), '--', ...args])
  return signature
}

/** 临时文件的实际签名验证公私钥配对，不生成或修改原正式密钥。 */
export async function verifyTauriKeyPair(privateKeyPath, signing) {
  validateSigning(signing)
  const temporary = await mkdtemp(resolve(tmpdir(), 'zhiwellcare-signature-'))
  const probe = resolve(temporary, 'probe.txt')
  try {
    await writeFile(probe, 'zhiwellcare release key-pair verification\n', 'utf8')
    // 显式 -f 与继承的私钥环境入口不能同时存在；仅在子进程删除冲突入口。
    const environment = { ...process.env }
    delete environment.TAURI_SIGNING_PRIVATE_KEY
    delete environment.TAURI_SIGNING_PRIVATE_KEY_PATH
    await runTool(process.execPath, [resolve(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'signer', 'sign', '--private-key-path', privateKeyPath, probe], {
      env: environment, allowedSigningNames: ['TAURI_SIGNING_PRIVATE_KEY_PASSWORD'],
    })
    await verifyUpdaterSignature(probe, `${probe}.sig`, signing)
    return { paired: true }
  } finally { await rm(temporary, { recursive: true, force: true }) }
}

export async function verifyWindows(path, signaturePath, release, signing) {
  validateVersionFile(release)
  validateSigning(signing)
  const file = await open(path, 'r')
  let header
  try {
    const bytes = Buffer.alloc(2)
    await file.read(bytes, 0, 2, 0)
    header = bytes.toString('ascii')
  } finally { await file.close() }
  if (header !== 'MZ') throw new Error('Windows 产物不是 PE 安装程序。')
  if (process.platform !== 'win32') throw new Error('Windows 产物版本核验需要 Windows VersionInfo。')
  const version = (await runTool('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', resolve(root, 'scripts/release/get-exe-version.ps1'), '-Artifact', path])).trim()
  if (version !== release.desktop.version) throw new Error(`Windows 安装程序真实版本 ${version} 与 ${release.desktop.version} 不一致。`)
  const signature = await verifyUpdaterSignature(path, signaturePath, signing)
  return { version, signature }
}

export async function checkInputs(options) {
  const release = validateVersionFile(await readJson(options['version-file'] ?? 'release-version.json'))
  const signing = validateSigning(await readJson(options.signing ?? 'release-signing.json'))
  const report = { version: release.productVersion }
  if (options.keystore) report.keystore = await verifyKeystore(resolve(root, options.keystore), signing)
  if (options['tauri-key']) report.tauriKeyPair = await verifyTauriKeyPair(resolve(root, options['tauri-key']), signing)
  if (options['check-sdk']) report.androidTools = await androidTools()
  if (options['require-published'] || options['first-release'] || options['published-android'] || options['published-tauri']) {
    assertVersionAdvance(release, options['published-android'] ? await readJson(options['published-android']) : null,
      options['published-tauri'] ? await readJson(options['published-tauri']) : null, options['first-release'])
    report.versionAdvance = 'passed'
  }
  if (options.apk) report.android = await verifyApk(resolve(root, options.apk), release, signing)
  if (options.artifact || options.signature) {
    if (!options.artifact || !options.signature) throw new Error('必须同时传入 --artifact 与 --signature。')
    report.windows = await verifyWindows(resolve(root, options.artifact), resolve(root, options.signature), release, signing)
  }
  return report
}

if (isMain(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2), ['version-file', 'signing', 'apk', 'artifact', 'signature', 'published-android', 'published-tauri', 'keystore', 'tauri-key'], ['first-release', 'require-published', 'check-sdk'])
    console.log(JSON.stringify(await checkInputs(options), null, 2))
  } catch (error) {
    // CLI 只输出脱敏后的说明，不展开工具异常对象或第三方日志。
    console.error(error.message)
    process.exitCode = 1
  }
}
