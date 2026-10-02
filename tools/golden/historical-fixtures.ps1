<#
.SYNOPSIS
    R0.4 — extract REAL historical format files from this repository's own git history.

.DESCRIPTION
    The repository ships no legacy-format samples at HEAD (they were all converted to
    *.ncpf.json over time), but git history holds genuine files that the software wrote
    at the time — which is exactly the version diversity the compatibility baseline
    needs, and is not circular (unlike synthesising input from a reader's own source).

    For each path below this script finds the most recent commit in which the file still
    existed, extracts that blob into datasets/fixtures/historical/, and records the
    provenance in a manifest. Run RoundTrip --coverage on the output directory afterwards
    (done automatically by tools/golden/fixtures.ps1 if you pass -Historical).

.NOTES
    Blobs are extracted with `cmd /c "git show <rev>:<path> > <dest>"` because
    LegacyNCPF files are binary (config2 format) and a PowerShell pipeline would decode
    them as text and corrupt them.

.EXAMPLE
    pwsh -File tools/golden/historical-fixtures.ps1
#>
[CmdletBinding()]
param(
    [string]$OutDir = "datasets/fixtures/historical"
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = (Resolve-Path (Join-Path $scriptDir '..\..')).Path

Push-Location $repoRoot
try{
    # Paths chosen from `git log --all --diff-filter=A --name-only -- '*.ncpf' '*.json'`:
    # the oldest design/config files plus a spread of 2021-2025 legacy configurations.
    #
    # The plain form picks the most recent revision in which the path still existed.
    # `path|rev|outName` pins an explicit revision (a commit or a blob SHA) and an
    # output file name — R2.3/R2.4 use it to pull the *old* serialisations out of
    # history. Probing every historical blob of every `*.ncpf` path yields the
    # version spread 1, 2, 5, 8, 10, 11; the frozen versions 3, 4, 6, 7 and 9 were
    # never committed to this repository in any revision, so those readers stay
    # sample-free (see docs/r2/README.md).
    $paths = @(
        'asdf.ncpf'                                            # 2020 v1 design/config
        'qwerty.ncpf'                                          # 2020 v1 design/config
        'src/configurations/e2e.ncpf|2c32149f|e2e-v1.ncpf'      # v1
        'src/configurations/po3.ncpf|cc6a2309|po3-v1.ncpf'      # v1
        'src/configurations/e2e.ncpf|ccb9394c|e2e-v2.ncpf'      # v2
        'src/configurations/po3.ncpf|82076cb9|po3-v2.ncpf'      # v2
        'src/configurations/e2e.ncpf|02fdb5fd|e2e-v5.ncpf'      # v5
        'src/configurations/po3.ncpf|08d8de55|po3-v5.ncpf'      # v5
        'src/configurations/fusion_test.ncpf|4dec7030|fusion_test-v8.ncpf' # v8
        'src/configurations/addons/aop.ncpf|892946a6|aop-v10.ncpf'         # v10
        'src/configurations/addons/thorium_mixed_fuels.ncpf|1a09ffd6'      # v11
        'overhaul.json'                                        # 2020 Hellrage SFR v5
        'src/configurations/quanta.ncpf'                       # 2022 v11
        'src/configurations/aapn.ncpf'                         # 2021 v11
        'src/configurations/addons/moar_fuels.ncpf'            # 2021 v11
        'src/configurations/addons/moar_heat_sinks.ncpf'       # 2021 v11
        'src/configurations/addons/extreme_reactors.ncpf'      # 2021 v10
        'src/configurations/addons/ic2.ncpf'                   # 2021 v10
        'src/configurations/addons/inert_matrix_fuels.ncpf'    # 2021 v11
        'src/configurations/addons/alloy_heat_sinks.ncpf'      # 2021 v11
        'src/configurations/addons/spicy_heat_sinks_stable.ncpf'# 2021 v11
        'underhaul.json'                                       # 2020 Hellrage underhaul
        'src/configurations/nuclearcraft.ncpf'                 # main NC config, legacy format
        'src/configurations/e2e.ncpf'                          # 2020-2021 pack config
        'src/configurations/po3.ncpf'                          # 2020-2021 pack config
        'src/configurations/fusion_test.ncpf'                  # 2020 fusion testbed
        'src/configurations/addons/trinity.ncpf'
        'src/configurations/addons/qmd.ncpf'
    )

    $out = Join-Path $repoRoot $OutDir
    New-Item -ItemType Directory -Force -Path $out | Out-Null

    $manifest = New-Object System.Collections.Generic.List[object]
    foreach($entry in $paths){
        $parts = $entry.Split('|')
        $p = $parts[0]
        $rev = if($parts.Count -gt 1){ $parts[1] } else { '' }
        $leaf = if($parts.Count -gt 2 -and $parts[2] -ne ''){ $parts[2] } else { Split-Path $p -Leaf }

        if($rev -ne ''){
            # Explicit revision (blob SHA or commit): `git cat-file blob` handles both,
            # and a blob SHA has no `rev:path` form.
            $found = $rev
            $date = (git log -1 --format='%ad' --date=short --all --find-object=$rev 2>$null)
            if(-not $date){ $date = 'unknown' }
        }else{
            $commits = git log --all --format='%H' -- $p 2>$null
            $found = $null
            foreach($c in $commits){
                git cat-file -e "${c}:${p}" 2>$null
                if($LASTEXITCODE -eq 0){ $found = $c; break }
            }
            if(-not $found){ Write-Warning "no version found in history: $p"; continue }
            $date = git log -1 --format='%ad' --date=short $found
        }

        $dest = Join-Path $out $leaf
        if(Test-Path $dest){ Remove-Item $dest -Force }
        if($rev -ne ''){
            cmd /c "git cat-file blob $found > `"$dest`"" | Out-Null
        }else{
            cmd /c "git show $found`:$p > `"$dest`"" | Out-Null
        }

        $size = if(Test-Path $dest){ (Get-Item $dest).Length } else { 0 }
        if($size -eq 0){ Write-Warning "extracted 0 bytes: $p"; continue }
        $manifest.Add([PSCustomObject]@{
            file   = $leaf
            source = $p
            commit = if($found.Length -ge 8){ $found.Substring(0, 8) } else { $found }
            date   = $date
            bytes  = $size
        })
        Write-Host ("{0,-34} {1,9:N0} bytes  {2}  ({3})" -f $leaf, $size, $date, $found.Substring(0,8))
    }

    $manifestPath = Join-Path $out 'MANIFEST.txt'
    $manifest | ConvertTo-Json -Depth 4 | Set-Content $manifestPath -Encoding UTF8
    Write-Host ""
    Write-Host "extracted : $($manifest.Count) historical file(s)"
    Write-Host "out dir   : $out"
    Write-Host "manifest  : $manifestPath"
}finally{
    Pop-Location
}
