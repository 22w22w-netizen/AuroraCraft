# AuroraCraft 代码签名脚本
#
# 用法：
#   1) 自签名（本机测试用，SmartScreen 仍会提示，除非 -TrustCert 装到本机受信任根）
#      .\scripts\sign.ps1 -File release\AuroraCraft-Setup-1.0.0.exe -SelfSigned -TrustCert
#
#   2) 正式证书（推荐给最终用户，需 CA 签发的 .pfx）
#      .\scripts\sign.ps1 -File release\AuroraCraft-Setup-1.0.0.exe -Pfx my-cert.pfx -PfxPassword "密码"
#
# 参数：
#   -File        待签名的 exe / dll 路径
#   -SelfSigned  生成自签名代码签名证书并签名
#   -TrustCert   把自签名证书装入「本机受信任根」（仅影响本机，不能分发给别人）
#   -Pfx         已有 .pfx 证书路径
#   -PfxPassword .pfx 密码
#   -Subject     自签名证书主题

param(
  [Parameter(Mandatory = $true)][string]$File,
  [switch]$SelfSigned,
  [switch]$TrustCert,
  [string]$Pfx = "",
  [string]$PfxPassword = "",
  [string]$Subject = "CN=AuroraCraft, O=AuroraCraft, C=CN"
)

$ErrorActionPreference = 'Stop'

function Find-SignTool {
  $roots = @("${env:ProgramFiles(x86)}\Windows Kits\10\bin", "$env:ProgramFiles\Windows Kits\10\bin")
  foreach ($r in $roots) {
    if (-not (Test-Path $r)) { continue }
    $hit = Get-ChildItem $r -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match '\\x64\\' } |
      Sort-Object FullName -Descending | Select-Object -First 1
    if ($hit) { return $hit.FullName }
  }
  $cmd = Get-Command signtool.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}

if (-not (Test-Path $File)) { throw "找不到待签名文件：$File" }
$full = (Resolve-Path $File).Path

$signtool = Find-SignTool
if (-not $signtool) { throw "未找到 signtool.exe，请安装 Windows SDK。" }
Write-Host "signtool : $signtool"

$thumbprint = $null
$tempCert = $null

if ($Pfx) {
  # ---------- 使用已有 .pfx ----------
  if (-not (Test-Path $Pfx)) { throw "找不到证书文件：$Pfx" }
  $pwd = ConvertTo-SecureString $PfxPassword -AsPlainText -Force
  Write-Host "导入证书 $Pfx ..."
  $imported = Import-PfxCertificate -FilePath $Pfx -CertStoreLocation Cert:\CurrentUser\My -Password $pwd
  $thumbprint = $imported.Thumbprint
  $tempCert = $imported
}
elseif ($SelfSigned) {
  # ---------- 生成自签名证书 ----------
  Write-Host "生成自签名代码签名证书 ..."
  $existing = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert -ErrorAction SilentlyContinue |
    Where-Object { $_.Subject -eq $Subject } | Select-Object -First 1

  if ($existing) {
    Write-Host "复用已有自签名证书：$($existing.Thumbprint)"
    $cert = $existing
  }
  else {
    $cert = New-SelfSignedCertificate `
      -Type CodeSigningCert `
      -Subject $Subject `
      -CertStoreLocation Cert:\CurrentUser\My `
      -KeyUsage DigitalSignature `
      -KeyExportPolicy Exportable `
      -NotAfter (Get-Date).AddYears(5) `
      -HashAlgorithm SHA256
    Write-Host "已创建证书：$($cert.Thumbprint)"
  }
  $thumbprint = $cert.Thumbprint

  if ($TrustCert) {
    Write-Host "将证书装入本机「受信任根证书」..."
    $root = New-Object System.Security.Cryptography.X509Certificates.X509Store('Root', 'CurrentUser')
    $root.Open('ReadWrite')
    try { $root.Add($cert) } finally { $root.Close() }
    Write-Host "已加入受信任根（仅本机生效）"
  }
}
else {
  throw "请指定 -SelfSigned 或 -Pfx <证书路径>"
}

# ---------- 签名 ----------
Write-Host "开始签名：$full"
$args = @(
  'sign',
  '/fd', 'SHA256',
  '/sha1', $thumbprint,
  '/tr', 'http://timestamp.digicert.com',
  '/td', 'SHA256',
  '/v',
  $full
)
& $signtool @args
if ($LASTEXITCODE -ne 0) {
  Write-Warning "带时间戳签名失败（可能是无互联网时间戳服务），改用不带时间戳重试 ..."
  & $signtool sign /fd SHA256 /sha1 $thumbprint /v $full
  if ($LASTEXITCODE -ne 0) { throw "签名失败，signtool 退出码 $LASTEXITCODE" }
}

# ---------- 验证 ----------
Write-Host ""
Write-Host "签名结果验证："
$sig = Get-AuthenticodeSignature $full
[PSCustomObject]@{
  文件     = $full
  状态     = $sig.Status
  签名者   = $sig.SignerCertificate.Subject
  指纹     = $sig.SignerCertificate.Thumbprint
  算法     = $sig.SignatureType
  时间戳   = $sig.TimeStamperCertificate
} | Format-List

if ($SelfSigned -and -not $TrustCert) {
  Write-Host ""
  Write-Host "注意：这是自签名证书，Windows 默认不受信任，SmartScreen 仍会提示。" -ForegroundColor Yellow
  Write-Host "      对外分发请购买 CA 代码签名证书，或用 -Pfx 指定正式证书。" -ForegroundColor Yellow
}
if ($SelfSigned -and $TrustCert) {
  Write-Host ""
  Write-Host "自签名证书已装入本机受信任根，本机运行时不再显示「未知发布者」；" -ForegroundColor Green
  Write-Host "但该信任仅限本机，分发给他人无效。" -ForegroundColor Yellow
}

if ($tempCert) {
  Write-Host "（证书已保留在 Cert:\CurrentUser\My，如需清理请手动删除）"
}
