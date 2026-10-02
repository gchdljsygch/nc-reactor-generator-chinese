<#
.SYNOPSIS
    R0.5 — extract the 1185 translation pairs out of the hardcoded
    SimplifiedChineseLocalizer into a machine-readable catalogue.

.DESCRIPTION
    The current Chinese localisation lives in one 1252-line Java class as
    add(translations, "english", "中文", ...) calls. This script parses those
    literals, unescapes Java escapes, and writes:

      datasets/translations/legacy-translations.json   raw {en, zh} pairs (migration input)
      datasets/translations/legacy-translations.tsv    same, tab separated for review

    No classification is done here — see classify-translations.ps1, which
    cross-references these pairs against the NCPF element identities dumped by
    the ElementDump tool to split UI messages from data names.

.EXAMPLE
    pwsh -File tools/i18n/extract-translations.ps1
#>
[CmdletBinding()]
param(
    [string]$Source = "src/net/ncplanner/plannerator/planner/localization/SimplifiedChineseLocalizer.java",
    [string]$OutDir = "datasets/translations"
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = (Resolve-Path (Join-Path $scriptDir '..\..')).Path
if(-not [System.IO.Path]::IsPathRooted($Source)){ $Source = Join-Path $repoRoot $Source }
if(-not [System.IO.Path]::IsPathRooted($OutDir)){ $OutDir = Join-Path $repoRoot $OutDir }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Write-Host "source : $Source"
$text = Get-Content $Source -Raw

# Only the catalogue literal area: everything between the constructor's first
# add(...) call and the entries.addAll(...) statement.
$start = $text.IndexOf('add(translations,')
$end   = $text.IndexOf('entries.addAll(translations.entrySet())')
if($start -lt 0 -or $end -lt 0 -or $end -le $start){
    throw "could not locate the catalogue block (start=$start end=$end)"
}
$block = $text.Substring($start, $end - $start)
Write-Host "catalogue block: $($block.Length) chars"

# --- Java string literal scanner ---------------------------------------------
function ConvertFrom-JavaLiteral([string]$raw){
    $sb = New-Object System.Text.StringBuilder
    for($i = 0; $i -lt $raw.Length; $i++){
        $c = $raw[$i]
        if($c -ne '\'){ [void]$sb.Append($c); continue }
        $i++
        if($i -ge $raw.Length){ break }
        $e = $raw[$i]
        switch($e){
            'n'  { [void]$sb.Append("`n") }
            't'  { [void]$sb.Append("`t") }
            'r'  { [void]$sb.Append("`r") }
            '"'  { [void]$sb.Append('"') }
            "'"  { [void]$sb.Append("'") }
            '\'  { [void]$sb.Append('\') }
            'b'  { [void]$sb.Append([char]8) }
            'f'  { [void]$sb.Append([char]12) }
            '0'  { [void]$sb.Append([char]0) }
            'u'  {
                if($i + 4 -lt $raw.Length){
                    $hex = $raw.Substring($i+1, 4)
                    [void]$sb.Append([char][Convert]::ToInt32($hex, 16))
                    $i += 4
                }
            }
            default { [void]$sb.Append($e) }
        }
    }
    return $sb.ToString()
}

$rx = [regex]'"((?:[^"\\]|\\.)*)"'
$lits = @()
foreach($m in $rx.Matches($block)){
    $lits += ,(ConvertFrom-JavaLiteral $m.Groups[1].Value)
}
Write-Host "string literals found: $($lits.Count)"
if($lits.Count % 2 -ne 0){ throw "odd number of literals ($($lits.Count)) — not a clean key/value list" }

$pairs = New-Object System.Collections.Generic.List[object]
for($i = 0; $i -lt $lits.Count; $i += 2){
    $pairs.Add([PSCustomObject]@{ en = $lits[$i]; zh = $lits[$i+1] })
}
Write-Host "pairs: $($pairs.Count)"

# sanity: duplicate english keys
$dupes = $pairs | Group-Object en | Where-Object { $_.Count -gt 1 }
Write-Host "duplicate english keys: $($dupes.Count)"
foreach($d in $dupes){ Write-Host "   dup: '$($d.Name)' x$($d.Count)" }

$jsonPath = Join-Path $OutDir 'legacy-translations.json'
$doc = [PSCustomObject]@{
    meta = [PSCustomObject]@{
        source      = ($Source.Replace($repoRoot,'').TrimStart('\','/') -replace '\\','/')
        extractedAt = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK')
        pairCount   = $pairs.Count
        note        = 'R0.5 migration input. These are substring-replacement pairs from the legacy render-time localiser; keys are English source strings, NOT stable message IDs. They must be re-keyed during Phase 2/3 of the rewrite.'
    }
    pairs = $pairs
}
$doc | ConvertTo-Json -Depth 5 | Set-Content $jsonPath -Encoding UTF8
Write-Host "wrote $jsonPath"

$tsvPath = Join-Path $OutDir 'legacy-translations.tsv'
$pairs | ForEach-Object {
    "$($_.en -replace "`t",' ' -replace "`r?`n",'\n')`t$($_.zh -replace "`t",' ' -replace "`r?`n",'\n')"
} | Set-Content $tsvPath -Encoding UTF8
Write-Host "wrote $tsvPath"
