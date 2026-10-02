<#
.SYNOPSIS
    R0.4 — generate and verify the historical-format fixtures.

.DESCRIPTION
    Runs FixtureGen twice: once for an Overhaul SFR and once for an Underhaul SFR.
    The underhaul run is the *control case*: it has no coolant recipe, so it avoids
    the `matches()` bug documented in docs/r0/fixtures.md and therefore proves the
    format machinery itself is sound.

    Requires the application classes to have been built already — run
    tools/golden/golden.ps1 once first (or pass -Build).

.EXAMPLE
    pwsh -File tools/golden/fixtures.ps1
#>
[CmdletBinding()]
param(
    [string]$OutDir = "datasets/fixtures",
    [switch]$Build
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = (Resolve-Path (Join-Path $scriptDir '..\..')).Path
$buildDir  = Join-Path $scriptDir 'build'
$appClasses = Join-Path $buildDir 'classes'
$toolClasses = Join-Path $buildDir 'tools'

# Use the DizzyEngine LWJGL/JOML set exclusively (see golden.ps1 for why).
$jars  = Get-ChildItem (Join-Path $repoRoot 'libraries') -Filter *.jar -File |
         Where-Object { $_.Name -notlike 'lwjgl*' -and $_.Name -ne 'joml-1.10.5.jar' }
$jars += Get-ChildItem (Join-Path $repoRoot 'libraries\DizzyEngine') -Filter *.jar -File |
         Where-Object { $_.Name -notlike '*-sources.jar' -and $_.Name -notlike '*-javadoc.jar' }
$jarPaths = $jars | ForEach-Object { $_.FullName }
$jarCp = $jarPaths -join ';'

if($Build -or -not (Test-Path $appClasses)){
    Write-Host "building application classes (this takes ~1 minute)..."
    New-Item -ItemType Directory -Force -Path $appClasses, $toolClasses | Out-Null
    $srcList = Join-Path $buildDir 'sources.txt'
    Get-ChildItem (Join-Path $repoRoot 'src') -Recurse -Filter *.java |
        ForEach-Object { $_.FullName } | Set-Content $srcList -Encoding UTF8
    & javac -encoding UTF-8 -nowarn -d $appClasses -cp $jarCp "@$srcList"
    if($LASTEXITCODE -ne 0){ throw "application compile failed" }
}

Write-Host "compiling R0 tools..."
& javac -encoding UTF-8 -nowarn -d $toolClasses -cp "$appClasses;$jarCp" `
    (Get-ChildItem (Join-Path $scriptDir 'src') -Recurse -Filter *.java).FullName
if($LASTEXITCODE -ne 0){ throw "tool compile failed" }

$runCp = @($appClasses, $toolClasses, (Join-Path $repoRoot 'src')) + $jarPaths
$env:JAVA_TOOL_OPTIONS = '-Dfile.encoding=UTF-8'

Write-Host ""
Write-Host "########## Overhaul SFR (exposes the matches() bug) ##########"
& java -cp ($runCp -join ';') net.ncplanner.plannerator.tools.FixtureGen `
    $OutDir "docs/r0/fixtures.md"
$a = $LASTEXITCODE

Write-Host ""
Write-Host "########## Underhaul SFR (control case, should round-trip) ##########"
& java -cp ($runCp -join ';') net.ncplanner.plannerator.tools.FixtureGen `
    $OutDir "docs/r0/fixtures-underhaul.md" --underhaul
$b = $LASTEXITCODE

Write-Host ""
Write-Host "########## NCConfig (.cfg) fixtures ##########"
& java -cp ($runCp -join ';') net.ncplanner.plannerator.tools.ConfigFixtureGen `
    $OutDir "docs/r0/fixtures-ncconfig.md"
$c = $LASTEXITCODE

Write-Host ""
Write-Host "########## reader coverage table (synthetic fixtures) ##########"
& java -cp ($runCp -join ';') net.ncplanner.plannerator.tools.RoundTrip `
    --coverage $OutDir "docs/r0/fixture-coverage.md"
$d = $LASTEXITCODE

Write-Host ""
Write-Host "########## real historical files (extracted from git history) ##########"
& pwsh -File (Join-Path $scriptDir 'historical-fixtures.ps1') -OutDir (Join-Path $OutDir 'historical')
$e = $LASTEXITCODE
if($e -eq 0){
    & java -cp ($runCp -join ';') net.ncplanner.plannerator.tools.RoundTrip `
        --coverage (Join-Path $OutDir 'historical') "docs/r0/historical-fixtures.md"
    $e = $LASTEXITCODE
}

Remove-Item Env:\JAVA_TOOL_OPTIONS -ErrorAction SilentlyContinue
if($a -ne 0 -or $b -ne 0 -or $c -ne 0 -or $d -ne 0 -or $e -ne 0){ exit 1 }
exit 0
