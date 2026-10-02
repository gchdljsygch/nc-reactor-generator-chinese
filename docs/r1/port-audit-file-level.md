# R1.0d — 文件级移植量复核（file-level port audit）

> 对应 `docs/rewrite-plan-r1-r5.md` §4.1 任务 **R1.0d**、风险 **R-8**、§1.3 空白「迁移到 TS 的行数只有粗估 → 排期有 ±30% 不确定性」。
>
> 这份文档把 `docs/r0/port-audit.md` 的**包级规则分类**落到**逐文件**，并给出修正后的 R1 工期。
> 所有数字都可以用 `tools/ts/port-audit.mjs` 重新生成；本文每个表格都标注了它来自哪条命令。
>
> 本文**只读** `src/**`（Java 产品代码），不修改任何 Java 文件。
>
> **2026-10 快照刷新（`docs/java-exit-plan.md` §P0）**：中文化冻结提交 `4fad557f` 之后，
> `OverhaulMSR.java`（2,117 → 2,126）与 `OverhaulSFR.java`（1,878 → 1,884）各增加了几行，
> 总量因此从 **831 / 77,825 行** 变为 **831 / 77,840 行**，`contentSha256` 从 `e6b2f520…` 变为 `7e36b9a5…`。
> 本文已按新快照更新；R0 自己的公布值（831 / 77,825）是 R0 时点的历史测量，保持不变。
> **实测值一律以 `docs/r1/port-audit-file-level.json` 的 `contentSha256` 为准**，并由
> `tools/ts/port-audit.mjs` 内置的 `EXPECTED_SHA` 在 CI 里断言（见 §7）。

---

## 0. 摘要（先看这里）

| 结论 | 数值 / 说明 |
|---|---|
| 复核方法 | 逐文件（831 个）重新分类，规则与计数全部脚本化、可复现、确定性 |
| 行数核对 | 脚本的 R0 兼容行数指标与 R0 表格逐文件比对：**829 / 831 一致**，2 处不一致（`OverhaulMSR.java` +9、`OverhaulSFR.java` +6，来自中文化冻结提交 `4fad557f`）；本次实测合计 **831 文件 / 77,840 行** |
| **必须实现（must-build）行数** | **431 文件 / 38,560 行（R0 指标）= 38,026 行（非空非注释）** |
| R1 范围内的 must-build | 280 文件 / 25,822 行（R0 指标）= **25,365 行（非空非注释）** |
| 与 R0 包级数字比 | R0 的「需要移植」是 33,973 行 → 文件级实测 **+4,587 行（+13.5%）** |
| 与重写方案估算比 | 方案估「需要移植 15,000–18,000 行」→ 实测 must-build 38,026 行 = **2.1–2.5×** |
| R0 finding #8（9 文件 / 7,214 行「物理+渲染同居」）| **只有 4 文件 / 1,319 行成立**；另外 5 文件 / 5,910 行只是 `getTexture(...)` 访问器误报 |
| **R1 工期结论** | **5–7 周不成立。** 方案自身 §4.1–4.7 的子任务预算之和就是 34.5–54 人日 = **6.9–10.8 周**；按文件级实测行数复核同样落在 **7–10 周**。建议把 R1 改写为 **8–10 周（逐项预算 44.5 人日 ≈ 8.9 周）**；若按 §5.4 砍掉 Fusion/Distiller 则可回到 **7 周**。M1 闸门不变 |
| 输出哈希 | `contentSha256 = 7e36b9a5c7c9de15382259418b0941b8ae6cffb47c543946889c9f788beda6a4`（脚本内置 `EXPECTED_SHA`，不符即 CI 失败） |

---

## 1. 怎么复现每一个数字

```bash
# ① 人类可读汇总（本文 §2、§3、§4、§5 的绝大多数数字来自它）
node tools/ts/port-audit.mjs --summary

# ② 机器可读全量结果（本文未逐行展开的 831 行明细在这里）
node tools/ts/port-audit.mjs --json docs/r1/port-audit-file-level.json

# ③ 完整报告：含 bucket×relevance 全矩阵、包组表、目录级 R0 对照、
#    R0 分类转移矩阵、finding #8 逐文件复核表、逐文件清单
node tools/ts/port-audit.mjs --report
```

其它开关：`--src <dir>`（默认 `src`）、`--r0 <file>`（默认 `docs/r0/port-audit.md`）、`--no-r0`（跳过 R0 对照）。

**哈希**：脚本先算规范化 JSON（固定键序、无时间戳、无绝对路径）的 sha256，再把它写进结果的 `contentSha256`。
本次为：

```
contentSha256=7e36b9a5c7c9de15382259418b0941b8ae6cffb47c543946889c9f788beda6a4
```

连续两次运行的哈希相同（已验证）。任何分类规则、行数或文件集合的变化都会改变它。
`tools/ts/port-audit.mjs` 里内置了 `EXPECTED_SHA` 常量（当前值同上）：`--summary` / `--report` 在打印前
会比对哈希，**不符即 `exit 1`** 并列出漂移的文件，所以 CI 里不再需要人工看数字——
这就是 P0 之前缺失的那道门禁（此前 CI 只 `--summary` 打印，+15 行漂移静默通过）。
`--json` 是有意不加门禁的：刷新快照的流程是 `--json` → 更新 `EXPECTED_SHA` → 更新本文与 `docs/r0/port-audit.md` 的总数。

**JSON 工件**：`docs/r1/port-audit-file-level.json`（485 KB，831 条 per-file 记录，含每文件的 `bucket / reason / tag / scope / rawLines / codeLines / flags / seam / tokens / r0Class / r0Lines`）。
它是本文的完整数据源，保留在仓库里；文件名与哈希都记录在本节，便于回溯。

### 1.1 计数规则（简单但站得住脚）

