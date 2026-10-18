param([Parameter(Mandatory = $true)][string]$Artifact)
$ErrorActionPreference = 'Stop'
# 读取 Windows 文件资源中的版本，不把安装程序文件名当成版本证据。
$VersionInfo = (Get-Item -LiteralPath $Artifact).VersionInfo
$ActualVersion = $VersionInfo.ProductVersion
if ([string]::IsNullOrWhiteSpace($ActualVersion)) { throw '安装程序没有 ProductVersion。' }
# NSIS 的资源版本可以附带第四段 0，规范化后与三段发布版本比较。
$Normalized = $ActualVersion.Trim() -replace '\.0$', ''
if ($ActualVersion.Trim() -match '^\d+\.\d+\.\d+$') { $Normalized = $ActualVersion.Trim() }
Write-Output $Normalized
