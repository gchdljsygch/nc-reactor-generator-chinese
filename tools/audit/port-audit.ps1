<#
.SYNOPSIS
    R0.6 — produce a FILE-LEVEL port/rewrite/drop audit for the rewrite.

.DESCRIPTION
    docs/rewrite-plan.md §2.1 estimates the split by package. This script turns
    that into a per-file classification so the work can actually be scheduled and
    the estimate verified.

    Classification is by path rule plus a light content heuristic:

      DROP            replaced by the new stack, not ported
      PORT-MODEL      NCPF data model / configuration model
      PORT-PHYSICS    reactor physics — must collapse into ONE kernel
      PORT-UI-LOGIC   UI-free logic that the new UI will reuse (actions, symmetry)
      PORT-FORMAT     format IO (compatibility surface)
      REWRITE         needs reimplementation with different mechanics (module
                      registry, settings, tutorial engine, i18n)
      REVIEW          needs a human call

    The heuristic also records, for multiblock files, whether the file contains
    physics (calculate/flux/heat) and/or rendering (render/draw), because the
    whole point of the rewrite is to stop those living in the same file.

.EXAMPLE
    pwsh -File tools/audit/port-audit.ps1
#>
[CmdletBinding()]
param(
    [string]$SrcDir = "src",
    [string]$OutFile = "docs/r0/port-audit.md"
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = (Resolve-Path (Join-Path $scriptDir '..\..')).Path
function Abs([string]$p){ if([System.IO.Path]::IsPathRooted($p)){ $p } else { Join-Path $repoRoot $p } }
$SrcDir  = Abs $SrcDir
$OutFile = Abs $OutFile
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutFile) | Out-Null

$pkgRoot = 'net/ncplanner/plannerator'

function Classify([string]$rel, [string]$text){
    $r = $rel -replace '\\','/'
    # ---- DROP ---------------------------------------------------------------
    if($r -match '^net/ncplanner/plannerator/planner/gui/')       { return 'DROP' }
    if($r -match '^net/ncplanner/plannerator/planner/theme/')     { return 'DROP' }
    if($r -match '^net/ncplanner/plannerator/planner/vr/')        { return 'DROP' }
    if($r -match '^net/ncplanner/plannerator/planner/dssl/')      { return 'DROP' }
    if($r -match '^net/ncplanner/plannerator/planner/localization/'){ return 'DROP' }
    if($r -match '^net/ncplanner/plannerator/graphics/')          { return 'DROP' }
    if($r -match '^net/ncplanner/plannerator/discord/')           { return 'DROP' }
    # ---- PORT ---------------------------------------------------------------
    if($r -match '^net/ncplanner/plannerator/ncpf/')              { return 'PORT-MODEL' }
    if($r -match '^net/ncplanner/plannerator/planner/ncpf/')      { return 'PORT-MODEL' }
    if($r -match '^net/ncplanner/plannerator/planner/file/')      { return 'PORT-FORMAT' }
    if($r -match '^net/ncplanner/plannerator/multiblock/editor/') { return 'PORT-UI-LOGIC' }
    if($r -match '^net/ncplanner/plannerator/multiblock/symmetry/'){ return 'PORT-UI-LOGIC' }
    if($r -match '^net/ncplanner/plannerator/multiblock/configuration/'){ return 'PORT-UI-LOGIC' }
    # ---- multiblock: physics vs UI -----------------------------------------
    if($r -match '^net/ncplanner/plannerator/multiblock/'){
        $hasPhysics = $text -match 'neutronFlux|totalHeat|totalOutput|totalEfficiency|calculateStats|propogate|heatMult|moderatorLines|cluster'
        $hasRender  = $text -match 'Renderer|render2d|render3d|void draw\(|getTexture|drawText'
        if($hasPhysics -and -not $hasRender){ return 'PORT-PHYSICS' }
        if($hasPhysics -and $hasRender){ return 'SPLIT-PHYSICS-UI' }
        if($hasRender){ return 'REWRITE' }
        return 'PORT-UI-LOGIC'
    }
    # ---- planner misc -------------------------------------------------------
    if($r -match '^net/ncplanner/plannerator/planner/module/')    { return 'REWRITE' } # reflection registry
    if($r -match '^net/ncplanner/plannerator/planner/tutorial/')  { return 'REWRITE' }
    if($r -match '^net/ncplanner/plannerator/config2/')           { return 'REWRITE' } # settings -> JSON
    if($r -match '^net/ncplanner/plannerator/planner/editor/')    { return 'PORT-UI-LOGIC' }
    if($r -match '^net/ncplanner/plannerator/planner/')           { return 'REVIEW' }
    return 'REVIEW'
}

$files = Get-ChildItem $SrcDir -Recurse -Filter *.java -File
Write-Host "scanning $($files.Count) files"