| 指标 | 规则 | 用途 |
|---|---|---|
| `rawLines` | 按 `/\r?\n/` 切分后 `length > 0` 的行数 | 等价 R0.6 使用的 `Get-Content f \| Measure-Object -Line`，使两份审计**同指标可比**。本次实测 `src/**/*.java` 合计 77,840（R0 公布值 77,825；差额 +15 来自中文化冻结提交对 2 个文件的改动）。只含空白的行（如 `"   "`）计入 |
| `codeLines` | 把注释与字符串/字符字面量**替换成空格后**，仍有非空白字符的行数 | 更严格的「代码行」。处理 `//`、`/* */`、`"..."`、`'...'`、`"""..."""`，由字符扫描器保证 `"// 不是注释"` 是代码、`/* "不是字符串" */` 是注释；保留换行，行号与行数不变 |

本次实测总量：`rawLines = 77,840`，`codeLines = 76,579`（差 1,261 行 = 纯注释行 + 只有空白的行）。
`codeLines` 永远 ≤ `rawLines`；两者都给出，是为了与 R0（只给 raw 口径）对齐，同时不让结论依赖注释密度。

### 1.2 分类规则

每个文件**只落一个** bucket，按下列顺序**首个命中即采纳**；命中原因会写进 JSON 的 `reason` 字段，并在 `--report` 的逐文件表里可见。

| bucket | 定义 | 命中规则（顺序） |
|---|---|---|
| `VERIFY` | **必须重新推导语义，不能逐行翻译**（冻结版已知 bug、恢复策略） | 6 个显式路径（见 §1.3） |
| `DROP` | 新栈取代、不移植 | 12 个目录前缀 + 7 个显式文件（§1.4） |
| `REWRITE` | **必须存在，但机制不同** | `planner/module/`（反射注册）、`multiblock/overhaul|underhaul/`（编辑器侧重复模拟器）、`multiblock/generator/lite/*/{Lite*|Compiled*}*`（生成器侧重复模拟器）、`planner/ncpf/module/**` 中带 `@RegisterWith` 的类（120 个手写模块类 → 声明式 schema） |
| `PORT` | 语义可 1:1 翻译的逻辑 | 其余全部。没有命中任何显式规则的文件也落这里，`reason = default:logic-port`（本次 **302 / 310** 个 PORT 文件走这条兜底；另外 8 个是 `planner/ncpf/module/**` 的模块基类/基础设施）。没有任何文件落到预料之外的分支 |

### 1.3 `VERIFY`（6 文件 / 837 行 / 832 代码行）

| 文件 | 行数 | 依据 |
|---|---:|---|
| `planner/file/writer/HellrageWriter.java` | 257 | R0 §8.6：把**显示名**当标识符 |
| `ncpf/element/NCPFSettingsElement.java` | 234 | R0 发现 9：`matches()` 不自反（`NCPFSettingsElement.java:186-210` 的 `Set` 分支） |
| `planner/file/recovery/RecoveryModeHandler.java` | 234 | R0 §12.3：按名字恢复方块（真实文件报 `Invalid block name: Cf-252!`）；且 import 了 GUI 对话框 |
| `planner/file/reader/LegacyNCPF1Reader.java` | 43 | R0 §12.2：读真实 v1 文件 NPE |
| `planner/file/recovery/NonRecoveryHandler.java` | 42 | 恢复策略是策略而非逻辑，新栈没有 GL 崩溃模式 |
| `planner/file/recovery/RecoveryHandler.java` | 27 | 同上 |

> 这些文件的共同点：**Java 里的行为是错的（或已冻结）**，逐行翻译只会把 bug 带过来。
> R2.10 / R2.4 已经要求「按修复后语义实现」，所以它们在 R1 的口径里是「要靠数据/契约重新推导」。

### 1.4 `DROP`（400 文件 / 39,280 行 / 38,553 代码行）

目录前缀：`graphics/`、`discord/`、`planner/gui/`、`planner/theme/`、`planner/vr/`、`planner/dssl/`、`planner/localization/`、`planner/tutorial/`、`config2/`、`multiblock/configuration/`（TextureManager）、`multiblock/editor/decal/`（17 个 render decal）、`planner/editor/overlay/`。
显式文件：`planner/Updater.java`、`planner/VersionManager.java`、`planner/ImageIO.java`、`planner/FormattedText.java`、`planner/FileChooserResultListener.java`、`planner/file/writer/PNGWriter.java`、`planner/file/ImageFormatWriter.java`。

---

## 2. 总量与分类

### 2.1 总量（`--summary`）

| 项 | 数值 |
|---|---:|
| Java 文件 | 831 |
| `rawLines`（R0 兼容口径） | 77,840 |
| `codeLines`（非空非注释） | 76,579 |
| **must-build（PORT + REWRITE + VERIFY）** | **431 文件 / 38,560 raw / 38,026 code** |

### 2.2 bucket 汇总（`--summary`）

| bucket | 文件 | rawLines | codeLines | 占比(raw) | 占比(code) |
|---|---:|---:|---:|---:|---:|
| `PORT` | 310 | 24,214 | 23,926 | 31.1% | 31.2% |
| `DROP` | 400 | 39,280 | 38,553 | 50.5% | 50.3% |
| `REWRITE` | 115 | 13,509 | 13,268 | 17.4% | 17.3% |
| `VERIFY` | 6 | 837 | 832 | 1.1% | 1.1% |
| 合计 | 831 | 77,840 | 76,579 | 100% | 100% |

> 注意 `DROP` 占比（50.3% code）高于 R0 的 45.3%：文件级复核多丢掉了 config2（1,399）、tutorial（886）、render decal（708）、overlay（45）、TextureManager（104）、桌面更新器（438）、PNG/Image 写出（214）等
> R0 按包规则算进 `PORT-UI-LOGIC` / `REWRITE` / `REVIEW` 的东西。

