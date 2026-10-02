<#
.SYNOPSIS
    R2 — build the format-compatibility goldens with the frozen Java reader chain.

.DESCRIPTION
    Compiles the (frozen) Java plannerator domain layer plus the FormatGolden
    harness, then converts every fixture under datasets/fixtures into NCPF JSON
    plus a MANIFEST.json holding the effective reader, element/design counts and
    the structural fingerprint (the same function that produced the 38/38
    baseline in docs/r0/format-roundtrip.md).

    The converted files are the oracle the TypeScript R2 readers are tested
    against; --probe can be used to feed a TS-written file back into the frozen
    Java reader (iron law 5: the two writer semantics must not be mixed).

.EXAMPLE
    pwsh -File tools/golden/format-golden.ps1
.EXAMPLE
    # verify a file written by the TS side
    pwsh -File tools/golden/format-golden.ps1 -Probe datasets/fixtures/historical/underhaul.json
#>
[CmdletBinding()]
param(
    [string]$Fixtures = "datasets/fixtures",
    [string]$Out = "datasets/converted",
    [string]$Probe = "",
    [switch]$SkipCompile
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = (Resolve-Path (Join-Path $scriptDir '..\..')).Path
$buildDir  = Join-Path $scriptDir 'build'

$jars  = Get-ChildItem (Join-Path $repoRoot 'libraries') -Filter *.jar -File |
         Where-Object { $_.Name -notlike 'lwjgl*' -and $_.Name -ne 'joml-1.10.5.jar' }
$jars += Get-ChildItem (Join-Path $repoRoot 'libraries\DizzyEngine') -Filter *.jar -File |
         Where-Object { $_.Name -notlike '*-sources.jar' -and $_.Name -notlike '*-javadoc.jar' }
$jarPaths = $jars | ForEach-Object { $_.FullName }

$appClasses  = Join-Path $buildDir 'classes'
$toolClasses = Join-Path $buildDir 'tools'

if(-not $SkipCompile){
    New-Item -ItemType Directory -Force -Path $appClasses, $toolClasses | Out-Null
    Write-Host "[1/3] compiling application sources..."
    $srcFiles = Get-ChildItem (Join-Path $repoRoot 'src') -Recurse -Filter *.java | ForEach-Object { $_.FullName }
    $srcList  = Join-Path $buildDir 'sources.txt'
    $srcFiles | Set-Content $srcList -Encoding UTF8
    & javac -encoding UTF-8 -nowarn -d $appClasses -cp ($jarPaths -join ';') "@$srcList"
    if($LASTEXITCODE -ne 0){ throw "application compile failed (exit $LASTEXITCODE)" }
}else{
    Write-Host "[1/3] skipping application compile (-SkipCompile)"
}

Write-Host "[2/3] compiling FormatGolden harness..."
& javac -encoding UTF-8 -nowarn -d $toolClasses -cp (($appClasses) + ';' + $toolClasses + ';' + ($jarPaths -join ';')) `
    (Join-Path $scriptDir 'src\net\ncplanner\plannerator\tools\FormatGolden.java')
if($LASTEXITCODE -ne 0){ throw "harness compile failed (exit $LASTEXITCODE)" }

$runCp = @($appClasses, $toolClasses, (Join-Path $repoRoot 'src')) + $jarPaths
$env:JAVA_TOOL_OPTIONS = '-Dfile.encoding=UTF-8'

function Resolve-RepoPath([string]$p){
    if([System.IO.Path]::IsPathRooted($p)){ return $p }
    return (Join-Path $repoRoot $p)
}

if($Probe -ne ""){
    Write-Host "[3/3] probing $Probe"
    & java -cp ($runCp -join ';') net.ncplanner.plannerator.tools.FormatGolden --probe (Resolve-RepoPath $Probe)
    $code = $LASTEXITCODE
}else{
    Write-Host "[3/3] converting fixtures..."
    & java -cp ($runCp -join ';') net.ncplanner.plannerator.tools.FormatGolden --convert (Resolve-RepoPath $Fixtures) (Resolve-RepoPath $Out)
    $code = $LASTEXITCODE
}

Remove-Item Env:\JAVA_TOOL_OPTIONS -ErrorAction SilentlyContinue
exit $code
