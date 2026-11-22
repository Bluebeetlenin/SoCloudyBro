# Adds any missing inline <script> hashes to the CSP in vercel.json.
#
# Why: vercel.json's Content-Security-Policy only allows inline scripts whose
# sha256 is listed. Editing any inline <script> in SoCloudyBro.html changes its
# hash, so the browser blocks it and the app freezes on the splash screen.
#
# Run this from the repo root after editing SoCloudyBro.html and BEFORE pushing:
#   powershell -File scripts/update-csp-hashes.ps1
#
# It only adds hashes (stale ones are harmless), then checks the JSON still parses.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$htmlPath = Join-Path $root 'SoCloudyBro.html'
$vjPath = Join-Path $root 'vercel.json'

# Browsers normalise CRLF to LF before hashing script text, so do the same.
$text = [IO.File]::ReadAllText($htmlPath, [Text.Encoding]::UTF8) -replace "`r", ''
$vj = [IO.File]::ReadAllText($vjPath, [Text.Encoding]::UTF8)
$sha = [Security.Cryptography.SHA256]::Create()
$rx = [regex]'(?is)<script(?<attrs>[^>]*)>(?<body>.*?)</script>'

$missing = @()
foreach ($m in $rx.Matches($text)) {
  if ($m.Groups['attrs'].Value -match 'src\s*=') { continue }
  $body = $m.Groups['body'].Value
  if ([string]::IsNullOrWhiteSpace($body)) { continue }
  $h = 'sha256-' + [Convert]::ToBase64String($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($body)))
  if (-not $vj.Contains($h)) { $missing += $h }
}

if ($missing.Count -eq 0) { Write-Host 'CSP hashes already up to date.'; exit 0 }

$add = ($missing | ForEach-Object { "'$_'" }) -join ' '
$marker = "script-src 'self' 'unsafe-hashes' "
if (-not $vj.Contains($marker)) { throw "Could not find '$marker' in vercel.json" }
$vj = $vj.Replace($marker, $marker + $add + ' ')
[IO.File]::WriteAllText($vjPath, $vj, (New-Object Text.UTF8Encoding($false)))
$null = $vj | ConvertFrom-Json   # throws if the JSON is now invalid
Write-Host ("Added {0} hash(es) to vercel.json:" -f $missing.Count)
$missing | ForEach-Object { Write-Host "  $_" }