### 2.3 bucket × reactor-relevance 矩阵（`--report`，文件 / codeLines）

相关性标签按「路径+文件名」启发式判定，顺序：`discord → i18n → ui → turbine → msr → underhaul → distiller → fusion → sfr → ncpf-format → infra → other`（堆型关键词优先于 `ncpf-format`，所以 `planner/ncpf/module/overhaulSFR/*` 记 `sfr` 而不是 `ncpf-format`）。

| bucket | sfr | underhaul | msr | turbine | fusion | distiller | ncpf-format | i18n | ui | infra | discord |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `PORT` | 13 / 978 | 14 / 852 | 9 / 590 | 7 / 385 | 7 / 395 | 7 / 313 | 113 / 10,553 | – | – | 140 / 9,860 | – |
| `DROP` | – | – | – | – | – | – | – | 3 / 1,255 | 202 / 25,975 | 128 / 4,571 | 67 / 6,752 |
| `REWRITE` | 21 / 3,874 | 13 / 1,712 | 18 / 2,847 | 14 / 1,222 | 17 / 1,550 | 14 / 557 | 10 / 270 | – | – | 8 / 1,236 | – |
| `VERIFY` | – | – | – | – | – | – | 6 / 832 | – | – | – | – |

读法：**所有堆型都有 `REWRITE` 成分**（重复模拟器 + 注册模块），`sfr`/`underhaul`/`msr` 的 REWRITE 体量最大——
这就是 R1.5/R1.6 的真实工作量分布，而不是 R0 里 `PORT-PHYSICS 3 文件 / 2,241 行` 的样子。

### 2.4 调度范围（`--summary`，脚本按路径机械划分，用于 §5 的算术）

| scope | 说明 | 文件 | codeLines |
|---|---|---:|---:|
| `r1-model` | `ncpf/**` + `planner/ncpf/**`（R1.3） | 207 | 8,336 |
| `r1-formats-core` | `planner/file/**` 的 NCPF 读写核心（R1.4） | 17 | 1,322 |
| `r1-kernel-sfr` | SFR 模拟器 + 共享几何（R1.5，含 R1.6a 的 underhaul） | 20 | 5,572 |
| `r1-kernel-misc` | MSR / Turbine / Fusion / Distiller 模拟器（R1.6） | 8 | 4,968 |
| `r1-infra` | 应用骨架/工具类/模块注册/多块基类/对称（R1.1、R1.3d、R1.5 共用） | 29 | 5,213 |
| `r2-formats-legacy` | Legacy/Hellrage/NCConfig 读取器、recovery、写出器（R2） | 36 | 6,777 |
| `r3-ui` | 被丢弃、将在 R3 用新栈重写 | 384 | 36,581 |
| `r3-editor-logic` | 编辑器工具/action/对称（R3 复用逻辑） | 40 | 2,462 |
| `r4-generator` | 生成器 mutator/condition/variable/anim + tinkers（R4） | 76 | 3,590 |
| `drop-misc` | 设置、更新器、PNG 等（不移植） | 14 | 1,758 |

### 2.5 包组总量（`--report`「package groups」）

| package | files | rawLines | codeLines |
|---|---:|---:|---:|
| config2 | 12 | 1,399 | 1,367 |
| discord | 67 | 6,907 | 6,752 |
| graphics | 16 | 2,894 | 2,705 |
| multiblock | 14 | 1,987 | 1,949 |
| multiblock/configuration | 3 | 104 | 104 |
| multiblock/editor | 43 | 1,791 | 1,772 |
| multiblock/generator | 76 | 5,091 | 4,977 |
| multiblock/overhaul | 10 | 7,346 | 7,224 |
| multiblock/symmetry | 3 | 106 | 106 |
| multiblock/tinkers | 7 | 758 | 758 |
| multiblock/underhaul | 2 | 822 | 812 |
| ncpf | 56 | 2,992 | 2,940 |
| planner（根） | 15 | 2,827 | 2,666 |
| planner/dssl | 108 | 2,024 | 1,971 |
| planner/editor | 15 | 1,437 | 1,431 |
| planner/exception | 1 | 6 | 6 |
| planner/file | 53 | 8,166 | 8,099 |
| planner/gui | 126 | 14,311 | 14,174 |
| planner/localization | 3 | 1,258 | 1,255 |
| planner/module | 10 | 1,449 | 1,438 |
| planner/ncpf | 151 | 5,399 | 5,396 |
| planner/theme | 13 | 5,107 | 5,098 |
| planner/tutorial | 6 | 886 | 842 |
| planner/vr | 21 | 2,773 | 2,737 |

---

## 3. 与 R0 包级数字的对照

### 3.1 对照方法（先证明两边可比）

脚本**解析 R0 自己的 `docs/r0/port-audit.md` §4 逐文件表**（正则 `^\|\s*`CLASS`\s*\|\s*(\d+)\s*\|\s*`path`\s*\|$`），拿到 831 条 R0 记录，然后：

1. 校验总数：R0 公布 831 文件 / 77,825 行，解析结果 831 / 77,825 ✅（这一列是 R0 时点的历史测量，不受本次快照刷新影响）；
2. **逐文件**比较行数：`per-file line metric matched: 73,830 lines, mismatches=2`（2 处差异即 §0 表里的 `OverhaulMSR.java` +9、`OverhaulSFR.java` +6）；
3. 再按 R1.0d 的 bucket 与 R0 的 class 做目录级/转移级对照。

因此下表中的「行数」一列对两边是**同一个指标**，差异只可能来自分类规则，不来自计数口径。
「must-build」在 R0 侧 = R0 的 `PORT-MODEL + PORT-FORMAT + PORT-UI-LOGIC + PORT-PHYSICS + SPLIT-PHYSICS-UI`（即 R0 自称的「需要移植 33,973 行」）；
在 R1.0d 侧 = `PORT + REWRITE + VERIFY`（因为 `REWRITE` 也必须实现，只是机制不同）。

