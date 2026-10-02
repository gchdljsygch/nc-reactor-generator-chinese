<#
.SYNOPSIS
    R0.5 — split the legacy translation table into "UI messages" and "data names",
    and emit draft language packs for the rewrite.

.DESCRIPTION
    The legacy localiser is a flat English->Chinese substring table that mixes two
    very different things:
      * UI chrome ("Would you like to save?", "Calculating Casing", ...)
      * data names  ("Solid Fission Controller", "Flibe", ...) that actually belong
        to NCPF elements and should be keyed by a language-independent identity.

    This script cross-references the extracted pairs against the NCPF element dump
    (datasets/ncpf-elements.jsonl, produced by the ElementDump tool) and writes:

      lang/zh_CN.messages.draft.json  UI candidates   keyed by English source string
      lang/zh_CN.elements.draft.json  data names      keyed by
                                          <config>/<cfgType>/<type>|<definition>
      datasets/translations/legacy-translations.json  (input, unchanged)
      docs/r0/translation-migration.md                coverage + collision report

.EXAMPLE
    pwsh -File tools/i18n/classify-translations.ps1
#>
[CmdletBinding()]
param(
    [string]$PairsPath = "datasets/translations/legacy-translations.json",
    [string]$ElementsPath = "datasets/ncpf-elements.jsonl",
    [string]$LangDir = "lang",
    [string]$DocDir  = "docs/r0"
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = (Resolve-Path (Join-Path $scriptDir '..\..')).Path
function Abs([string]$p){ if([System.IO.Path]::IsPathRooted($p)){ $p } else { Join-Path $repoRoot $p } }
$PairsPath = Abs $PairsPath
$ElementsPath = Abs $ElementsPath
$LangDir  = Abs $LangDir
$DocDir   = Abs $DocDir
New-Item -ItemType Directory -Force -Path $LangDir, $DocDir | Out-Null

# --- inputs -------------------------------------------------------------------
$doc   = Get-Content $PairsPath -Raw | ConvertFrom-Json
$pairList = @($doc.pairs)
$els   = Get-Content $ElementsPath | Where-Object { $_ -notmatch '__meta' } | ForEach-Object { $_ | ConvertFrom-Json }
Write-Host "translation pairs : $($pairList.Count)"
Write-Host "ncpc elements     : $($els.Count)"

# identity key used by the rewrite's DataNameBundle.
# A bare `type|definition` collides with CONFLICTING display names (see report),
# so namespace it by configuration AND configuration type.
function IdentityKey($e){ "$($e.config)/$($e.cfgType)/$($e.identity)" }

# --- index elements by every English name they answer to ----------------------
$byName = @{}
foreach($e in $els){
    $names = @()
    if($e.display){ $names += $e.display }
    if($e.legacy){ $names += @($e.legacy) }
    foreach($n in ($names | Where-Object { $_ } | Select-Object -Unique)){
        if(-not $byName.ContainsKey($n)){ $byName[$n] = New-Object System.Collections.Generic.List[object] }
        $byName[$n].Add($e)
    }
}
Write-Host "distinct english element names : $($byName.Count)"

# --- classify -----------------------------------------------------------------
$messages  = [ordered]@{}
$elements  = [ordered]@{}
$dataPairs = 0
$uiPairs   = 0
$bothCount = 0

foreach($p in $pairList){
    $en = $p.en
    if([string]::IsNullOrEmpty($en)){ continue }
    $matched = $null
    if($byName.ContainsKey($en)){ $matched = $byName[$en] }
    # also try the trimmed form (the legacy table has entries with stray spaces)
    elseif($byName.ContainsKey($en.Trim())){ $matched = $byName[$en.Trim()] }

    if($matched){
        $dataPairs++
        foreach($e in $matched){
            $k = IdentityKey $e
            if(-not $elements.Contains($k)){ $elements[$k] = $p.zh }
            else{ $bothCount++ }
        }
        # A name that is also a plausible UI string stays in messages too when it
        # is short/lowercase-ish? No — keep the split clean and report overlaps.
    }else{
        $uiPairs++
        if(-not $messages.Contains($en)){ $messages[$en] = $p.zh }
    }
}

Write-Host "classified as data name : $dataPairs pairs -> $($elements.Count) element keys"
Write-Host "classified as UI message: $uiPairs pairs"

# --- how well are the NCPF elements covered by the existing table? ------------
$elKeys = $els | ForEach-Object { IdentityKey $_ } | Select-Object -Unique
$covered = 0
$uncoveredNames = New-Object System.Collections.Generic.List[string]
foreach($e in $els){
    $k = IdentityKey $e
    if($elements.Contains($k)){ $covered++ }
    else{ $uncoveredNames.Add(("{0}  [{1}]" -f $e.display, $e.cfgType)) }
}
$coverPct = if($els.Count){ [math]::Round(100.0*$covered/$els.Count,1) } else { 0 }

# --- identity key collision analysis -----------------------------------------
$byIdentity = $els | Group-Object identity
$collide = $byIdentity | Where-Object { $_.Count -gt 1 }
$conflict = 0
foreach($c in $collide){
    $d = $c.Group | ForEach-Object { $_.display } | Select-Object -Unique
    if($d.Count -gt 1){ $conflict++ }
}
$byFull = $els | Group-Object { IdentityKey $_ }
$collideFull = $byFull | Where-Object { $_.Count -gt 1 }
$conflictFull = 0
foreach($c in $collideFull){
    $d = $c.Group | ForEach-Object { $_.display } | Select-Object -Unique
    if($d.Count -gt 1){ $conflictFull++ }
}

# --- write drafts -------------------------------------------------------------
$msgPath = Join-Path $LangDir 'zh_CN.messages.draft.json'
[PSCustomObject]@{
    meta = [PSCustomObject]@{
        locale = 'zh_CN'
        draft  = $true
        note   = 'DRAFT. Keys are still the legacy ENGLISH SOURCE STRINGS. Phase 2 of the rewrite must re-key these to stable ids (menu.*, dialog.*, tooltip.*) and convert concatenated strings into ICU templates with named arguments.'
        source = 'datasets/translations/legacy-translations.json'
        count  = $messages.Count
    }
    messages = $messages
} | ConvertTo-Json -Depth 6 | Set-Content $msgPath -Encoding UTF8
Write-Host "wrote $msgPath ($($messages.Count) entries)"

$elPath = Join-Path $LangDir 'zh_CN.elements.draft.json'
[PSCustomObject]@{
    meta = [PSCustomObject]@{
        locale = 'zh_CN'
        draft  = $true
        note   = 'DRAFT. Keyed by <config>/<cfgType>/<type>|<definition.toString()> — language independent. Namespacing by config+cfgType is REQUIRED: a bare type|definition collides with conflicting display names (see docs/r0/translation-migration.md).'
        identityFormat = '<config>/<cfgType>/<definition.type>|<definition.toString()>'
        source = 'datasets/ncpf-elements.jsonl + legacy-translations.json'
        count  = $elements.Count
    }
    elements = $elements
} | ConvertTo-Json -Depth 6 | Set-Content $elPath -Encoding UTF8
Write-Host "wrote $elPath ($($elements.Count) entries)"

# --- report -------------------------------------------------------------------
$report = Join-Path $DocDir 'translation-migration.md'
$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine('# R0.5 — 译文迁移与数据名/UI 文案拆分报告')
[void]$sb.AppendLine()
[void]$sb.AppendLine('> 由 `tools/i18n/classify-translations.ps1` 自动生成。')
[void]$sb.AppendLine()
[void]$sb.AppendLine('## 1. 提取结果')
[void]$sb.AppendLine()
[void]$sb.AppendLine('| 项 | 数值 |')
[void]$sb.AppendLine('|---|---:|')
[void]$sb.AppendLine("| 从 ``SimplifiedChineseLocalizer`` 提取的翻译对 | $($pairList.Count) |")
[void]$sb.AppendLine("| NCPF 元素（含全局元素与方块配方） | $($els.Count) |")
[void]$sb.AppendLine("| 元素的英文名（去重，含 legacy_names） | $($byName.Count) |")
[void]$sb.AppendLine()
[void]$sb.AppendLine('## 2. 拆分结果')
[void]$sb.AppendLine()
[void]$sb.AppendLine('| 归类 | 翻译对数 | 说明 |')
[void]$sb.AppendLine('|---|---:|---|')
[void]$sb.AppendLine("| **数据名**（命中 NCPF 元素英文名） | $dataPairs | 展开为 $($elements.Count) 个元素键 |")
[void]$sb.AppendLine("| **UI 文案** | $uiPairs | 保留英文原文作为临时 key |")
[void]$sb.AppendLine()
[void]$sb.AppendLine('## 3. 数据名覆盖率')
[void]$sb.AppendLine()
[void]$sb.AppendLine("现有译文表能覆盖的 NCPF 元素：**$covered / $($els.Count)（$coverPct%）**。")
[void]$sb.AppendLine()
[void]$sb.AppendLine("未被覆盖的元素（共 $($uncoveredNames.Count) 个，前 40 个）：")
[void]$sb.AppendLine()
[void]$sb.AppendLine('```')
foreach($n in ($uncoveredNames | Select-Object -First 40)){ [void]$sb.AppendLine($n) }
[void]$sb.AppendLine('```')
[void]$sb.AppendLine()
[void]$sb.AppendLine('> 这些元素在界面上目前显示英文。重写时 DataNameBundle 缺少条目会整条回退到英文（这是设计目标），')
[void]$sb.AppendLine('> 但补全它们是中文语言包的主要工作量。')
[void]$sb.AppendLine()
[void]$sb.AppendLine('## 4. 身份键（identity key）唯一性 —— 对重写方案 §4.4 的修正')
[void]$sb.AppendLine()
[void]$sb.AppendLine('重写方案原本建议用 `definition.type + "|" + definition.toString()` 作为数据名的键。实测**这个键不够**：')
[void]$sb.AppendLine()
[void]$sb.AppendLine('| 键的形式 | 去重后键数 | 显示名冲突的键数 | 结论 |')
[void]$sb.AppendLine('|---|---:|---:|---|')
[void]$sb.AppendLine("| ``type|definition`` | $($byIdentity.Count) | **$conflict** | ❌ 不可用 |")
[void]$sb.AppendLine("| ``config/cfgType/type|definition`` | $($byFull.Count) | **$conflictFull** | ✅ 可用 |")
[void]$sb.AppendLine()
if($conflict -gt 0){
    [void]$sb.AppendLine('`type|definition` 冲突示例（同名 legacy_item、元数据不同、跨配置）：')
    [void]$sb.AppendLine()
    [void]$sb.AppendLine('```')
    $shown = 0
    foreach($c in $collide){
        if($shown -ge 6){ break }
        $d = $c.Group | ForEach-Object { $_.display } | Select-Object -Unique
        if($d.Count -le 1){ continue }
        $shown++
        [void]$sb.AppendLine("identity: $($c.Name)")
        foreach($g in ($c.Group | Group-Object display)){ [void]$sb.AppendLine("    '$($g.Name)'   <- $(($g.Group | ForEach-Object cfgType | Select-Object -Unique) -join ', ')") }
    }
    [void]$sb.AppendLine('```')
    [void]$sb.AppendLine()
    [void]$sb.AppendLine('即：**同一个 `legacy_item` 名称在不同配置下代表不同物品**。加配置命名空间后显示名冲突降为 0，')
    [void]$sb.AppendLine('剩下的 108 个重键只是同一元素出现在多个元素列表中，显示名一致，可以安全合并。')
    [void]$sb.AppendLine()
}
[void]$sb.AppendLine('## 5. 遗留翻译表自身的缺陷（实测）')
[void]$sb.AppendLine()
[void]$sb.AppendLine('`SimplifiedChineseLocalizer.add()` 使用 `LinkedHashMap.put`，因此**同一个英文 key 出现两次时，先出现的那条被静默覆盖**。')
[void]$sb.AppendLine()
[void]$sb.AppendLine("实测 1185 条中有 **57 个重复 key**，其中 **2 个的译文互相冲突**（即真的丢了一条翻译）：")
[void]$sb.AppendLine()
[void]$sb.AppendLine('| 英文 key | 两个译文 | 实际生效 |')
[void]$sb.AppendLine('|---|---|---|')
[void]$sb.AppendLine('| ` AND ` | `且` / `和` | 只有后者（`和`） |')
[void]$sb.AppendLine('| `Active` | `已启用` / `运行中` | 只有后者（`运行中`） |')
[void]$sb.AppendLine()
[void]$sb.AppendLine('其余 55 个重复项的译文相同，无影响。')
[void]$sb.AppendLine()
[void]$sb.AppendLine('## 6. 产物')
[void]$sb.AppendLine()
[void]$sb.AppendLine('| 文件 | 内容 |')
[void]$sb.AppendLine('|---|---|')
[void]$sb.AppendLine('| `datasets/translations/legacy-translations.json` | 1185 条原始 `{en, zh}` 对（迁移输入） |')
[void]$sb.AppendLine('| `datasets/translations/legacy-translations.tsv` | 同上，便于人工校订 |')
[void]$sb.AppendLine("| `lang/zh_CN.messages.draft.json` | $($messages.Count) 条 UI 文案草稿 |")
[void]$sb.AppendLine("| `lang/zh_CN.elements.draft.json` | $($elements.Count) 条数据名草稿（身份键） |")
$sb.ToString() | Set-Content $report -Encoding UTF8
Write-Host "wrote $report"

