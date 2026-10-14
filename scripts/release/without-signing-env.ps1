function Invoke-WithoutSigningEnvironment {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$Command,
    [string[]]$Arguments = @(),
    [string[]]$AllowedSigningNames = @()
  )

  # 默认清除全部签名入口；签名核验/构建只能显式保留自己需要的变量。
  $SigningSnapshot = @{}
  try {
    foreach ($SigningName in [Environment]::GetEnvironmentVariables('Process').Keys) {
      if ($SigningName -match '^(REHAB_ANDROID_|TAURI_SIGNING_PRIVATE_KEY(?:_|$))') {
        $SigningSnapshot[$SigningName] = [Environment]::GetEnvironmentVariable($SigningName, 'Process')
        if ($AllowedSigningNames -notcontains $SigningName) {
          [Environment]::SetEnvironmentVariable($SigningName, $null, 'Process')
        }
      }
    }
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "步骤失败：$([IO.Path]::GetFileName($Command))，退出码 $LASTEXITCODE。" }
  } finally {
    # 子进程成功、失败或启动异常都恢复原值，调用者无需重新注入密码。
    foreach ($SigningName in $SigningSnapshot.Keys) {
      [Environment]::SetEnvironmentVariable($SigningName, $SigningSnapshot[$SigningName], 'Process')
    }
  }
}