### 3.2 目录级对照（`--report`，按 |delta| 降序）

| package | files | 行数（同一指标） | R0 需要移植 | R1.0d must-build | delta | R0 分类（行） | R1.0d bucket（行） |
|---|---:|---:|---:|---:|---:|---|---|
| planner（根） | 15 | 2,827 | 0 | 2,177 | **+2,177** | REVIEW:2827 | PORT:2177 DROP:650 |
| planner/module | 10 | 1,449 | 0 | 1,449 | **+1,449** | REWRITE:1449 | REWRITE:1449 |
| multiblock（根） | 14 | 1,987 | 665 | 1,987 | **+1,322** | REWRITE:1322 PORT-UI-LOGIC:665 | PORT:1987 |
| multiblock/editor | 43 | 1,791 | 1,791 | 1,083 | **−708** | PORT-UI-LOGIC:1791 | PORT:1083 DROP:708 |
| multiblock/generator | 76 | 5,091 | 4,650 | 5,091 | +441 | PORT-UI-LOGIC:2888 PORT-PHYSICS:1400 REWRITE:441 SPLIT:362 | PORT:3093 REWRITE:1998 |
| multiblock/overhaul | 10 | 7,346 | 7,083 | 7,346 | **+263** | SPLIT:6030 PORT-PHYSICS:841 REWRITE:248 PORT-UI-LOGIC:212 | REWRITE:7346 |
| planner/file | 53 | 8,166 | 8,166 | 7,952 | −214 | PORT-FORMAT:8166 | PORT:7349 VERIFY:603 DROP:214 |
| multiblock/configuration | 3 | 104 | 104 | 0 | −104 | PORT-UI-LOGIC:104 | DROP:104 |
| planner/editor | 15 | 1,437 | 1,437 | 1,392 | −45 | PORT-UI-LOGIC:1437 | PORT:1392 DROP:45 |
| planner/exception | 1 | 6 | 0 | 6 | +6 | REVIEW:6 | PORT:6 |
| config2 | 12 | 1,399 | 0 | 0 | 0 | REWRITE:1399 | DROP:1399 |
| discord | 67 | 6,907 | 0 | 0 | 0 | DROP:6907 | DROP:6907 |
| graphics | 16 | 2,894 | 0 | 0 | 0 | DROP:2894 | DROP:2894 |
| multiblock/symmetry | 3 | 106 | 106 | 106 | 0 | PORT-UI-LOGIC:106 | PORT:106 |
| multiblock/tinkers | 7 | 758 | 758 | 758 | 0 | PORT-UI-LOGIC:758 | PORT:758 |
| multiblock/underhaul | 2 | 822 | 822 | 822 | 0 | SPLIT:822 | REWRITE:822 |
| ncpf | 56 | 2,992 | 2,992 | 2,992 | 0 | PORT-MODEL:2992 | PORT:2758 VERIFY:234 |
| planner/dssl | 108 | 2,024 | 0 | 0 | 0 | DROP:2024 | DROP:2024 |
| planner/gui | 126 | 14,311 | 0 | 0 | 0 | DROP:14311 | DROP:14311 |
| planner/localization | 3 | 1,258 | 0 | 0 | 0 | DROP:1258 | DROP:1258 |
| planner/ncpf | 151 | 5,399 | 5,399 | 5,399 | 0 | PORT-MODEL:5399 | PORT:3505 REWRITE:1894 |
| planner/theme | 13 | 5,107 | 0 | 0 | 0 | DROP:5107 | DROP:5107 |
| planner/tutorial | 6 | 886 | 0 | 0 | 0 | REWRITE:886 | DROP:886 |
| planner/vr | 21 | 2,773 | 0 | 0 | 0 | DROP:2773 | DROP:2773 |

**合计**：R0 需要移植 33,973 行 → R1.0d must-build **38,560 行**（**+4,587 行，+13.5%**）。

差值来源（可逐项核对 §3.4）：

```
+1,527   REWRITE  -> PORT      (R0 的口径排除 REWRITE，但 Multiblock.java 817 / AbstractBlock 427 等必须实现)
+1,933   REWRITE  -> REWRITE   (planner/module 等，R0 同样排除在工作量外)
+2,183   REVIEW   -> PORT      (planner/ 根的应用骨架与工具类)
-  857   PORT-UI-LOGIC -> DROP (render decal / TextureManager / overlay)
-  214   PORT-FORMAT   -> DROP (PNGWriter / ImageFormatWriter)
+   15   中文化冻结提交 4fad557f (OverhaulMSR +9 / OverhaulSFR +6，都落在 REWRITE)
= +4,587
```

### 3.3 R0 高估与低估的具体例子（按体量）

**R0 低估（包规则把「必须实现」算成了不用管）：**

| 例子 | 行数 | 为什么 R0 低估 |
|---|---:|---|
| `planner/`（根 15 文件） | +2,177 | R0 把整个 `planner/` 兜底成 `REVIEW`（2,827 行），而「需要移植」= `PORT-* + SPLIT`，于是 `Core.java` 883、`Main.java` 545、`MathUtil.java` 220、`Queue.java` 158、`CircularStream.java` 105 等**全部没被计入移植量**。实际只有 650 行该丢（`Updater` 245、`VersionManager` 193、`ImageIO` 76、`FormattedText` 130、`FileChooserResultListener` 6） |
| `planner/module/` | +1,449 | R0 归 `REWRITE`，而 R0 的「需要移植」口径**排除了 REWRITE**。但这 10 个文件（`Module.java` 231、`OverhaulModule.java` 486、`RainbowFactorModule.java` 365…）在 R1.3d 里要显式重写，不可能不算工作量 |
| `multiblock/`（根） | +1,322 | R0 的 `multiblock` 内容启发式只要看到 `render`/`getTexture` 就判 `REWRITE`：`Multiblock.java` 817、`AbstractBlock.java` 427、`SimpleBlock.java` 78 —— 这三个文件的主体是**多块布局/放置规则/边界**逻辑，必须移植，渲染只占少数 |
| `multiblock/generator` | +441 | 同上：R0 的 `REWRITE:441` 里有 205 行只因 `getTexture(...)` 命中渲染正则（`SettingVariable.java` 152、`SettingCondition.java` 53，实际是变量/设置逻辑 → PORT），另 236 行是 `lite/underhaulSFR/CompiledUnderhaulSFRConfiguration.java`（配置编译器 → REWRITE）。而 R0 的「需要移植」口径**排除了 REWRITE**，于是这 441 行全线低估 |

