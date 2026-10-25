# Fix release name/body with correct UTF-8 (ASCII-only script; Chinese comes from the .md file)
$ErrorActionPreference = 'Stop'
$token = $env:GITHUB_TOKEN
if ([string]::IsNullOrEmpty($token)) { throw 'GITHUB_TOKEN not set' }

$mdPath   = 'G:\dsh\MineLauncher\build\release_body.md'
$jsonFile = 'G:\dsh\_rel_patch.json'
$cfgFile  = 'G:\dsh\_curl.cfg'
$outFile  = 'G:\dsh\_rel_patch.out'

$bodyText = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes($mdPath))
$nameText = [System.Text.Encoding]::UTF8.GetString([System.Text.Encoding]::UTF8.GetBytes(
    [char]0x0041 + [char]0x0075 + [char]0x0072 + [char]0x006F + [char]0x0072 + [char]0x0061 +
    [char]0x0043 + [char]0x0072 + [char]0x0061 + [char]0x0066 + [char]0x0074 + [char]0x0020 +
    [char]0x6781 + [char]0x5149 + [char]0x542F + [char]0x52A8 + [char]0x5668 + [char]0x0020 +
    [char]0x76 + [char]0x0031 + [char]0x002E + [char]0x0030 + [char]0x002E + [char]0x0030))

function EscJson([string]$s) {
    $s = $s.Replace('\', '\\').Replace('"', '\"')
    $s = $s.Replace("`r`n", "\n").Replace("`n", "\n").Replace("`r", "\n")
    return $s
}

$json = '{"name":"' + (EscJson $nameText) + '","body":"' + (EscJson $bodyText) + '"}'
[System.IO.File]::WriteAllBytes($jsonFile, [System.Text.Encoding]::UTF8.GetBytes($json))
"json bytes: $((Get-Item $jsonFile).Length)"
$cjk = ([regex]::Matches($json, '[\u4e00-\u9fff]')).Count
"cjk chars in json: $cjk"

$cfg = "header = `"Authorization: Bearer $token`"`n" +
       "header = `"User-Agent: AuroraCraft`"`n" +
       "header = `"Accept: application/vnd.github+json`"`n" +
       "silent`nshow-error`nssl-no-revoke`n" +
       "output = `"$outFile`"`n"
[System.IO.File]::WriteAllText($cfgFile, $cfg, (New-Object System.Text.ASCIIEncoding))
Remove-Item $outFile -ErrorAction SilentlyContinue

& curl.exe -K $cfgFile -X PATCH -H 'Content-Type: application/json' --data-binary "@$jsonFile" `
    'https://api.github.com/repos/22w22w-netizen/AuroraCraft/releases/423172730'
"curl exit=$LASTEXITCODE"

if (Test-Path $outFile) {
    $o = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes($outFile))
    if ($o -match '"id"') {
        $nm = ([regex]::Match($o, '"name"\s*:\s*"([^"]*)"')).Groups[1].Value
        $bc = ([regex]::Matches($o, '[\u4e00-\u9fff]')).Count
        "PATCH OK"
        "name: $nm"
        "cjk in response: $bc"
    } else {
        "PATCH FAIL: " + $o.Substring(0, [Math]::Min(400, $o.Length))
    }
} else {
    "no output file"
}

Remove-Item $cfgFile, $jsonFile -ErrorAction SilentlyContinue
