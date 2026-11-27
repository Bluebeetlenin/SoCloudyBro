# Keeps the inline-script / inline-event-handler hashes in vercel.json's CSP in
# sync with SoCloudyBro.html.
#
# Why: the CSP only allows inline scripts and on*="..." handlers whose sha256 is
# listed. Editing an inline <script>, or adding/changing a static onclick="...",
# changes what must be allowed. Unlisted scripts freeze the app on the splash
# screen; unlisted handlers make their buttons silently do nothing.
#
# Usage (repo root, after editing SoCloudyBro.html and BEFORE pushing):
#   powershell -File scripts/update-csp-hashes.ps1           # add missing hashes
#   powershell -File scripts/update-csp-hashes.ps1 -Prune    # also drop unused ones
#
# -Prune keeps a hash if it matches ANYTHING the page can use: inline scripts,
# static handlers, or any handler built inside JavaScript (tried in several
# escaping variants, so it errs on the side of keeping). It also removes
# duplicates. Use it when the header is getting big.

param([switch]$Prune)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$htmlPath = Join-Path $root 'SoCloudyBro.html'
$vjPath = Join-Path $root 'vercel.json'

# 0) version-stamp local assets: /js/x.js?v=<first 10 hex of sha256>. A change to
#    any file then changes the HTML, which busts caches and triggers the update.
$assetRx = [regex]'(?<attr>(?:src|href)=")(?<path>/(?:js|css)/[^"?]+)(?:\?v=[0-9a-f]+)?"'
$page = [IO.File]::ReadAllText($htmlPath, [Text.Encoding]::UTF8)
$stamped = $assetRx.Replace($page, {
  param($m)
  $rel = $m.Groups['path'].Value
  $body = [IO.File]::ReadAllText((Join-Path $root $rel.TrimStart('/')), [Text.Encoding]::UTF8) -replace "`r", ''
  $bytes = [Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($body))
  $v = (-join ($bytes | ForEach-Object { $_.ToString('x2') })).Substring(0, 10)
  $m.Groups['attr'].Value + $rel + '?v=' + $v + '"'
})
if ($stamped -ne $page) {
  [IO.File]::WriteAllText($htmlPath, $stamped, (New-Object Text.UTF8Encoding($false)))
  Write-Host 'Updated asset version stamps in SoCloudyBro.html.'
}

# Browsers normalise CRLF to LF before hashing, so do the same.
$text = [IO.File]::ReadAllText($htmlPath, [Text.Encoding]::UTF8) -replace "`r", ''
$vj = [IO.File]::ReadAllText($vjPath, [Text.Encoding]::UTF8)
$sha = [Security.Cryptography.SHA256]::Create()
function Get-CspHash([string]$s) {
  'sha256-' + [Convert]::ToBase64String($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($s)))
}

$scriptRx = [regex]'(?is)<script(?<attrs>[^>]*)>(?<body>.*?)</script>'
$required = New-Object 'System.Collections.Generic.Dictionary[string,string]'   # hash -> what
$keepOnly = New-Object 'System.Collections.Generic.HashSet[string]'             # extra "do not prune" hashes

# 1) inline <script> blocks
foreach ($m in $scriptRx.Matches($text)) {
  if ($m.Groups['attrs'].Value -match 'src\s*=') { continue }
  $body = $m.Groups['body'].Value
  if ([string]::IsNullOrWhiteSpace($body)) { continue }
  $required[(Get-CspHash $body)] = "inline script ($($body.Length) chars)"
}

# 2) static inline handlers (on*="..."), outside <script> bodies. The browser
#    hashes the attribute value after HTML-entity decoding.
$markup = $scriptRx.Replace($text, '')
$attrRx = [regex]'(?is)\son[a-z]+\s*=\s*(?:"(?<v>[^"]*)"|''(?<v>[^'']*)'')'
foreach ($m in $attrRx.Matches($markup)) {
  $value = [System.Net.WebUtility]::HtmlDecode($m.Groups['v'].Value)
  $required[(Get-CspHash $value)] = "handler: " + $value.Substring(0, [Math]::Min(60, $value.Length))
}