> 另有一类**不是数量、而是性质**的修正：`ncpf/element/NCPFSettingsElement.java` 234 行 +
> `planner/file/recovery/{RecoveryModeHandler,NonRecoveryHandler,RecoveryHandler}.java` 303 行 +
> `planner/file/writer/HellrageWriter.java` 257 行 + `planner/file/reader/LegacyNCPF1Reader.java` 43 行 = **837 行**
> 在 R0 里是「可直译」（`PORT-MODEL` / `PORT-FORMAT`），R1.0d 判为 `VERIFY`。
> 它们**没有改变 must-build 总量**，但改变了「能不能逐行翻译」的答案：这 6 个文件的语义是已知错误的，
> 必须按 R1.4d / R2.4 / R2.10 的修复后语义重新推导。

**R0 高估（包规则把不用移植的算成了要移植）：**

| 例子 | 行数 | 为什么 R0 高估 |
|---|---:|---|
| `multiblock/editor/decal/`（17 文件） | −708 | R0 整包按 `PORT-UI-LOGIC` 计入需要移植；这些 decal 的 `draw*`/`Renderer` 调用是**纯渲染叠加**，每个文件 24–72 行，新栈里由 R3 的视图重画，属 `DROP` |
| `planner/file` 的 PNG/Image 写出 | −214 | `PNGWriter.java` 168 + `ImageFormatWriter.java` 46：`java.awt` 图像导出，R2.12 明确在浏览器侧重做 |
| `multiblock/configuration/`（3 文件，含 `TextureManager.java` 95） | −104 | 纹理加载与小接口，`DROP` |
| `planner/editor/overlay/EditorOverlay.java` | −45 | 编辑器渲染叠加，`DROP` |
| `config2/`（12 文件 1,399 行）| 0（但分类从 REWRITE → DROP） | 从「必须实现」变「不实现、只做一次性迁移（R2.11）」，等于把 1,399 行从 R1/R3 预算里拿掉 |
| `planner/tutorial/`（6 文件 886 行） | 0（同上） | 教程引擎不移植，R3 用新栈写，886 行不进入工作量 |

### 3.4 R0 class → R1.0d bucket 转移矩阵（`--report`，节选最大项）

| R0 class | R1.0d bucket | 文件 | 行数 | codeLines |
|---|---|---:|---:|---:|
| DROP | DROP | 354 | 35,274 | 34,692 |
| PORT-FORMAT | PORT | 46 | 7,349 | 7,287 |
| SPLIT-PHYSICS-UI | REWRITE | 9 | 7,214 | 7,117 |
| PORT-UI-LOGIC | PORT | 131 | 6,892 | 6,861 |
| PORT-MODEL | PORT | 117 | 6,263 | 6,208 |
| REWRITE | DROP | 18 | 2,285 | 2,209 |
| PORT-PHYSICS | REWRITE | 3 | 2,241 | 2,123 |
| REVIEW | PORT | 11 | 2,183 | 2,079 |
| REWRITE | REWRITE | 13 | 1,933 | 1,922 |
| PORT-MODEL | REWRITE | 89 | 1,894 | 1,894 |
| REWRITE | PORT | 5 | 1,527 | 1,491 |
| PORT-UI-LOGIC | DROP | 21 | 857 | 845 |
| REVIEW | DROP | 5 | 650 | 593 |
| PORT-FORMAT | VERIFY | 5 | 603 | 598 |
| PORT-MODEL | VERIFY | 1 | 234 | 234 |
| PORT-FORMAT | DROP | 2 | 214 | 214 |
| PORT-UI-LOGIC | REWRITE | 1 | 212 | 212 |

> `PORT-MODEL → REWRITE` 的 89 个文件就是 §3.5 的手写模块类；`REWRITE → PORT` 的 5 个文件是
> `Multiblock.java` 817、`AbstractBlock.java` 427、`SettingVariable.java` 152、`SimpleBlock.java` 78、`SettingCondition.java` 53。

### 3.5 顺手核对 R1.3c 的「120 个手写模块类」

脚本统计带 `@RegisterWith`（反射注解注册）的文件：

| 位置 | 文件数 |
|---|---:|
| `planner/ncpf/**` | 102 |
| `ncpf/**` | 20 |
| `multiblock/generator/**`（生成器注册对象，不是模块类） | 31 |
| `multiblock/overhaul|underhaul|tinkers/**` | 7 |
| **合计** | **160** |
| 其中**模型树**（`ncpf/**` + `planner/ncpf/**`） | **122** |

结论：R1.3c 说的「120 个手写模块类」与实测 122 个**吻合**（差异是 2 个文件的口径问题，不影响结论）。
其中 `planner/ncpf/module/**` 里 97 个文件中有 89 个带 `@RegisterWith`（其余 8 个是基类/基础设施，判 `PORT`）。
附注：R1.3c 说「消除 205 个样板 `convertTo/FromObject`」，用正则 `public (void|boolean|Object|int|float|double|String) convert(To|From)`
实测模型树为 163 条声明（`planner/ncpf` 112 + `ncpf` 51）；205 这个数用同一条规则**复现不出来**，引用时应改写为「约 160–200 条样板方法」或重新定义统计口径。