$rows = foreach($f in $files){
    $rel = $f.FullName.Substring($SrcDir.Length).TrimStart('\','/')
    $text = Get-Content $f.FullName -Raw
    $cls = Classify $rel $text
    [PSCustomObject]@{
        Path  = $rel -replace '\\','/'
        Class = $cls
        Lines = (Get-Content $f.FullName | Measure-Object -Line).Lines
        Bytes = $f.Length
    }
}

$totalFiles = $rows.Count
$totalLines = ($rows | Measure-Object Lines -Sum).Sum

$summary = $rows | Group-Object Class | ForEach-Object {
    [PSCustomObject]@{
        Class = $_.Name
        Files = $_.Count
        Lines = ($_.Group | Measure-Object Lines -Sum).Sum
    }
} | Sort-Object Lines -Descending

$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine('# R0.6 — 文件级移植审计（port audit）')
[void]$sb.AppendLine()
[void]$sb.AppendLine('> 由 `tools/audit/port-audit.ps1` 自动生成。分类规则见脚本头部注释。')
[void]$sb.AppendLine('>')
[void]$sb.AppendLine('> 这是对 `docs/rewrite-plan.md` §2.1「按包估算」的细化 —— 落到**每个文件**，')
[void]$sb.AppendLine('> 以便真正能排期，也能验证那份估算。')
[void]$sb.AppendLine()
[void]$sb.AppendLine('## 1. 总量')
[void]$sb.AppendLine()
[void]$sb.AppendLine("| 项 | 数值 |")
[void]$sb.AppendLine("|---|---:|")
[void]$sb.AppendLine("| Java 文件 | $totalFiles |")
[void]$sb.AppendLine("| 代码行 | $totalLines |")
[void]$sb.AppendLine()
[void]$sb.AppendLine('## 2. 分类汇总')
[void]$sb.AppendLine()
[void]$sb.AppendLine('| 分类 | 文件 | 行数 | 占比（行） | 说明 |')
[void]$sb.AppendLine('|---|---:|---:|---:|---|')
$desc = @{
    'DROP'               = '被新栈取代，不移植（GUI / 主题 / VR / DSSL / Discord / 旧渲染 / 旧本地化）'
    'PORT-MODEL'         = 'NCPF 数据模型与配置模型，语义移植'
    'PORT-PHYSICS'       = '反应堆物理，必须合并为**唯一内核**'
    'SPLIT-PHYSICS-UI'   = '⚠️ 物理与渲染在同一个文件里 —— 必须先拆再移植'
    'PORT-FORMAT'        = '格式 IO（兼容性契约面）'
    'PORT-UI-LOGIC'      = '无 UI 依赖的业务逻辑（action / symmetry / editor 工具）'
    'REWRITE'            = '需换机制重写（反射模块注册 / 设置 / 教程引擎 / i18n）'
    'REVIEW'             = '需人工判断'
}
foreach($s in $summary){
    $pct = if($totalLines){ [math]::Round(100.0*$s.Lines/$totalLines,1) } else { 0 }
    $d = if($desc.ContainsKey($s.Class)){ $desc[$s.Class] } else { '' }
    [void]$sb.AppendLine("| ``$($s.Class)`` | $($s.Files) | $($s.Lines) | $pct% | $d |")
}
[void]$sb.AppendLine()
$portLines = ($summary | Where-Object { $_.Class -like 'PORT-*' -or $_.Class -eq 'SPLIT-PHYSICS-UI' } | Measure-Object Lines -Sum).Sum
$dropLines = ($summary | Where-Object { $_.Class -eq 'DROP' } | Measure-Object Lines -Sum).Sum
$rwLines   = ($summary | Where-Object { $_.Class -in @('REWRITE','REVIEW') } | Measure-Object Lines -Sum).Sum
[void]$sb.AppendLine('### 与重写方案估算的对照')
[void]$sb.AppendLine()
[void]$sb.AppendLine('| 类别 | 本审计实测行数 | 重写方案估算 |')
[void]$sb.AppendLine('|---|---:|---:|')
[void]$sb.AppendLine("| 需要移植（PORT-* + 物理部分） | $portLines | 15,000–18,000 |")
[void]$sb.AppendLine("| 丢弃（DROP） | $dropLines | ~35,000 |")
[void]$sb.AppendLine("| 需换机制重写或人工判断 | $rwLines | — |")
[void]$sb.AppendLine()
[void]$sb.AppendLine('> 注意：`PORT-PHYSICS` 与 `SPLIT-PHYSICS-UI` 里仍然混着大量编辑器/提示代码，')
[void]$sb.AppendLine('> 实际需要移植的物理可能只有其中一半左右。真正的切割线要在 R1 里逐文件确定。')
[void]$sb.AppendLine()
[void]$sb.AppendLine('## 3. 需要立刻注意的文件（物理与渲染耦合）')
[void]$sb.AppendLine()
$split = $rows | Where-Object { $_.Class -eq 'SPLIT-PHYSICS-UI' } | Sort-Object Lines -Descending
[void]$sb.AppendLine("共 **$($split.Count)** 个文件同时包含物理计算与渲染代码，共 $(($split | Measure-Object Lines -Sum).Sum) 行。")
[void]$sb.AppendLine()
[void]$sb.AppendLine('| 行数 | 文件 |')
[void]$sb.AppendLine('|---:|---|')
foreach($r in ($split | Select-Object -First 40)){ [void]$sb.AppendLine("| $($r.Lines) | ``$($r.Path)`` |") }
[void]$sb.AppendLine()
[void]$sb.AppendLine('## 4. 逐文件清单')
[void]$sb.AppendLine()
[void]$sb.AppendLine('| 分类 | 行数 | 文件 |')
[void]$sb.AppendLine('|---|---:|---|')
foreach($r in ($rows | Sort-Object Class, @{Expression='Lines';Descending=$true})){
    [void]$sb.AppendLine("| ``$($r.Class)`` | $($r.Lines) | ``$($r.Path)`` |")
}

$sb.ToString() | Set-Content $OutFile -Encoding UTF8
Write-Host "wrote $OutFile"
$summary | Format-Table -AutoSize
Write-Host "needs-port lines : $portLines"
Write-Host "drop lines       : $dropLines"
Write-Host "rewrite/review   : $rwLines"
Write-Host "physics+UI mixed : $($split.Count) files"
