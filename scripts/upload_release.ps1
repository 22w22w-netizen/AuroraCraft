# Upload release assets to GitHub (ASCII only to avoid encoding issues)
# Token is read from env GITHUB_TOKEN and fed to curl via stdin (-K -),
# so it never appears in the process command line.
$ErrorActionPreference = 'Stop'

$token = $env:GITHUB_TOKEN
if ([string]::IsNullOrEmpty($token)) { throw 'GITHUB_TOKEN not set' }

$uploadBase = (Get-Content 'G:\dsh\_relurl.txt' -Raw).Trim()
$uploadBase = $uploadBase -replace '\{\?name,label\}$', ''
"upload base: $uploadBase"

$root = 'G:\dsh\MineLauncher'
$files = @(
  @{ p = "$root\release\AuroraCraft-Setup-1.0.0.exe";                 n = 'AuroraCraft-Setup-1.0.0.exe' },
  @{ p = "$root\release\multi\AuroraCraft-1.0.0-amd64.deb";           n = 'AuroraCraft-1.0.0-amd64.deb' },
  @{ p = "$root\release\multi\AuroraCraft-1.0.0-linux-x64.tar.gz";    n = 'AuroraCraft-1.0.0-linux-x64.tar.gz' },
  @{ p = "$root\release\multi\AuroraCraft-1.0.0-mac-arm64.zip";       n = 'AuroraCraft-1.0.0-mac-arm64.zip' },
  @{ p = "$root\release\multi\AuroraCraft-1.0.0-mac-x64.zip";         n = 'AuroraCraft-1.0.0-mac-x64.zip' },
  @{ p = "$root\release\multi\SHA256SUMS.txt";                        n = 'SHA256SUMS.txt' }
)

$cfg = "header = `"Authorization: Bearer $token`"`n" +
       "header = `"User-Agent: AuroraCraft`"`n" +
       "header = `"Accept: application/vnd.github+json`"`n" +
       "silent`nshow-error`nssl-no-revoke`n"

foreach ($f in $files) {
  if (-not (Test-Path $f.p)) { "SKIP (missing): $($f.n)"; continue }
  $sizeMb = [math]::Round((Get-Item $f.p).Length / 1MB, 1)
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  "UPLOAD $($f.n) ($sizeMb MB) ..."
  $out = $cfg | & curl.exe -K - -X POST `
      -H 'Content-Type: application/octet-stream' `
      --data-binary "@$($f.p)" `
      "$uploadBase`?name=$($f.n)" 2>&1
  $sec = [math]::Round($sw.Elapsed.TotalSeconds, 1)
  $json = $out | Out-String
  if ($json -match '"state"\s*:\s*"uploaded"') {
    "  OK  $($f.n) in ${sec}s"
  } else {
    $short = $json.Substring(0, [Math]::Min(300, $json.Length))
    "  FAIL $($f.n) in ${sec}s :: $short"
  }
}
"ALL DONE"