---

## 4. R0 finding #8 复核：9 文件 / 7,214 行的「物理+渲染同居」

R0 §7（`docs/r0/findings.md:368-379`）称「共 9 文件 / 7,214 行同时含物理计算与 `Renderer`/`draw` 调用，
没有安全切口能把物理单独摘出来加测试」。脚本用 **R0 自己的两个正则**复现出这 9 个文件
（`R0_PHYS = neutronFlux|totalHeat|totalOutput|totalEfficiency|calculateStats|propogate|heatMult|moderatorLines|cluster`、
`R0_RENDER = Renderer|render2d|render3d|void draw\(|getTexture|drawText`），行数 7,229（R0 记为 7,214；差额 +15
来自中文化冻结提交 `4fad557f`），然后逐文件数了真实渲染调用的 token：

| 文件 | rawLines | codeLines | `Renderer` 类型 | `renderer.` | `drawX(` | `glX(` | `getTexture(` | 真的有渲染? | bucket |
|---|---:|---:|---:|---:|---:|---:|---:|:--:|---|
| `multiblock/overhaul/fissionmsr/OverhaulMSR.java` | 2,126 | 2,089 | 0 | 0 | 0 | 0 | 5 | **NO** | REWRITE |
| `multiblock/overhaul/fissionsfr/OverhaulSFR.java` | 1,884 | 1,856 | 0 | 0 | 0 | 0 | 5 | **NO** | REWRITE |
| `multiblock/overhaul/turbine/OverhaulTurbine.java` | 877 | 862 | 0 | 0 | 0 | 0 | 1 | **NO** | REWRITE |
| `multiblock/underhaul/fissionsfr/UnderhaulSFR.java` | 661 | 654 | 0 | 0 | 0 | 0 | 6 | **NO** | REWRITE |
| `multiblock/overhaul/fissionmsr/Block.java` | 442 | 434 | 2 | 4 | 5 | 0 | 0 | yes | REWRITE |
| `multiblock/overhaul/fissionsfr/Block.java` | 407 | 400 | 2 | 4 | 5 | 0 | 0 | yes | REWRITE |
| `multiblock/generator/lite/overhaulSFR/CompiledOverhaulSFRConfiguration.java` | 362 | 361 | 0 | 0 | 0 | 0 | 1 | **NO** | REWRITE |
| `multiblock/overhaul/fusion/Block.java` | 309 | 303 | 2 | 4 | 4 | 0 | 0 | yes | REWRITE |
| `multiblock/underhaul/fissionsfr/Block.java` | 161 | 158 | 2 | 0 | 2 | 0 | 0 | yes | REWRITE |

| 分组 | 文件 | rawLines | codeLines |
|---|---:|---:|---:|
| 9 文件总计（R0 的 SPLIT 桶） | 9 | 7,229 | 7,117 |
| **真的物理+渲染**（有 `draw*`/`renderer.` 调用） | **4** | **1,319** | **1,295** |
| 只被 `getTexture(...)` 命中的误报 | **5** | **5,910** | **5,822** |

**结论（这是对 R0 finding #8 的实质性修正）：**

1. `getTexture(...)` 是**元素纹理访问器**（`recipe.texture.texture = TextureManager.getImage(...)` 那条数据链），不是渲染调用。
   把它放进「渲染」正则，导致 4 个大反应堆（`OverhaulMSR` 2,126、`OverhaulSFR` 1,884、`OverhaulTurbine` 877、`UnderhaulSFR` 661）
   和 `CompiledOverhaulSFRConfiguration` 362 被误判为「物理与渲染同居」，共 **5 文件 / 5,910 行**。
2. 真正同居的是 **4 个 `Block.java`**（fissionmsr 442、fissionsfr 407、fusion 309、underhaul 161），
   共 **1,319 行 / 1,295 代码行**——它们确实有 `Renderer renderer` 参数、`renderer.setColor/drawPrimaryCubeOutline` 这一类调用。
3. 因此「没有安全切口」这句话**对这 4 个大反应堆不成立**：它们是纯物理文件，物理**可以**单独摘出来加测试；
   真正需要先拆的是那 4 个 `Block.java`（方块定义 + 模块装配 + 渲染叠加混在一起）。
   这把「必须先拆再移植」的成本从 7,214 行降到 **1,319 行（−82%）**。
4. 用 R1.0d 的严格渲染信号（`renderer.` / `drawX(` / `glX(` / `GL_` / `drawText`）在全仓库重扫，
   `physics + render` 的文件**正好就是这 4 个 `Block.java`**，没有第 5 个。

### 4.1 拆分工作的可见性（seam 估算）

脚本对每个方法体做法（brace matching）并按内容信号（`phys` / `ui` / `both` / `other`）把每一行代码归到最内层方法，
得到「物理/UI 接缝」的**机械估算**（`seam.phys + seam.ui + seam.both + seam.other == codeLines` 恒等）：

| 文件 | codeLines | seam phys | seam both | seam ui | seam other |
|---|---:|---:|---:|---:|---:|
| `overhaul/fissionmsr/Block.java` | 434 | 126 | 0 | 54 | 254 |
| `overhaul/fissionsfr/Block.java` | 400 | 109 | 0 | 54 | 237 |
| `overhaul/fusion/Block.java` | 303 | 75 | 0 | 48 | 180 |
| `underhaul/fissionsfr/Block.java` | 158 | 41 | 0 | 8 | 109 |

> 「other」= 构造器/字段/没有物理关键词的辅助方法。这是**信号估算**，不是真正的拆分结果，
> 只用来说明「需要人工切的边界在哪、量级多大」。真正切割线仍要在 R1.5 逐方法确定。