# 3) handlers built inside JavaScript strings. Only used to decide what is safe
#    to prune; several escaping variants are tried because the runtime value
#    depends on how the string is written in the source.
$dynRx = [regex]'\bon[a-z]+\s*=\s*(\\?)(["''])'
$scriptBodies = @($scriptRx.Matches($text) | Where-Object { $_.Groups['attrs'].Value -notmatch 'src\s*=' } | ForEach-Object { $_.Groups['body'].Value })
$scriptBodies += @(Get-ChildItem (Join-Path $root 'js') -Recurse -Filter *.js | ForEach-Object { [IO.File]::ReadAllText($_.FullName, [Text.Encoding]::UTF8) -replace "`r", '' })
foreach ($body in $scriptBodies) {
  foreach ($ln in ($body -split "`n")) {
    foreach ($m in $dynRx.Matches($ln)) {
      $term = $m.Groups[1].Value + $m.Groups[2].Value
      $start = $m.Index + $m.Length
      $end = $ln.IndexOf($term, $start)
      if ($end -lt 0) { continue }
      $raw = $ln.Substring($start, $end - $start)
      $v1 = $raw.Replace("\'", "'").Replace('\"', '"').Replace('\\', '\')
      $v2 = $raw.Replace("\'", "'").Replace('\"', '"')
      foreach ($cand in @($raw, $v1, $v2)) { [void]$keepOnly.Add((Get-CspHash $cand)) }
    }
  }
}

$marker = "script-src 'self' 'unsafe-hashes' "
if (-not $vj.Contains($marker)) { throw "Could not find '$marker' in vercel.json" }

$tokenRx = [regex]"'(sha256-[A-Za-z0-9+/=]+)'\s?"
$existing = @($tokenRx.Matches($vj) | ForEach-Object { $_.Groups[1].Value })
$missing = @($required.Keys | Where-Object { $existing -notcontains $_ })

$dups = $existing.Count - @($existing | Sort-Object -Unique).Count
$stale = @($existing | Sort-Object -Unique | Where-Object { -not $required.ContainsKey($_) -and -not $keepOnly.Contains($_) })
$before = $vj.Length

if ($Prune) {
  $seen = New-Object 'System.Collections.Generic.HashSet[string]'
  $vj = $tokenRx.Replace($vj, {
    param($m)
    $h = $m.Groups[1].Value
    $unused = (-not $required.ContainsKey($h)) -and (-not $keepOnly.Contains($h))
    if ($unused -or -not $seen.Add($h)) { '' } else { $m.Value }
  })
}

if ($missing.Count -gt 0) {
  $add = ($missing | ForEach-Object { "'$_'" }) -join ' '
  $vj = $vj.Replace($marker, $marker + $add + ' ')
}

if ($missing.Count -eq 0 -and -not $Prune) {
  Write-Host 'CSP hashes already up to date.'
  if ($stale.Count -gt 0 -or $dups -gt 0) {
    Write-Host ("  ({0} unused and {1} duplicate hash(es) could be removed with -Prune)" -f $stale.Count, $dups)
  }
  exit 0
}

[IO.File]::WriteAllText($vjPath, $vj, (New-Object Text.UTF8Encoding($false)))
$null = $vj | ConvertFrom-Json   # throws if the JSON is now invalid
if ($missing.Count -gt 0) {
  Write-Host ("Added {0} hash(es):" -f $missing.Count)
  $missing | ForEach-Object { Write-Host ("  {0}  {1}" -f $_, $required[$_]) }
}
if ($Prune) {
  Write-Host ("Pruned {0} unused and {1} duplicate hash(es); vercel.json is {2} bytes smaller." -f $stale.Count, $dups, ($before - $vj.Length + ($missing | ForEach-Object { $_.Length + 3 } | Measure-Object -Sum).Sum))
}
$policyLen = ([regex]::Match($vj, "default-src[^`"]*")).Length
Write-Host ("CSP header is now about {0} bytes." -f $policyLen)
