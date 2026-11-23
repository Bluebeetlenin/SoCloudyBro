# Adds any missing inline-script AND inline-event-handler hashes to the CSP in
# vercel.json.
#
# Why: vercel.json's Content-Security-Policy only allows inline scripts and
# static on*="..." handlers whose sha256 is listed. Editing an inline <script>,
# or adding/changing a static onclick="..." in SoCloudyBro.html, changes what
# needs allowing. Unlisted scripts freeze the app on the splash screen;
# unlisted handlers make their buttons silently do nothing.
#
# Run this from the repo root after editing SoCloudyBro.html and BEFORE pushing:
#   powershell -File scripts/update-csp-hashes.ps1
#
# It only adds hashes (stale ones are harmless), then checks the JSON parses.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$htmlPath = Join-Path $root 'SoCloudyBro.html'
$vjPath = Join-Path $root 'vercel.json'

# Browsers normalise CRLF to LF before hashing, so do the same.
$text = [IO.File]::ReadAllText($htmlPath, [Text.Encoding]::UTF8) -replace "`r", ''
$vj = [IO.File]::ReadAllText($vjPath, [Text.Encoding]::UTF8)
$sha = [Security.Cryptography.SHA256]::Create()
function Get-CspHash([string]$s) {
  'sha256-' + [Convert]::ToBase64String($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($s)))
}

$scriptRx = [regex]'(?is)<script(?<attrs>[^>]*)>(?<body>.*?)</script>'
$wanted = @()   # @{Hash=...; What=...}

# 1) inline <script> blocks
foreach ($m in $scriptRx.Matches($text)) {
  if ($m.Groups['attrs'].Value -match 'src\s*=') { continue }
  $body = $m.Groups['body'].Value
  if ([string]::IsNullOrWhiteSpace($body)) { continue }
  $wanted += [pscustomobject]@{ Hash = (Get-CspHash $body); What = "inline script ($($body.Length) chars)" }
}

# 2) static inline event handlers (on*="..."), outside <script> bodies.
#    The browser hashes the attribute value after HTML-entity decoding.
$markup = $scriptRx.Replace($text, '')
$attrRx = [regex]'(?is)\son[a-z]+\s*=\s*(?:"(?<v>[^"]*)"|''(?<v>[^'']*)'')'
foreach ($m in $attrRx.Matches($markup)) {
  $value = [System.Net.WebUtility]::HtmlDecode($m.Groups['v'].Value)
  $wanted += [pscustomobject]@{ Hash = (Get-CspHash $value); What = "handler: " + $value.Substring(0, [Math]::Min(60, $value.Length)) }
}

$missing = $wanted | Where-Object { -not $vj.Contains($_.Hash) } | Sort-Object Hash -Unique
if (-not $missing) { Write-Host 'CSP hashes already up to date.'; exit 0 }

$add = ($missing | ForEach-Object { "'$($_.Hash)'" }) -join ' '
$marker = "script-src 'self' 'unsafe-hashes' "
if (-not $vj.Contains($marker)) { throw "Could not find '$marker' in vercel.json" }
$vj = $vj.Replace($marker, $marker + $add + ' ')
[IO.File]::WriteAllText($vjPath, $vj, (New-Object Text.UTF8Encoding($false)))
$null = $vj | ConvertFrom-Json   # throws if the JSON is now invalid
Write-Host ("Added {0} hash(es) to vercel.json:" -f @($missing).Count)
$missing | ForEach-Object { Write-Host ("  {0}  {1}" -f $_.Hash, $_.What) }