### 4.2 模拟器文件的物理占比（16 文件 / 9,936 代码行）

| 堆型 | 文件 | codeLines | seam phys | seam ui | seam other |
|---|---:|---:|---:|---:|---:|
| sfr | 4 | 3,505 | 1,896 | 54 | 1,555 |
| underhaul | 4 | 1,463 | 268 | 8 | 1,187 |
| msr | 2 | 2,523 | 1,426 | 54 | 1,043 |
| turbine | 2 | 985 | 265 | 8 | 712 |
| fusion | 2 | 1,123 | 289 | 48 | 786 |
| distiller | 2 | 337 | 0 | 5 | 332 |
| 合计 | 16 | 9,936 | 4,144 | 177 | 5,615 |

读法：重复模拟器的 9,936 行里，**约 4,144 行（42%）落在有物理关键词的方法体里**，
其余是模块装配/访问器/样板（`other`）。所以「必须重写为单一内核」的真实物理面 ≈ 4,000–4,500 行，
而这个内核要同时替代两份实现（编辑器侧 + 生成器侧）。

---

## 5. R1 工期修正（本次审计的主要交付）

### 5.1 实测 must-port 行数

| 口径 | 文件 | 行数 |
|---|---:|---:|
| 全仓库 must-build（`PORT+REWRITE+VERIFY`） | 431 | **38,560**（R0 指标）/ **38,026**（非空非注释） |
| 其中 R1 范围（`r1-model + r1-formats-core + r1-kernel-sfr + r1-kernel-misc + r1-infra`） | 280 | **25,822** / **25,365** |
| 对照：R0 包级「需要移植」 | — | 33,973 |
| 对照：重写方案估算「需要移植」 | — | 15,000–18,000 |

R1 范围的 25,365 行按 scope 拆开（`--summary`）：

```
r1-model          8,336   (ncpf/** + planner/ncpf/**)
r1-formats-core   1,322   (planner/file/** NCPF 读写核心)
r1-kernel-sfr     5,572   (SFR 模拟器 + 共享几何 + underhaul)
r1-kernel-misc    4,968   (MSR / Turbine / Fusion / Distiller)
r1-infra          5,213   (Core/Main/工具类/模块注册/多块基类/对称)
------------------------
合计             25,365   codeLines   (25,822 rawLines)
```

> `r2-formats-legacy`（6,777）、`r3-ui`（36,581）、`r3-editor-logic`（2,462）、`r4-generator`（3,590）、`drop-misc`（1,758）
> 不计入 R1。注意 R1.4 只需要 NCPF 读写（`r1-formats-core` 1,322 行），**历史格式读取器 6,777 行属于 R2**，这一点方案是对的。

### 5.2 算术一：方案自身的子任务预算之和

按 `docs/rewrite-plan-r1-r5.md` §4.1–4.7 的字面预算（1 周 = 5 人日）：

| 任务 | 方案预算 |
|---|---|
| R1.0 前置（含本次 R1.0d） | 3–5 天 |
| R1.1 仓库骨架 | 2–3 天 |
| R1.2 i18n 基础设施 | 4–6 天 |
| R1.3 数据模型 | 1.5–2 周 = 7.5–10 天 |
| R1.4 NCPF 读写 | 3–5 天 |
| R1.5 SFR 单一内核 | 1.5–2.5 周 = 7.5–12.5 天 |
| R1.6 其余堆型 | 1.5–2.5 周 = 7.5–12.5 天 |
| **合计** | **34.5–54 人日 = 6.9–10.8 周** |

**光是这张表就已经超过「R1 — 5–7 周」的标题**（下限 6.9 周 > 5 周，上限 10.8 周 > 7 周）。
即：不需要任何新测量，§4 的标题与 §4.1–4.7 的正文就是互相矛盾的。

### 5.3 算术二：用实测行数检验

| 工作流 | scope | 实测 codeLines | 方案预算（天） | 隐含速率（行/天） |
|---|---|---:|---:|---:|
| R1.3 模型 | r1-model | 8,336 | 7.5–10 | 834–1,112 |
| R1.4 读写核心 | r1-formats-core | 1,322 | 3–5 | 264–441 |
| R1.5 SFR 内核 | r1-kernel-sfr | 5,572 | 7.5–12.5 | 446–743 |
| R1.6 其余堆型 | r1-kernel-misc | 4,968 | 7.5–12.5 | 397–662 |
| R1 共享基建 | r1-infra | 5,213 | 未单列（摊在 R1.1/R1.3/R1.5） | — |

把 R1 当成 5–7 周（25–35 人日）来排：其中 R1.0+R1.1+R1.2 占 9–14 人日且**几乎不产出移植行**，
留给移植的只有 **11–26 人日**，却要吃掉 **25,365 行** →
需要的持续速率是 **976–2,306 codeLines/天**，是方案自己给物理/格式工作流隐含速率（264–743 行/天）的 **1.3–8.7 倍**。
反过来，按方案自己的隐含速率逐项相加：R1.3 7.5–10 + R1.4 3–5 + R1.5 7.5–12.5 + R1.6 7.5–12.5 = **25.5–40 人日**，
加上 R1.0–R1.2 的 9–14 人日 = **34.5–54 人日 = 6.9–10.8 周**（与 §5.2 完全一致）。

### 5.4 结论

