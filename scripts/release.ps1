[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('Doctor', 'Prepare', 'Manifests', 'VerifyRemote', 'StagePublic')][string]$Action,
  [ValidateSet('stable', 'staging')][string]$Channel = 'stable',
  [string]$VersionFile = 'release-version.json',
  [string]$LocalConfig = 'release.local.json',
  [string]$Notes,
  [string]$PublishedAt,
  [string]$ApkUrl,
  [string]$ArtifactUrl,
  [string]$PublishTarget,
  [string]$RunId,
  [switch]$FirstRelease,
  [switch]$RemoteManifests
)

$ErrorActionPreference = 'Stop'
$SourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$OriginalLocation = Get-Location
$SavedEnvironment = @{}
$PrepareStage = 'preflight'
$AndroidBuildState = 'not-executed'
$WindowsBuildState = 'not-executed'
. (Join-Path $PSScriptRoot 'release/without-signing-env.ps1')

function Invoke-Checked {
  param([string]$Command, [string[]]$Arguments, [string[]]$SigningNames = @())
  # 公共检查、网络、npm 和测试默认无签名环境；私钥用途需逐项明确保留。
  Invoke-WithoutSigningEnvironment -Command $Command -Arguments $Arguments -AllowedSigningNames $SigningNames
}

function Set-ScopedEnvironment {
  param([string]$Name, [string]$Value)
  if (-not $SavedEnvironment.ContainsKey($Name)) { $SavedEnvironment[$Name] = [Environment]::GetEnvironmentVariable($Name, 'Process') }
  [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
}

function Assert-LocalKeys {
  if (-not $Local -or -not (Test-Path -LiteralPath $Local.androidKeystorePath -PathType Leaf) -or -not (Test-Path -LiteralPath $Local.tauriPrivateKeyPath -PathType Leaf) -or -not (Test-Path -LiteralPath $Local.tauriPublicKeyPath -PathType Leaf)) {
    throw '本机配置缺失或密钥路径不存在；请显式指定已核验的密钥，不能自动选择第一个文件。'
  }
  if ($Local.androidAlias -ne 'zhiwellcare') { throw 'Android 别名与团队基准不一致。' }
  # 只接受用户指定的正式密钥目录，不能切换到开发者个人密钥。
  foreach ($KeyPath in @($Local.androidKeystorePath, $Local.tauriPrivateKeyPath, $Local.tauriPublicKeyPath)) {
    $FullKeyPath = [IO.Path]::GetFullPath($KeyPath)
    if (-not $FullKeyPath.StartsWith('D:\apps\dev\work\HandDevice\Keys\', [StringComparison]::OrdinalIgnoreCase)) { throw '本机签名材料必须来自用户原 Keys 目录。' }
  }
  $Signing = Get-Content -LiteralPath (Join-Path $SourceRoot 'release-signing.json') -Raw | ConvertFrom-Json
  $LocalPublicKey = (Get-Content -LiteralPath $Local.tauriPublicKeyPath -Raw).Trim().TrimStart([char]0xFEFF)
  if ($LocalPublicKey -cne $Signing.tauri.publicKey) { throw '本机 Tauri 公钥与公开登记基准不一致。' }
}

try {
  Set-Location -LiteralPath $SourceRoot
  $Release = Get-Content -LiteralPath $VersionFile -Raw | ConvertFrom-Json
  if ($Release.productVersion -notmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$') { throw '版本目录必须使用合法三段版本。' }
  $Local = if (Test-Path -LiteralPath $LocalConfig) { Get-Content -LiteralPath $LocalConfig -Raw | ConvertFrom-Json } else { $null }
  # staging 只在独立 Git 工作树构建，避免主工作副本留下验证通道配置。
  if ($Channel -eq 'staging') {
    if (-not (Test-Path -LiteralPath (Join-Path $SourceRoot '.git') -PathType Leaf)) { throw 'staging 必须使用独立 Git worktree。' }
    if ($RunId -notmatch '^[A-Za-z0-9-]+$') { throw 'staging 必须指定仅含字母、数字、连字符的 RunId。' }
  }
  $VersionFolder = if ($Channel -eq 'staging') { "$($Release.productVersion)-$RunId" } else { $Release.productVersion }
  $OutputRoot = Join-Path $SourceRoot "release-output/$Channel/$VersionFolder"
  $ArtifactsDirectory = Join-Path $OutputRoot 'artifacts'
  $PublicDirectory = Join-Path $OutputRoot 'public'
  $PrivateDirectory = Join-Path $OutputRoot 'private'
  $FilePrefix = "ZhiWellCare-$($Release.productVersion)"
  if ($Channel -eq 'staging') { $FilePrefix += '-staging' }
  $Apk = Join-Path $ArtifactsDirectory "$FilePrefix-android.apk"
  $Exe = Join-Path $ArtifactsDirectory "$FilePrefix-windows-x64-setup.exe"
  $Signature = "$Exe.sig"

  switch ($Action) {
    'Doctor' {
      $Checks = @()
      foreach ($Tool in @('node', 'npm.cmd', 'java', 'rustc', 'cargo', 'git')) {
        $Checks += [PSCustomObject]@{ name = $Tool; available = [bool](Get-Command $Tool -ErrorAction SilentlyContinue) }
      }
      $Checks += [PSCustomObject]@{ name = 'Gradle Wrapper files'; available = (Test-Path -LiteralPath 'android/gradlew.bat') }
      # 普通终端没有 cl.exe PATH 时，通过 VS 安装发现工具核对 C++ 组件。
      $VsWhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
      $MsvcFound = [bool](Get-Command cl.exe -ErrorAction SilentlyContinue)
      if (-not $MsvcFound -and (Test-Path -LiteralPath $VsWhere)) { $MsvcFound = [bool](Invoke-Checked $VsWhere @('-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath')) }
      $Checks += [PSCustomObject]@{ name = 'MSVC C++'; available = $MsvcFound }
      $NodeMajor = [int]((Invoke-Checked 'node' @('--version')).Trim().TrimStart('v').Split('.')[0])
      $Checks += [PSCustomObject]@{ name = 'Node.js 22+'; available = ($NodeMajor -ge 22) }
      $WebViewAvailable = (Test-Path -LiteralPath (Join-Path ${env:ProgramFiles(x86)} 'Microsoft/EdgeWebView/Application')) -or (Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA 'Microsoft/EdgeWebView/Application'))
      $Checks += [PSCustomObject]@{ name = 'WebView2 runtime'; available = $WebViewAvailable }
      # 无密码时只记录未执行，绝不把路径存在当成签名可用。
      $Checks += [PSCustomObject]@{ name = 'Android signing passwords'; available = [bool]($env:REHAB_ANDROID_STORE_PASSWORD -and $env:REHAB_ANDROID_KEY_PASSWORD) }
      $Checks | ConvertTo-Json -Depth 5
      Invoke-Checked 'git' @('status', '--short')
      Invoke-Checked 'git' @('remote', '-v')
      Invoke-Checked 'node' @('scripts/sync-version.mjs', '--check')
      Invoke-Checked 'node' @('scripts/sync-release-config.mjs', '--check', '--channel', $Channel)
      Invoke-Checked 'node' @('scripts/release/check-inputs.mjs', '--version-file', $VersionFile, '--check-sdk')
      # 真正启动官方 8.14.3 Wrapper（含下载 SHA-256 校验），不能只检查 bat 文件存在。
      Invoke-Checked (Join-Path $SourceRoot 'android/gradlew.bat') @('--version')
      Assert-LocalKeys
      if ($env:REHAB_ANDROID_STORE_PASSWORD) { Invoke-Checked 'node' @('scripts/release/check-inputs.mjs', '--version-file', $VersionFile, '--keystore', $Local.androidKeystorePath) @('REHAB_ANDROID_STORE_PASSWORD') }
      Invoke-Checked 'node' @('scripts/release/check-inputs.mjs', '--version-file', $VersionFile, '--tauri-key', $Local.tauriPrivateKeyPath) @('TAURI_SIGNING_PRIVATE_KEY_PASSWORD')
      Write-Output '本机密钥身份/配对已检查；APK/EXE 实际签名及设备升级尚未在 Doctor 执行。'
      if ($Checks.available -contains $false) { throw 'Doctor 发现工具或签名环境缺项，Prepare 暂不可执行。' }
    }
    'Prepare' {
      Assert-LocalKeys
      if (-not $env:REHAB_ANDROID_STORE_PASSWORD -or -not $env:REHAB_ANDROID_KEY_PASSWORD) { throw '请由受控环境提供 Android 签名密码。' }
      Invoke-Checked 'node' @('scripts/sync-version.mjs', '--check')
      Invoke-Checked 'node' @('scripts/sync-release-config.mjs', '--check', '--channel', $Channel)
      Invoke-Checked 'node' @('scripts/release/check-inputs.mjs', '--version-file', $VersionFile, '--check-sdk')
      Invoke-Checked 'node' @('scripts/release/check-inputs.mjs', '--version-file', $VersionFile, '--keystore', $Local.androidKeystorePath) @('REHAB_ANDROID_STORE_PASSWORD')
      $PublishedArguments = @('scripts/release/check-published-version.mjs', '--channel', $Channel, '--version-file', $VersionFile)
      if ($FirstRelease) { $PublishedArguments += '--first-release' }
      Invoke-Checked 'node' $PublishedArguments
      $PrepareStage = 'dependencies-and-tests'
      Invoke-Checked 'npm.cmd' @('ci')
      Invoke-Checked 'node' @('scripts/release/check-inputs.mjs', '--version-file', $VersionFile, '--tauri-key', $Local.tauriPrivateKeyPath) @('TAURI_SIGNING_PRIVATE_KEY_PASSWORD')
      Invoke-Checked 'npm.cmd' @('test')
      # 前端构建与 Capacitor 同步先在无签名环境完成，再单独执行 Gradle 签包。
      Set-ScopedEnvironment 'TAURI_ENV_PLATFORM' 'android'
      Set-ScopedEnvironment 'TAURI_ENV_DEBUG' $null
      Invoke-Checked 'npm.cmd' @('run', 'android:sync')
      Set-ScopedEnvironment 'REHAB_ANDROID_KEYSTORE_PATH' $Local.androidKeystorePath
      Set-ScopedEnvironment 'REHAB_ANDROID_KEY_ALIAS' $Local.androidAlias
      Set-ScopedEnvironment 'TAURI_SIGNING_PRIVATE_KEY' $Local.tauriPrivateKeyPath
      $BuiltApk = Join-Path $SourceRoot 'android/app/build/outputs/apk/release/app-release.apk'
      $BuiltExe = Join-Path $SourceRoot "src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/ZhiWellCare_$($Release.productVersion)_x64-setup.exe"
      Invoke-Checked 'node' @('scripts/release/clean-build-outputs.mjs', '--apk', $BuiltApk, '--artifact', $BuiltExe, '--signature', "$BuiltExe.sig")
      $BuildStartedAt = [DateTime]::UtcNow
      $PrepareStage = 'android-build'
      Invoke-Checked (Join-Path $SourceRoot 'android/gradlew.bat') @('-p', (Join-Path $SourceRoot 'android'), 'assembleRelease') @('REHAB_ANDROID_KEYSTORE_PATH', 'REHAB_ANDROID_STORE_PASSWORD', 'REHAB_ANDROID_KEY_PASSWORD', 'REHAB_ANDROID_KEY_ALIAS')
      $AndroidBuildState = 'passed'
      $PrepareStage = 'windows-build'
      # Windows 单独生成 chrome105 目标前端，不能复用 Android 的 ES2022 产物。
      Set-ScopedEnvironment 'TAURI_ENV_PLATFORM' 'windows'
      Invoke-Checked 'npm.cmd' @('run', 'build')
      # 前端已在无签名环境构建；跳过重复 hook，避免它继承 Tauri 私钥环境。
      # 配置走文件参数，避免 Windows PowerShell 5 将 JSON 内的引号重新解释。
      New-Item -ItemType Directory -Path $PrivateDirectory -Force | Out-Null
      $TauriBuildOverrides = Join-Path $PrivateDirectory 'tauri-build-overrides.json'
      [IO.File]::WriteAllText($TauriBuildOverrides, '{"build":{"beforeBuildCommand":null}}', [Text.UTF8Encoding]::new($false))
      Invoke-Checked 'node' @('node_modules/@tauri-apps/cli/tauri.js', 'build', '--target', 'x86_64-pc-windows-msvc', '--bundles', 'nsis', '--config', $TauriBuildOverrides) @('TAURI_SIGNING_PRIVATE_KEY', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD')
      $WindowsBuildState = 'passed'
      foreach ($Built in @($BuiltApk, $BuiltExe, "$BuiltExe.sig")) {
        if (-not (Test-Path -LiteralPath $Built -PathType Leaf) -or (Get-Item -LiteralPath $Built).LastWriteTimeUtc -lt $BuildStartedAt) { throw "本次构建未产生新产物：$Built。" }
      }
      $PrepareStage = 'final-artifact-verification'
      Invoke-Checked 'node' @('scripts/release/check-inputs.mjs', '--version-file', $VersionFile, '--apk', $BuiltApk, '--artifact', $BuiltExe, '--signature', "$BuiltExe.sig")
      foreach ($Directory in @($ArtifactsDirectory, $PublicDirectory, $PrivateDirectory)) { New-Item -ItemType Directory -Path $Directory -Force | Out-Null }
      # 正式版本已有归档时拒绝覆盖；修复正式发布使用新版本。
      foreach ($Destination in @($Apk, $Exe, $Signature)) { if (Test-Path -LiteralPath $Destination) { throw '该版本已有归档产物，禁止静默覆盖。' } }
      Copy-Item -LiteralPath $BuiltApk -Destination $Apk
      Copy-Item -LiteralPath $BuiltExe -Destination $Exe
      Copy-Item -LiteralPath "$BuiltExe.sig" -Destination $Signature
      [PSCustomObject]@{ schemaVersion = 1; version = $Release.productVersion; channel = $Channel; build = 'passed'; androidBuild = $AndroidBuildState; windowsBuild = $WindowsBuildState; artifactVerification = 'passed'; deviceUpgrade = 'not-executed'; remotePublication = 'not-executed'; checkedAt = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PrivateDirectory 'validation-report.json') -Encoding UTF8
      Write-Output '两端本机产物已构建、验签并归档；后续仍需实际远端与双版本设备验证。'
    }
    'Manifests' {
      if (-not $Notes -or -not $PublishedAt -or -not $ApkUrl -or -not $ArtifactUrl) { throw 'Manifests 必须指定 Notes、PublishedAt、ApkUrl、ArtifactUrl。' }
      # 先让两端都通过真实产物检查，避免第二端失败时留下半套新清单。
      Invoke-Checked 'node' @('scripts/release/check-inputs.mjs', '--version-file', $VersionFile, '--apk', $Apk, '--artifact', $Exe, '--signature', $Signature)
      Invoke-Checked 'node' @('scripts/generate-android-update-manifest.mjs', '--apk', $Apk, '--apk-url', $ApkUrl, '--version-file', $VersionFile, '--notes', $Notes, '--published-at', $PublishedAt, '--output', (Join-Path $PublicDirectory 'android-latest.json'), '--channel', $Channel)
      Invoke-Checked 'node' @('scripts/generate-tauri-update-manifest.mjs', '--artifact', $Exe, '--signature', $Signature, '--artifact-url', $ArtifactUrl, '--version-file', $VersionFile, '--notes', $Notes, '--published-at', $PublishedAt, '--output', (Join-Path $PublicDirectory 'latest.json'), '--channel', $Channel)
      Invoke-Checked 'node' @('scripts/release/generate-public-metadata.mjs', '--channel', $Channel, '--public-dir', $PublicDirectory, '--artifacts-dir', $ArtifactsDirectory, '--notes', $Notes, '--version-file', $VersionFile)
    }
    'VerifyRemote' {
      $RemoteArguments = @('scripts/release/verify-published-assets.mjs', '--channel', $Channel, '--public-dir', $PublicDirectory, '--artifacts-dir', $ArtifactsDirectory, '--version-file', $VersionFile, '--output', (Join-Path $PrivateDirectory 'remote-validation-report.json'))
      if ($RemoteManifests) { $RemoteArguments += '--remote-manifests' }
      Invoke-Checked 'node' $RemoteArguments
    }
    'StagePublic' {
      if (-not $PublishTarget -and $Local) { $PublishTarget = $Local.publishWorktree }
      if (-not $PublishTarget) { throw 'StagePublic 必须指定独立 PublishTarget 或本机 publishWorktree。' }
      Invoke-Checked 'node' @('scripts/release/stage-public-files.mjs', '--channel', $Channel, '--target', $PublishTarget, '--public-dir', $PublicDirectory, '--version-file', $VersionFile, '--verification-report', (Join-Path $PrivateDirectory 'remote-validation-report.json'))
      if (Test-Path -LiteralPath (Join-Path $PublishTarget '.git')) { Invoke-Checked 'git' @('-C', $PublishTarget, 'diff', '--stat'); Invoke-Checked 'git' @('-C', $PublishTarget, 'status', '--short') }
      Write-Output '白名单公开资料已暂存，请审阅；本脚本不会 commit、push 或创建 Release。'
    }
  }
} catch {
  # 失败报告只记录步骤状态，第三方输出及秘密不写入公开文件。
  if ($Action -eq 'Prepare' -and $PrivateDirectory) {
    New-Item -ItemType Directory -Path $PrivateDirectory -Force | Out-Null
    if ($PrepareStage -eq 'android-build') { $AndroidBuildState = 'failed' }
    if ($PrepareStage -eq 'windows-build') { $WindowsBuildState = 'failed' }
    [PSCustomObject]@{ schemaVersion = 1; version = $Release.productVersion; channel = $Channel; failedStage = $PrepareStage; androidBuild = $AndroidBuildState; windowsBuild = $WindowsBuildState; artifactVerification = 'not-passed'; deviceUpgrade = 'not-executed'; remotePublication = 'not-executed'; checkedAt = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PrivateDirectory 'validation-report.json') -Encoding UTF8
  }
  throw
} finally {
  # 无论哪一步失败都恢复调用者进程环境，不永久更改系统环境。
  foreach ($Name in $SavedEnvironment.Keys) { [Environment]::SetEnvironmentVariable($Name, $SavedEnvironment[$Name], 'Process') }
  Set-Location -LiteralPath $OriginalLocation
}
