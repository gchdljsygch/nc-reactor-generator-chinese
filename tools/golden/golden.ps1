<#
.SYNOPSIS
    R0.2/R0.3 — build and run the headless golden-dataset generator for the
    NC Plannerator rewrite.

.DESCRIPTION
    Compiles the (frozen) Java plannerator domain layer plus the GoldenGen
    harness with a plain javac, then runs GoldenGen to produce a JSONL golden
    dataset. No Gradle/NetBeans build is required — the project's own build
    files are currently broken/inconsistent (see docs/rewrite-plan.md §1.3),
    so this script pins the toolchain explicitly.

    The harness runs WITHOUT any GL context:
      * plannerator.skipTextures=true  makes TextureModule skip the base64 PNG
        payloads, so the NCPF configs (10 MB, mostly textures) load headless.
      * Main.isBot=true short-circuits Core.warning/error/criticalError before
        they dereference the (null) GUI.

.EXAMPLE
    # full faithful dataset, default 5000 cases
    pwsh -File tools/golden/golden.ps1

.EXAMPLE
    # quick smoke test
    pwsh -File tools/golden/golden.ps1 -Cases 200 -Seed 7 -Out "$env:TEMP\smoke.jsonl"

.EXAMPLE
    # diagnose a single reactor shape
    pwsh -File tools/golden/golden.ps1 -Cases 1 -Diag -Strategies checker -MinSize 3 -MaxSize 3
#>
[CmdletBinding()]
param(
    [string]$Type = "sfr",
    [int]$Cases = 5000,
    [string]$Out = "",
    [long]$Seed = 20260101,
    [int]$MinSize = 3,
    [int]$MaxSize = 14,
    [string]$Strategies = "",
    [int]$MaxDivergencePrint = 10,
    [switch]$SkipCompile,
    [switch]$Chatty,
    [switch]$Diag
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = (Resolve-Path (Join-Path $scriptDir '..\..')).Path
$buildDir  = Join-Path $scriptDir 'build'

Write-Host "repo root : $repoRoot"
Write-Host "build dir : $buildDir"

# --- classpath ---------------------------------------------------------------
# Use the DizzyEngine LWJGL/JOML set exclusively. libraries/ carries an older
# LWJGL 3.3.3 core whose natives are excluded below, and mixing the 3.3.3 core
# with 3.3.6 natives makes native loading fail ("Failed to locate library:
# lwjgl.dll"), which breaks any code path that decodes a texture.
$jars  = Get-ChildItem (Join-Path $repoRoot 'libraries') -Filter *.jar -File |
         Where-Object { $_.Name -notlike 'lwjgl*' -and $_.Name -ne 'joml-1.10.5.jar' }   # superseded by libraries/DizzyEngine
$jars += Get-ChildItem (Join-Path $repoRoot 'libraries\DizzyEngine') -Filter *.jar -File |
         Where-Object { $_.Name -notlike '*-sources.jar' -and $_.Name -notlike '*-javadoc.jar' }
$jarPaths = $jars | ForEach-Object { $_.FullName }
Write-Host "classpath : $($jarPaths.Count) jars"

$appClasses = Join-Path $buildDir 'classes'
$toolClasses = Join-Path $buildDir 'tools'

if(-not $SkipCompile){
    New-Item -ItemType Directory -Force -Path $appClasses, $toolClasses | Out-Null

    Write-Host "[1/3] compiling application sources (this takes ~1 minute)..."
    $srcFiles = Get-ChildItem (Join-Path $repoRoot 'src') -Recurse -Filter *.java | ForEach-Object { $_.FullName }
    $srcList  = Join-Path $buildDir 'sources.txt'
    $srcFiles | Set-Content $srcList -Encoding UTF8
    & javac -encoding UTF-8 -nowarn -d $appClasses -cp ($jarPaths -join ';') "@$srcList"
    if($LASTEXITCODE -ne 0){ throw "application compile failed (exit $LASTEXITCODE)" }

    Write-Host "[2/3] compiling golden harness..."
    $toolFiles = Get-ChildItem (Join-Path $scriptDir 'src') -Recurse -Filter *.java | ForEach-Object { $_.FullName }
    & javac -encoding UTF-8 -nowarn -d $toolClasses -cp (($appClasses) + ';' + ($jarPaths -join ';')) $toolFiles
    if($LASTEXITCODE -ne 0){ throw "harness compile failed (exit $LASTEXITCODE)" }
}else{
    Write-Host "[1/3] skipping compile (-SkipCompile)"
}

# --- run ---------------------------------------------------------------------
if($Out -eq ''){ $Out = "datasets/golden/$Type-cases.jsonl" }
if(-not [System.IO.Path]::IsPathRooted($Out)){ $Out = Join-Path $repoRoot $Out }
$outDir = Split-Path -Parent $Out
if($outDir -and -not (Test-Path $outDir)){ New-Item -ItemType Directory -Force -Path $outDir | Out-Null }

$runCp = @($appClasses, $toolClasses, (Join-Path $repoRoot 'src')) + $jarPaths

$genArgs = @(
    '--type', $Type,
    '--cases', $Cases,
    '--out', $Out,
    '--seed', $Seed,
    '--min-size', $MinSize,
    '--max-size', $MaxSize,
    '--max-divergence-print', $MaxDivergencePrint
)
if($Strategies -ne ''){ $genArgs += @('--strategies', $Strategies) }
if($Chatty){ $genArgs += '--verbose' }
if($Diag){ $genArgs += '--diag' }

Write-Host "[3/3] running GoldenGen (type=$Type)..."
$env:JAVA_TOOL_OPTIONS = '-Dfile.encoding=UTF-8'
& java -cp ($runCp -join ';') net.ncplanner.plannerator.tools.GoldenGen @genArgs
$code = $LASTEXITCODE
Remove-Item Env:\JAVA_TOOL_OPTIONS -ErrorAction SilentlyContinue
exit $code