| 问题 | 结论 |
|---|---|
| R1 的 5–7 周还成立吗？ | **不成立。** 方案自身 §4.1–4.7 的子预算之和已经是 6.9–10.8 周；文件级实测（R1 范围 25,365 codeLines）不但没有把它压回去，反而显示方案对「移植量」的估算（15,000–18,000 行）只覆盖实测 must-build（38,026 行）的 39–47% |
| 建议改成多少 | **R1 = 8–10 周**，逐项：R1.0 4 天 + R1.1 2.5 天 + R1.2 5 天 + R1.3 9 天 + R1.4 4 天 + R1.5 10 天 + R1.6 10 天 = **44.5 人日 ≈ 8.9 周**，报 8–10 周 |
| 能不能压缩 | 能，但必须**改范围**而不是改标题：① R1.6e Fusion（1,123 codeLines、独立环形几何、还需 `fusion_test` 模块）按方案自己的建议砍掉 → −1,123 行；② R1.6d Distiller（337 codeLines）无配置可用，也建议推迟；③ `r1-infra` 的 `planner/module/**`（1,449 行）若确认不做插件式模块系统，可只保留 Core/Overhaul/Underhaul 三个模块 → 再省约 600–1,000 行。砍掉 ①② 后 R1 ≈ **7 周** |
| 测量不确定性 | R0 说的 ±30% 在本次复核后应当**收窄到 ±10–15%**：行数本身是精确测量（可复现、哈希化），剩下的不确定性来自「每行的实际难度」——典型如 `r1-model` 8,336 行里 1,894 行是会被声明式 schema 消掉的样板（89 个 `@RegisterWith` 模块类） |
| 对别处的影响 | R2 的历史格式读取器实测 6,777 行（方案 R2 = 2.5–4 周 = 12.5–20 人日 → 隐含 339–542 行/天，与 §5.3 的格式速率一致，**R2 的估算站得住**）；R3 要重写 36,581 行（6–10 周 = 30–50 人日 → 732–1,219 行/天）——但 R3 是**新写**而不是移植，方案自己也说新栈下同等功能代码量会小得多，故 R3 的 6–10 周不受本次测量直接否定；R4 的 3,590 行对应 3–5 周（144–239 行/天），量级合理 |

---

## 6. 判断性选择（judgement calls）与已知局限

1. **`VERIFY` 只有 6 个文件**，是刻意收窄的：大多数「只能靠行为验证」的东西（物理数值）**混在 REWRITE 的文件里**，
   所以我把它们标成文件的 `physics` 标志 + §4.2 的 seam 估算，而不是硬塞进 `VERIFY` bucket 来虚增这个桶。
   如果 R1 决定把「物理语义」单独列为一个验收桶，应把这 16 个模拟器文件的 `seam.phys`（4,144 行）视作其体量。
2. **`DROP` 的边界**：`PNGWriter` / `ImageFormatWriter` / `TextureManager` / `ImageIO` / `FormattedText` 我判 `DROP`（都是 AWT/GL 渲染耦合），
   这意味着 R2.12「PNG 导出」被当作**新写**而不是移植。若项目决定「PNG 导出必须与 Java 版逐像素一致」，这 214 行要挪回 `PORT`。
3. **`planner/Main.java`（545 行）判 `PORT`**：它是启动器（下载 `reflections-0.10.2.jar` 等依赖、拼 classpath、拉起 Core）。
   在 Web 栈里它对应「应用入口 + 依赖安装」，仍然要写，但形态完全不同；`reason` 里保留为默认 `default:logic-port`，
   是本次唯一想标 `REWRITE` 但没标的大文件。反射注册本身在 `planner/module/Module.java`（已判 `REWRITE`）。
4. **`@RegisterWith` 的 122 个模型树文件里，只有 `planner/ncpf/module/**` 的 89 个判 `REWRITE`**；
   `ncpf/**` 的 20 个（元素类型）留在 `PORT`。理由：R1.3c 要替换的是「120 个手写**模块**类」，
   元素类型类是数据模型本身，注解机制换了但内容仍要移植。这个判断会让 R1.3 的行数看起来比 R0 高（+1,894），是**有意的**。
5. **seam 估算是启发式的**：方法体切分基于大括号配对（已先把注释与字符串抹成空格），
   控制流块被跳过，嵌套/匿名类里的方法会被计入。它给出的是量级与边界提示，不是可交付的拆分结果。
6. **未验证项**：`--report` 的「per-file classification」表（831 行）没有粘贴进本文（太长）；
   完整明细在 `docs/r1/port-audit-file-level.json`，可用
   `node -e "const r=require('./docs/r1/port-audit-file-level.json');console.log(r.files.filter(f=>f.bucket==='VERIFY'))"` 之类的方式消费。
7. **R1.3c 的「205 条样板方法」未能复现**（实测 163 条同口径声明）——见 §3.5，建议改口径或改数字。

---

## 7. 复现检查清单（CI 可直接用）

```bash
node tools/ts/port-audit.mjs --summary                          # 期望 contentSha256=7e36b9a5...（不符即 exit 1）
node tools/ts/port-audit.mjs --json docs/r1/port-audit-file-level.json   # 刷新快照（写完后必须同步 EXPECTED_SHA）
node tools/ts/port-audit.mjs --report | head -75                # 期望 totals=831/77,840/76,579
```

断言（应当全部成立）：

| 断言 | 期望值 |
|---|---|
| 文件数 / rawLines | 831 / 77,840（R0 §1 的历史公布值是 831 / 77,825，差额 +15 见 §0） |
| R0 逐文件行数不一致数 | 2（`OverhaulMSR.java` +9、`OverhaulSFR.java` +6，均为中文化冻结提交引入） |
| `must-build` | 431 文件 / 38,560 raw / 38,026 code |
| R1 范围 | 280 文件 / 25,822 raw / 25,365 code |
| `bucket` 之和 | = 831 文件 / 77,840 raw / 76,579 code（无遗漏、无重复） |
| `scope` 之和 | 同上 |
| `contentSha256` | `7e36b9a5c7c9de15382259418b0941b8ae6cffb47c543946889c9f788beda6a4`（= 脚本内置 `EXPECTED_SHA`，`--summary` / `--report` 不符即 `exit 1`） |
| 两次运行哈希 | 相同（确定性） |
| `import` 该脚本 | 无副作用（不打印、不写文件） |
