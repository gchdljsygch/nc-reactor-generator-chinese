# 后续重构执行计划（R1–R5）

> **R1 实测更正（本节由 R1 追加，正文一字未改）**
>
> 1. **§1.2 事实 4 / §3.1.2 的字段名有误**：Turbine **没有 `totalPower` 字段**。
>    实测（`datasets/golden/turbine-cases.jsonl.gz`）Turbine 的产出字段是
>    `totalOutput`（long），MSR 是 `totalTotalOutput`，SFR 是 `totalOutput`。
>    不要按正文里的 `totalPower` 去找字段。
> 2. **§3.1.2 的字段清单不完整**：Turbine 的实际统计量是
>    `bearingDiameter, bladeCount, coilEfficiency, idealityMultiplier, maxInput,
>    maxUnsafeInput, missingCasings, numControllers, rotorEfficiency, safeOutput,
>    throughputEfficiency, totalEfficiency, totalFluidEfficiency, totalOutput,
>    unsafeOutput`。
> 3. **§3.1.5 的规范化层还需要覆盖 Turbine**：冻结实现在
>    `rotorEfficiency /= numberOfBlades` 处会在「无叶片」时给出 `NaN`
>    （17/500 例）。处置见 `docs/r1/d1-decision.md` §4.1。
> 4. **D1 的 bug 表从 4 条扩为 5 条**：新增「MSR 加热器配方
>    `ClassCastException`」，它使 MSR 的黄金数据在修复前**完全无法产出**。
>    见 `docs/r1/d1-decision.md` §6。
> 5. **R1 工期修正**：R1.0d 的文件级复核给出 **8–10 周**（正文 §4 为 5–7 周），
>    依据是 R1 范围内 25,364 行 must-port 代码量。
>    见 `docs/r1/port-audit-file-level.md`。
> 6. **R1 验收结果**：四种堆型全部通过黄金数据集
>    （SFR 5000/5000、USFR 5000/5000、MSR 1000/1000、Turbine 500/500），
>    M1 闸门通过。状态入口：`docs/r1/README.md`。

> **前置**：R0 阶段已完成，产出见 `docs/r0/findings.md`（13 项发现）、`docs/r0/golden-datasets.md`、
> `docs/r0/compat-contract.md`、`docs/r0/port-audit.md`、`docs/r0/fixture-coverage.md`、
> `docs/r0/historical-fixtures.md`。
>
> **本文档的定位**：`docs/rewrite-plan.md` §6 给出了 R1–R5 的**概要**；本文档把它落成
> **可执行的任务分解**，并把每一条验收标准**绑到 R0 实际产出的产物**上。
> 凡是本文档与 `rewrite-plan.md` 冲突，以本文档为准（它基于 R0 实测）。
>
> **目标技术栈**：TypeScript / Web（已定）。

---

## 0. 一页结论

| 项 | 结论 |
|---|---|
| R0 是否达成目标 | ✅ 六项（R0.2–R0.7）全部交付；M0 三件套（黄金数据集 / 格式样本 / 迁移输入）就绪 |
| 最大风险是否已消除 | **未完全**。物理移植的风险被**量化**了（知道差在哪、差多少），但**尚未消除** —— 要到 M1 才算 |
| 进 R1 前必须先定的事 | 4 个产品 bug 修不修（§2 D1）、兼容契约确认（D2）、上游关系（D4） |
| R1 的第一个动作 | **R1.0**：补齐 MSR/Turbine 的黄金数据 + 测量 Java 引擎的**逐次确定性**（§4.1）—— 这两件不做完，验收标准就无法定死 |
| 关键路径 | R1.0 → R1.3(模型) → R1.5(SFR 物理) → **M1 闸门** → R2 → R3 → R4 |
| 单人全量工期 | **19–31 周**（与 `rewrite-plan.md` 一致，R0 未推翻它）；裁剪版 **12–18 周**（§9.3） |
| 决策闸门 | **M1**：黄金数据集若在 M1 不通过，说明栈选错（切 Kotlin，见 §10 R-2），此时沉没成本仍小 |

---

## 1. R0 交接状态（起点）

### 1.1 仓库里现在有什么

**工具（`tools/`，6 个 Java 工具 2,553 行 + 6 个 PowerShell 脚本）**

| 工具 | 作用 |
|---|---|
| `Bootstrap.java` | headless 启动（`plannerator.skipTextures` + `Main.isBot`），被所有工具复用 |
| `GoldenGen.java` | 6 堆型黄金数据生成 + `--from-ncpf` 真实设计导入 |
| `ElementDump.java` | NCPF 元素身份导出（948 元素）+ 旧中文化审计 |
| `RoundTrip.java` | NCPF 往返测试 + `--check` / `--coverage` reader 覆盖 |
| `FixtureGen.java` | 各格式 fixtures 生成与往返验证 |
| `ConfigFixtureGen.java` | NCConfig `.cfg` fixtures 合成与验证 |

**数据（`datasets/`，共 11.61 MB）**

| 产物 | 规模 | 用途 |
|---|---|---|
| `golden/sfr-cases.jsonl.gz` | 5,000 例 / 4.84 MB | Overhaul SFR 物理黄金值 |
| `golden/usfr-cases.jsonl.gz` | 5,000 例 / 1.54 MB | Underhaul SFR 物理黄金值 |
| `ncpf-elements.jsonl` | 948 元素 / 299 KB | 数据名身份键的权威清单 |
| `translations/legacy-translations.{json,tsv}` | 1,185 对 | 译文迁移输入 |
| `fixtures/`（8 个合成 0.79 MB + `historical/` 19 个真实 4.01 MB） | 4.8 MB | 格式兼容回归语料 |

**语言包草稿（`lang/`）**：`zh_CN.messages.draft.json`（1,101 条）、`zh_CN.elements.draft.json`（26 条）

**工具链**：`golden.ps1`（生成黄金数据）、`fixtures.ps1`（fixtures + 覆盖表 + 历史提取）、
`historical-fixtures.ps1`、`i18n/*.ps1`、`audit/port-audit.ps1`

### 1.2 R0 证明的事实（会约束后续设计）

这七条**不是建议，是实测结论**，后续设计不得与之冲突：

1. **物理被实现了两遍，且不一致**：随机网格上 Overhaul SFR 核心物理分歧 33.9%、
   Underhaul SFR 41.68%；分歧集中在**慢化剂连线 + 簇构建**（`fuel_only` 布局 725 例零分歧）。
   → TS 只能有**一份**物理内核，编辑器与生成器共用。
2. **真实存档也分歧**：2020 年的 `underhaul.json` 上 `cooling` 差 **6.78×**（720 vs 4880）。
   → 「分歧只是随机样本的产物」被否定。
3. **编辑器引擎会崩**：277/5000（5.5%）随机 Overhaul SFR 让 `OverhaulSFR.java:1024` 抛 NPE。
   → 验收标准必须定义「崩溃用例」的期望行为（§3.1.4）。
4. **黄金数据集的字段名按堆型而不同**：SFR 用 `totalOutput`，MSR 用 `totalTotalOutput`，
   Turbine 用 `totalPower`；且**大量关键字段是 private**（反射才拿得到）。
   → TS 侧必须有显式的「字段映射表」，不能假设统一命名（§3.1.2）。
5. **数据名身份键必须四段式**：`<config>/<cfgType>/<type>|<definition>`。
   仅 `type|definition` 时 660 个键里 29 个对应冲突的显示名。
6. **"写"有两种语义**：`NCPFFileWriter`（保存，全保真，38/38 往返一致）vs
   `NCPFWriter`（导出，`makePartial` + 裁掉 `plannerator:*`）。混用会静默损坏用户工程。
7. **有 4 条已确认的导入/保存路径是坏的**（§2 D1）：`matches()` 不自反、Overhaul `.cfg` 死路径、
   `LegacyNCPF1Reader` 损坏、Hellrage 显示名匹配失败。

### 1.3 R0 的空白（后续必须补）

| 空白 | 影响 | 补法 |
|---|---|---|
| **MSR / Turbine / Fusion / Distiller 没有黄金数据** | R1.6 无法验收 | 需要各堆型的**专用构造器**（通用填充造不出可用反应堆）→ §4.1 R1.0 |
| **Java 引擎的逐次确定性未测** | 容差无法定死 | 同一用例跑多次比对 → §4.1 R1.0 |
| 真实设计样本只有 2 个 | 真实分歧率无统计意义 | `--from-ncpf` 已就绪，只需投喂文件 |
| v2–v9 / Hellrage MSR 的真实文件未验证 | 兼容层工作量估计有不确定性 | 扩充 `historical-fixtures.ps1` 路径清单 / 社区存档 |
| 迁移到 TS 的行数只有粗估 | 排期有 ±30% 不确定性 | R1.0 做一次文件级复核（`port-audit.md` 是包级规则分类） |

---

## 2. 四个先行决策（阻塞或影响 R1）

> 这四项**不解决就进 R1，会在 M1 返工**。建议在 R1.0 期间并行拍板。

### D1 — 四个产品 bug 修不修？基线版本定哪个？

R0 刻意没修（避免破坏基线）。但**修与不修会改变黄金数据和 fixtures**，
所以必须在 R1 开始消费这些产物之前定下来。

| 选项 | 代价 | 影响 |
|---|---|---|
| **A. 全不修**，作为已知问题写进 TS 重写 | 0 | 冻结版保留 4 个 bug；TS 按「修复后语义」实现，黄金数据里 277 个 `error` 用例无黄金值 |
| **B. 只修 `matches()` + 辐照器 NPE**（收益最大、改动最小） | 2 处小改动 + **重新生成 golden 与 fixtures**（约 0.5 天） | 含 Overhaul SFR 的工程能正常保存/重开；崩溃用例变成正常用例。**推荐** |
| **C. 四条全修** | 4 处改动 + 重新生成 + 需要重跑真实历史文件覆盖（约 1–1.5 天） | 兼容层与物理层的基线最干净；但改动面大，需在冻结版之外单独验证 |

**修复要点**（R0 已定位到行）：

| bug | 位置 | 修法 |
|---|---|---|
| `matches()` 不自反 | `NCPFSettingsElement.java:186-210` 的 `Set` 分支 | 按 `NCPFElementStack`（而非 `NCPFElementDefinition`）比较；或对不含数量的栈退化为按 `definition.matches` 比较 |
| 辐照器分支 NPE | `OverhaulSFR.java:1024` | 补上 1004 行同款 `if(b.template.moderator!=null)` |
| Overhaul `.cfg` 死路径 | `OverhaulSFRConfigurationBuilder.java:188`、`OverhaulMSRConfigurationBuilder.java:194`、`MenuElementConfiguration.java:98` | 用 `definition.getRecipeContainedAlternative()` 包一层 |
| `shutdownFactor` NaN/越界 | `OverhaulSFR.java:945`（及同类） | 定义为 `[0,1]`，`totalOutput == 0` 时取 0 |

**我的建议**：选 **B**。理由是 `matches()` 与辐照器 NPE 直接决定「用户能否保存并重开工程」，
而黄金数据的 277 个 `error` 用例本来就没有参考价值（删掉反而更干净）。
Overhaul `.cfg` 死路径与 `LegacyNCPF1Reader` 属于**导入**路径，
可以让 TS 直接按修复后语义实现，不必回改 Java（但要在契约里标注「与冻结版行为不同，这是有意的」）。

### D2 — 兼容性契约确认（`compat-contract.md` §7 的 C1–C4）

| # | 决策 | 建议 |
|---|---|---|
| C1 | P0 = NCPF + LegacyNCPF v9–v11 + Hellrage v6 + Underhaul Hellrage v2 | 接受 |
| C2 | P1 里哪些真的要做 | 先做 **NCConfig underhaul**（已实测可读）；overhaul 按修复后语义做 |
| C3 | 是否写出 Legacy NCPF / BG String / ZenScript | **否**（用冻结的 Java 版降级） |
| C4 | 接受「设置文件需要一次性迁移」 | 接受 |

**R0 新增的建议**：把契约的 P0 表按**真实验证状态**重写一遍（现在已经知道哪几个 reader 验证过）：

- ✅ 真实文件验证：`LegacyNCPF10Reader`（5 个）、`LegacyNCPF11Reader`（9 个）、`UnderhaulHellrage2Reader`（1 个）
- ✅ 合成验证：`NCPFReader`、`UnderhaulNCConfigReader`
- ❌ 已确认损坏：`LegacyNCPF1Reader`、`OverhaulHellrageSFR5Reader`、`OverhaulNCConfigReader`
- ⏳ 未验证：`LegacyNCPF2`–`v9`、Hellrage MSR v1–v6、Underhaul Hellrage v1

### D3 — 目标平台与分发形态

建议：**Web + PWA**（离线可用），桌面壳（Tauri/PWA 包装）按需后加。
R0 未对此提供新证据，维持 `rewrite-plan.md` §3.2 的判断。

### D4 — 与上游的关系

R0 期间**上游状态未复查**（首次分析时上游已在抽 `DizzyEngine`/`NCPF`，
并有 `nc-planner-twd` 多平台版上架 Google Play）。建议 R1 开始前花 **1–2 天**复查：

- 若上游多平台版已是现代栈 —— 评估「基于它做中文化」是否比自研更划算（可能省掉 R1–R4）
- 若是另一个 Java/Android 单体 —— 走彻底分叉，但**把 i18n 与字体能力回推给上游**（双赢）

---

## 3. 验收标准体系（R0 产物的用法）

> 这一节是本文档**最重要的部分**。R0 的产物只有在被当作**测试**使用时才有价值。

### 3.1 物理验收（黄金数据集）

#### 3.1.1 黄金值取哪一个引擎？

**取 `editor` 字段。** 用户看到的就是它。

`lite` 字段是那份**应当消失**的第二实现。它在本阶段的作用不是「对拍目标」，
而是「**旧实现内部不一致的证据**」——用来定位 TS 实现最可能出错的区域：

| 证据 | 对 TS 的指导 |
|---|---|
| Underhaul `fuel_only` 布局 725 例零分歧 | 均匀布局两引擎本来就一致 → TS 实现该布局必须与两者都一致 |
| 含慢化剂/散热器交错的分歧 42–47% | **重点验证慢化剂连线与簇构建**，这是最可能出错的地方 |
| 真实设计 `cooling` 差 6.78× | 该字段的旧实现不可信 → TS 需要**独立复核**（不能只对拍 Java） |

> ⚠️ **重要**：对有分歧的字段，「匹配 Java 编辑器引擎」只是**必要条件**，不是**正确性证明**。
> 尤其是真实存档上差 6.78× 的 `cooling` —— 必须用**独立推演**（手算一个小反应堆）验证 TS 的物理，
> 否则只是把一个旧 bug 抄进新实现。这一条应作为 R1.5 的显式任务。

#### 3.1.2 字段映射表（必须有，不能假设统一命名）

**Overhaul SFR（`--type sfr`）** —— 15 个 editor 字段，其中 12 个与 lite 共有（可对拍）：

```
totalFuelCells, rawOutput, totalOutput, totalCooling, totalHeat, netHeat,
totalEfficiency, totalHeatMult, totalIrradiation, functionalBlocks, sparsityMult,
shutdownFactor          ← 以上 12 个为共享（可对拍）
offOutput, numControllers, missingCasings   ← 仅 editor（诊断字段）
```

**Underhaul SFR（`--type underhaul-sfr`）** —— 9 个 editor 字段，其中 7 个与 lite 共有：

```
power, heat, cooling, cells, efficiency, heatMult, netHeat   ← 共享
numControllers, missingCasings                                ← 仅 editor
```

**注意**：`cells` 在 SFR 里是 lite 独有（editor 用 `totalFuelCells`），在 Underhaul 里两边都有。
**TS 侧必须按堆型定义映射，不要在实现里猜。**

#### 3.1.3 容差

| 字段类型 | 建议容差 | 依据 |
|---|---|---|
| 整数字段（`totalFuelCells`、`functionalBlocks`、`cells`、`rawOutput`…） | **精确相等** | R0 观察到的分歧都是整数级差异，不是浮点噪声 |
| 浮点字段（`totalOutput`、`totalEfficiency`、`totalHeatMult`、`sparsityMult`、`shutdownFactor`；Underhaul 的 `efficiency`、`heatMult`） | **相对 1e-5** | 与 R0 分歧检测用的阈值一致；具体值应在 R1.0 测完确定性后收紧 |
| `"NaN"` / `"Infinity"`（字符串） | 见 §3.1.5 的规范化层 | |

**R1.0 必须先测**：同一用例在 Java 里跑 N 次是否完全一致。若不一致，
容差必须按实测的抖动范围设定，否则测试会随机红。

#### 3.1.4 崩溃用例（277 个 `error` 记录）的策略

SFR 数据集里有 277 条记录带 `"error"` 字段、**没有** `editor` 统计。它们**不是**无效数据，
而是「冻结的引擎在这里崩」的事实。策略：

```ts
if (record.error) {
  // 唯一断言：TS 不得抛异常
  expect(() => simulate(rebuild(record))).not.toThrow();
  // 且必须产出一个有限值（不得是 NaN/Infinity）
  expectStatsAreFinite(simulate(rebuild(record)));
} else {
  expectStats(...).toMatchGolden(record.editor);
}
```

即：**TS 必须算出一个结果**（因为缺失的是 null 检查，不是物理）。
若 D1 选了修复方案 B/C，这 277 条会变成正常用例，原始 `error` 列表仍应保留为「回归清单」。

#### 3.1.5 规范化层（必须在比较前应用）

旧实现有几处语义缺陷会污染对拍。TS 侧应实现一个显式的 `normalizeStats()`：

| 字段 | 旧实现行为 | TS 规范化 |
|---|---|---|
| `shutdownFactor` | `totalOutput == 0` 时为 `NaN`；实测还有 13 例越界（负值或 >1） | 定义域 `[0,1]`；`totalOutput == 0 → 0` |
| 任意浮点字段 | 可能因 `sparsityMult` 连乘而下溢到 `1e-24` 这类极小数 | 保留原值；但在**比较**时对 `|v| < 1e-12` 一律视为 0（R0 里 42 例下溢） |
| `lastChangeTime` | 挂钟时间戳 | **R0 已从数据集排除**，TS 不应有该字段 |

**规范化的对拍方式**：测试里比较 `normalize(tsStats)` 与 `normalize(goldenEditor)`，
其中 `normalize` 对 `"NaN"` 的处理是「参考值未定义 → 跳过该字段」。

#### 3.1.6 数据集版本与可再生性

- 数据集带 `"datasetVersion": 2`。字段含义变化时必须升版本号，并同步本文档 §3.1.2。
- **可再生**：`pwsh -File tools/golden/golden.ps1 -Type sfr -Cases 5000 -Seed 20260101 -MinSize 3 -MaxSize 14`
  （产品代码零改动 + 同一种子 → 同一数据集）。若 D1 选 B/C，重新生成后**必须更新** `toolchain` 版本记录。

### 3.2 格式验收（fixtures + 覆盖表）

**两层验收**：

1. **读取层**：TS 必须能把 `datasets/fixtures/` 与 `datasets/fixtures/historical/` 里
   **R0 已确认能读的**文件读成等价语义。当前清单（以覆盖表为准）：

   | 来源 | 已验证可读 | 文件 |
   |---|---|---|
   | 合成 | 4 / 8 | `usfr-ncpf-save`、`usfr-ncpf-export`、`usfr-legacy-ncpf`、`ncconfig-underhaul.cfg` |
   | 真实历史 | 15 / 19 | v10 ×5、v11 ×9、Hellrage underhaul ×1 |

   **反向清单（TS 必须按修复后语义实现，不得复刻）**：
   `sfr-ncpf-save`（`matches()` bug）、`sfr-hellrage` / `overhaul.json`（显示名匹配）、
   `usfr-hellrage`（同上）、`ncconfig-overhaul.cfg`（死路径）、
   `asdf.ncpf` / `qwerty.ncpf`（v1 NPE）、`fusion_test.ncpf`（需模块激活）。

2. **写出层**：两种语义都要实现（§1.2 事实 6），且**写出的文件能被冻结的 Java 版读回**：
   - `NCPFFileWriter` 语义 → 结构指纹与 Java 版一致（R0 实测 **38/38** 通过，这是可直接复用的验收集）
   - `NCPFWriter` 语义 → 结构保留、`plannerator:*` 按规则裁剪

**可直接复用的现成验收集**：`docs/r0/format-roundtrip.md` 的 38 个生产配置，
其指纹方法（配置名 + 元素身份 + 显示名，排序后 SHA-256 取前 12 字节）已在
`RoundTrip.java` 实现，TS 侧照抄即可得到可比对的指纹。

### 3.3 i18n 验收

| 项 | 标准 |
|---|---|
| 缺 key 行为 | **整条**回退到规范语言（`en_US`），再缺回退到 key 本身；**绝不半翻译** |
| 覆盖率门禁 | CI 统计「已翻译 / 总 key」「未使用 key」「冲突 key」，任一越界即失败 |
| 迁移完整性 | `lang/zh_CN.messages.draft.json` 的 1,101 条 + `elements.draft` 的 26 条必须全部有归宿（迁入新 key 或被显式标记废弃），不得静默丢失 |
| 数据名身份键 | 四段式 `<config>/<cfgType>/<type>|<definition>`（§1.2 事实 5） |
| 复数/语序 | 单元测试覆盖：中文无复数变化、英文有；语序可重排（用带 2 个参数的 key） |
| 裸字符串 | lint 规则禁止核心包出现用户可见字面量 |

### 3.4 这些标准怎么落成测试

```ts
// packages/kernel/test/golden.test.ts
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const DATASETS = [
  { type: 'sfr',          path: 'datasets/golden/sfr-cases.jsonl.gz',  fields: SFR_FIELDS },
  { type: 'underhaul-sfr', path: 'datasets/golden/usfr-cases.jsonl.gz', fields: USFR_FIELDS },
];

for (const ds of DATASETS) {
  const lines = gunzipSync(readFileSync(ds.path)).toString('utf8').split('\n').filter(Boolean);
  const meta = JSON.parse(lines[0]).__meta;
  const records: GoldenRecord[] = lines.slice(1).map(l => JSON.parse(l));

  describe(`golden: ${meta.reactorType} (datasetVersion ${meta.datasetVersion})`, () => {
    for (const r of records) {
      it(r.id, () => {
        const reactor = rebuildFromGrid(r);        // blockNames/recipeNames/grid/recipes/size
        if (r.error) {
          // 崩溃用例：TS 不得崩，且必须产出有限值
          expect(() => simulate(ds.type, reactor)).not.toThrow();
          expect(allFinite(simulate(ds.type, reactor))).toBe(true);
          return;
        }
        const got = normalizeStats(ds.type, simulate(ds.type, reactor));
        expectStats(got).toMatchGolden(ds.type, r.editor);   // 字段映射 + 容差 + 跳过 NaN
      });
    }
  });
}
```

要点：

- **按记录一条一个 `it`**，这样失败信息能直接定位到具体的反应堆（5,000 条会较慢，
  可用 `it.each` + 环境变量做抽样，CI 全量、本地抽样）；
- `rebuildFromGrid` 是新实现的第一段代码，它本身就验证了数据集的**自描述性**
  （`size` 是全网格尺寸，索引含外壳）；
- `toMatchGolden` 是一个自定义 matcher，封装 §3.1.2 的字段映射与 §3.1.3 的容差。

---

## 4. R1 — 骨架 + 内核（5–7 周，含 R1.0）

### 4.1 R1.0 — 补齐前置（3–5 天，**必须先做**）

| # | 任务 | 产出 / 验收 |
|---|---|---|
| R1.0a | **测量 Java 引擎的逐次确定性**：同一用例跑 10 次，比对所有数值字段 | 一份「哪些字段有抖动、抖动多大」的清单 → 定死 §3.1.3 的容差 |
| R1.0b | **补齐 MSR 黄金数据**：为 `OverhaulMSR` 写专用构造器（连续燃料容器组 + 加热器配方 + 慢化剂），生成 ≥1,000 例 | `datasets/golden/msr-cases.jsonl.gz`；R1.6 的验收集 |
| R1.0c | **补齐 Turbine 黄金数据**：叶片/定子/线圈排布构造器，≥500 例 | `datasets/golden/turbine-cases.jsonl.gz` |
| R1.0d | **文件级复核移植量**：把 `port-audit.md` 的包级规则分类落到文件级，确认「需移植」的真实行数 | 更新的 `port-audit.md` + 修正后的 R1 工期 |
| R1.0e | **D1 决策落地**：若选 B/C，改 Java、重新生成受影响的 golden 与 fixtures，并在 `golden-datasets.md` 记录「基线版本」 | 重新生成的数据集 + 变更记录 |

> **为什么 R1.0 是硬前置**：§3.1.3 的容差和 §3.1.4 的崩溃策略都依赖 R1.0a 的结果；
> R1.6 的验收依赖 R1.0b/c。跳过 R1.0 会在 M1 发现验收标准无法定义。

### 4.2 R1.1 — 仓库骨架与工程约定（2–3 天）

| # | 任务 | 验收 |
|---|---|---|
| R1.1a | 初始化 monorepo（建议 pnpm workspace）：`packages/{ncpf,kernel,formats,i18n,app}` | `pnpm build` 通过 |
| R1.1b | **依赖方向强制**：`kernel` 不得 import `app`/UI 任何东西（ESLint `no-restricted-imports`） | lint 规则在 CI 生效 |
| R1.1c | Vitest + 覆盖率；`datasets/` 通过 workspace 目录或复制接入 | `pnpm test` 能跑到 §3.4 的骨架（先跑 1 条记录） |
| R1.1d | 「禁止裸字符串」lint 规则（核心包内） | 规则生效 |
| R1.1e | `docs/` 纳入仓库；把 `docs/r0/**` 复制/链接过去作为回归基准 | 文档可追溯 |

### 4.3 R1.2 — i18n 基础设施（4–6 天，**先于一切 UI**）

| # | 任务 | 验收 |
|---|---|---|
| R1.2a | `LocaleManager`：当前 locale、回退链（`zh_CN → zh → en_US → key`）、监听器 | 单测覆盖回退链的每一级 |
| R1.2b | `MessageBundle`：ICU MessageFormat 命名参数 / 复数；`tr(key, args)` | 单测：中文无复数、英文复数、双参数语序重排 |
| R1.2c | `DataNameBundle`：四段式身份键查找（§1.2 事实 5） | 用 `datasets/ncpf-elements.jsonl` 的 948 个元素做单测 |
| R1.2d | `MissingKeyReporter`：开发模式告警 + CI 汇总；**缺 key 整条回退** | 单测：缺 key 时返回 `en_US` 原文而非半翻译 |
| R1.2e | 语言包加载：内置 `lang/*.json` + 运行时可加载外部包 | 新增语言零代码 |
| R1.2f | 迁移 `legacy-translations.json`：把 1,101 条 UI 草稿重新 key 化（`menu.*` / `dialog.*` / `tooltip.*` …） | 迁移映射表；无条目静默丢失 |

### 4.4 R1.3 — NCPF 数据模型（1.5–2 周）

| # | 任务 | 验收 |
|---|---|---|
| R1.3a | 移植 `ncpf/`（56 文件 / 2,992 行）：`NCPFElement` / `NCPFModule` / `NCPFObject` / 元素定义族 | 类型定义齐全，无 `any` |
| R1.3b | 移植 `planner/ncpf` 的配置模型（207 文件 / 8,391 行，其中 120 个模块类） | 34 个配置全部加载成功 |
| R1.3c | **用声明式 schema 替代 120 个手写模块类**：消除 205 个样板 `convertTo/FromObject` | 样板方法数从 205 → 0；配置加载结果与 Java 等价 |
| R1.3d | **显式注册替代反射**（`@RegisterWith` + classgraph 全删） | 无反射；启动时间可测 |
| R1.3e | **身份键**：`definitionIdentity(elem) = cfg + '/' + cfgType + '/' + type + '|' + def` | 单测：948 元素无显示名冲突（R0 实测 0 冲突） |
| R1.3f | 保留英文 canonical 与 `legacyNames` 两条通道（逻辑用 canonical，显示用本地化） | 单测：切换语言不影响导入匹配 |

### 4.5 R1.4 — NCPF 读写（3–5 天）

| # | 任务 | 验收 |
|---|---|---|
| R1.4a | 读：等价 Java `NCPFFileReader` | 38 个生产配置全部读入，**指纹与 `docs/r0/format-roundtrip.md` 一致** |
| R1.4b | **写（保存语义）**：等价 `NCPFFileWriter` | 写出的文件被冻结 Java 版读回，指纹一致（38/38） |
| R1.4c | **写（导出语义）**：等价 `NCPFWriter`（`makePartial` + 裁剪 `plannerator:*`） | 单个设计导出后结构保留、装饰被裁 |
| R1.4d | 处理 `matches()` 的语义：TS **不做**「索引 + 结构相等」，直接写元素身份 | fixtures `sfr-ncpf-save` 首次能往返成功 |

### 4.6 R1.5 — 单一物理内核：Overhaul SFR（1.5–2.5 周）★ 关键路径

| # | 任务 | 验收 |
|---|---|---|
| R1.5a | `rebuildFromGrid(record)`：从数据集的 `grid`/`recipes`/`size` 重建反应堆 | 能重建全部 5,000 例；`fuel_only` 等各策略都可复现 |
| R1.5b | 方块/模块模型：燃料单元、慢化剂、散热器、反射器、中子屏蔽、辐照器、中子源、导体 | — |
| R1.5c | **外壳校验 + 方块有效性**（`casingValid` 的等价语义） | — |
| R1.5d | **中子通量传播 + 慢化剂连线**（★ 分歧最集中的区域） | 见 R1.5g |
| R1.5e | 簇构建 + 簇统计 | — |
| R1.5f | 汇总统计（`totalOutput` / `totalCooling` / `sparsityMult` / `shutdownFactor` …） | 12 个共享字段 + 3 个 editor 独有字段全部产出 |
| R1.5g | **黄金数据集验收：4,723 条可用记录全通过**（277 条 `error` 按 §3.1.4 只断言不崩） | ≥99.9% 通过；任何失败都要能解释 |
| R1.5h | **独立正确性验证（不可省）**：手算 2–3 个小型反应堆（如 3×3×3 单栅格），验证 TS 的物理而非只对拍 Java | 手算值与 TS 输出一致；记录到测试 |
| R1.5i | **分歧区重点测试**：对 `checker` / `fuel_mod` 策略单独统计通过率 | 这些策略的通过率单独报告（R0 显示分歧集中于此） |

> **R1.5 的成功判据要写清楚**：匹配 `editor` 是**必要条件**。
> 因为真实存档上 `cooling` 差了 6.78×，R1.5h 的独立验证不是可选项。

### 4.7 R1.6 — 扩展到其余堆型（1.5–2.5 周）

| # | 堆型 | 依赖 | 备注 |
|---|---|---|---|
| R1.6a | Underhaul SFR | 5,000 例已就绪 | 复用 SFR 的簇框架，字段名不同（§3.1.2） |
| R1.6b | Overhaul MSR | **R1.0b** | 燃料容器组 + 加热器，与 SFR 共享 ≈72% 结构 |
| R1.6c | Overhaul Turbine | **R1.0c** | 叶片/定子/线圈/轴承 |
| R1.6d | Overhaul Distiller | ⚠️ **无配置可用**（`nuclearcraft.ncpf.json` 不含 distiller settings） | 需先决定：是否从 `LegacyNCPF11Reader` 构建 distiller 配置 |
| R1.6e | Fusion | ⚠️ 环形几何、需 `fusion_test` 模块 | 独立几何内核；**建议排最后或砍掉** |

**里程碑 M1**：`kernel` 能在 Node 端跑完 SFR/Underhaul/**MSR**/Turbine 物理，
黄金数据集全部通过（含 §3.1.4 的崩溃策略）。**此时没有一行 UI，但核心风险已消除。**

> **M1 是决策闸门**：若 R1.5g 长期卡在 <90%，说明 TS 的表达能力不足以复刻这套物理
> （例如依赖了 Java 的某种隐式数值行为），此时应切 `rewrite-plan.md` §3.3 的
> Kotlin + Compose 方案（物理几乎可逐行直译），沉没成本约 5–7 周。

---

## 5. R2 — 格式兼容层（2.5–4 周）∥ 可与 R1.6 并行

| # | 任务 | 验收 | 优先级 |
|---|---|---|---|
| R2.1 | NCPF 读取完善（addons、`legacy_names`、全局元素） | 38/38 指纹 | P0 |
| R2.2 | LegacyNCPF **v10/v11** 只读 | `datasets/fixtures/historical/` 的 **14 个真实文件**全部读入，元素数与覆盖表一致 | P0 |
| R2.3 | LegacyNCPF **v9** 只读 | 需要真实样本（尚无）→ 扩 `historical-fixtures.ps1` 路径清单 | P0 |
| R2.4 | LegacyNCPF **v1** 只读（按修复后语义） | `asdf.ncpf` / `qwerty.ncpf` 能读入 | P1 |
| R2.5 | Hellrage SFR **v6** 只读 + Hellrage 写出 | `sfr-hellrage.json` 能读回；写出的文件 Java 能读 | P0 |
| R2.6 | Hellrage **underhaul** 只读 | `usfr-hellrage.json`（合成）/ `underhaul.json`（真实）能读回，含 1 个设计 | P0 |
| R2.7 | Hellrage v1–v5 / MSR v1–v6 只读 | 需要真实样本；**若拿不到，明确降级为 P2 并写进契约** | P2 |
| R2.8 | NCConfig underhaul `.cfg` 只读 | `ncconfig-underhaul.cfg` 读出 90 元素 | P1 |
| R2.9 | NCConfig overhaul `.cfg` 只读（按修复后语义） | `ncconfig-overhaul.cfg` 能读入 | P1 |
| R2.10 | **关键**：Hellrage 用 `legacyNames` / 元素身份匹配，**不用显示名** | `Invalid block name` 类错误不再出现 | P0 |
| R2.11 | `config2`（`settings.dat`）一次性迁移 CLI | 旧设置可迁移；语言字段新增 | P2 |
| R2.12 | PNG 导出 | 与 Java 版目视一致（需要浏览器渲染） | P2 |

**R2 的一个硬要求**：每实现一个 reader，就往 `docs/r0/fixture-coverage.md` 的等价表里记一行
（TS 侧应产出一份自己的覆盖表，字段与 R0 的表格一致，便于逐行比对）。

---

## 6. R3 — UI（6–10 周）

R0 对 UI 的贡献是**把范围缩小**了：`port-audit.md` 显示 DROP 354 文件 / 35,274 行
（`planner/gui` 14,311 + `theme` 5,107 + `graphics` 2,894 + `vr` 2,773 + `dssl` 2,024 +
`localization` 1,258 + `discord` 6,907），这些**全部用新栈重写**，且新栈下同等功能的代码量会小得多。

| # | 任务 | 验收 |
|---|---|---|
| R3.1 | 应用骨架、路由、布局；**主题用 CSS 变量**（替代 5,107 行 theme 代码） | 主题可切换，代码量 < 500 行 |
| R3.2 | **语言切换 UI + 持久化** | 运行时切换，无需重启；刷新后保持 |
| R3.3 | 菜单 / 对话框 / 文件选择 / 拖放（`.ncpf` / `.json` / `.cfg`） | 能完成「打开 → 编辑 → 保存」 |
| R3.4 | 配置编辑器（等价 `MenuElementConfiguration`） | 能编辑元素属性与模块 |
| R3.5 | **方块网格编辑器**：绘制/擦除/选择/复制粘贴/撤销重做/对称 | 等价现有编辑能力；用 fixtures 里的反应堆做手工验收 |
| R3.6 | 2D 俯视视图 + 部件清单 | 清单与 Java 版一致（可用 `underhaul.json` 的设计比对） |
| R3.7 | 3D 视图（旋转/缩放/剖切/外壳） | 等价 `editor3dView`；**用 WebGL，不用 WebGPU**（兼容性优先） |
| R3.8 | 统计面板 / 工具提示：**全部走 ICU key，禁止字符串拼接** | `i18nAudit` 零裸字符串；R0 的 `docs/i18n-audit-baseline.txt` 作为 burn-down 清单 |
| R3.9 | 字体：按 locale 选主字体 + 回退链 + **字形图集**（不能一字符一纹理） | 4,000 汉字下 GL 纹理数 O(1)；借鉴 R0 发现的 Java 侧 17 MB 单字体问题 → Web 用 `unicode-range` 子集化 |
| R3.10 | 自动更新 / 版本检查 | — |

---

## 7. R4 — 生成器（3–5 周）

| # | 任务 | 验收 |
|---|---|---|
| R4.1 | 移植搜索算法（`mutator` / `condition` / `variable` / `anim`，76 文件 / 5,091 行） | 与 Java 版在相同种子下产出同质结果 |
| R4.2 | 并行化：Web Worker 池 | 单核性能 ≥ Java 版 |
| R4.3 | 若性能不足，把热点下沉 WASM（Rust/AssemblyScript），接口不变 | 阈值：生成 1 个 7×7×7 反应堆 < 2 秒 |
| R4.4 | 生成过程 UI（进度 / 中间结果 / 中断） | — |
| R4.5 | 自定义生成脚本 | **R0 已确认无任何随附脚本或配置依赖 DSSL** → 建议**不移植 DSSL**，用 JS 沙箱替代。见 `rewrite-plan.md` §9 D5 |

**R4 的一个关键设计**：生成器**不调用编辑器的那套慢路径**，而是调用同一个内核的高性能入口。
R0 已证明旧实现是两套代码（`compile()` 只把内部方块搬进 lite 表示）；
新内核应提供 `simulateFast()` 与 `simulateVerbose()` 两个入口，**共用同一份物理**。

---

## 8. R5 — 迁移、打磨、发布（2–4 周）

| # | 任务 | 验收 |
|---|---|---|
| R5.1 | 中文语言包完整化 + 术语表（`SFR`/`MSR`/`Heatsink`/`Moderator`/`Flux`/`Casing`…） | 覆盖率 > 98% |
| R5.2 | 英文作为规范源；至少再一门语言验证「新增零代码」 | 新增语言只需加一个 JSON |
| R5.3 | PWA / 离线（Service Worker） | 断网可用 |
| R5.4 | **数据迁移指引**：旧格式导入（含 §2 D1 的修复后语义）→ 新格式导出 | 用户文档 |
| R5.5 | 发布流水线（CI → 静态站点 + 可选桌面壳） | 一键发布 |
| R5.6 | 与上游沟通（§2 D4） | — |

### 8.1 R2 / R3 实测补记（2026-10 验收）

计划的正文不改写（它是决策记录）；实测结论记在这里，细节见
`docs/r2/README.md` 与 `docs/r3/README.md`：

- **R2**：36 个 fixture、21 个 Java 金样本，TS **21/21 结构 + 指纹全等**，
  且 **36/36 全部读入**（其中 15 个是 Java 会抛异常的"按修复后语义"读取）。
  R2.1–R2.6、R2.8–R2.12 交付。
  - **R2.3 / R2.4**：v9→v1 九个 reader 已交付（45 项测试）。但必须记下**验证强度**：
    对仓库 git 历史里每一条 `*.ncpf` 路径的每个 blob 探测 `version`，历史中存在的是
    {1,2,5,8,10,11}——**v3、v4、v6、v7、v9 从未被提交过**；且已取得的 v1/v2/v5/v8
    样本上**冻结版 Java 自己全部抛 NPE**（v4 的 `loadConfiguration` 硬编码 `addon=false`，
    `settings` 模块永不创建），所以这九个文件没有金样本。
    它们的验收是"reader 选对 + 树被 R1 层接受 + `matches()` 负向对照 + 用同一 modpack 的
    v10 金样本交叉验证共享装载逻辑"；**所有九个样本都是 `count: 0`，因此任何设计/多联体
    解码路径都没有被数据跑过**。计划 §5 R2.3 原本就写了"需要真实样本"，本次把这件事做实了。
  - **R2.7 按计划允许的条款降级为 P2**（Hellrage MSR v1–v6 无样本）；
    SFR v5/v6 与 underhaul v2 顺带交付。
- **R3**：R3.1–R3.8 交付（100 项测试），主题 CSS **487 行**（门槛 < 500），
  构建体积 1.54 MB（门槛 15 MB）。
  - **R3.9 以"GL 里不画文字"的方式满足**：3D 视图只画无纹理立方体，
    文字一律 DOM 文本 + CSS 回退链，因此不需要字形图集；
  - **R3.10 未做**（计划验收栏为"—"，且没有更新服务可查）；
  - **路由不做**（决策）：应用只有一条路由，引入路由库与 §6 的意图相反。

---

## 9. 关键路径、里程碑与裁剪

### 9.1 关键路径

```
R1.0(a 确定性 + b/c 补齐黄金数据)
   ↓
R1.3 模型 ──→ R1.4 NCPF 读写
   ↓
R1.5 SFR 物理 ──→ 【M1 闸门】──→ R1.6 其余堆型
                      ↓
                  R2 兼容层 ∥ R3 UI ∥ R4 生成器
                      ↓
                  R5 发布
```

**唯一的关键路径是 R1.0 → R1.3 → R1.5 → M1。** R2/R3/R4 在 M1 之后可大范围并行。

### 9.2 里程碑

| 里程碑 | 内容 | 累计粗估 | 达成标志（可验证） |
|---|---|---|---|
| **M0** | R0 完成 | 已完成 | ✅ 黄金数据集 + 格式样本 + 迁移输入三件套 |
| **M1** | 内核可用 | +5–7 周 | SFR/Underhaul/MSR/Turbine 物理通过黄金数据集 |
| **M2** | 兼容层可用 | +2.5–4 周 | 19 个真实历史文件 + 8 个合成 fixture 按验收读入；NCPF 写出被 Java 读回 |
| **M3** | UI 可用 | +6–10 周 | 能完成「打开 → 画堆 → 计算 → 导出」全流程 |
| **M4** | 生成器可用 | +3–5 周 | 功能对齐；性能达标 |
| **M5** | 可发布 | +2–4 周 | 中文完整、PWA 可用 |

### 9.3 裁剪版（12–18 周，1 人）

按优先级砍（依据 R0 的实测价值判断）：

| 砍掉 | 依据 | 省 |
|---|---|---|
| Fusion（环形几何） | R0：不是 `CuboidalMultiblock`，需独立 harness | 2–3 周 |
| VR | `planner/vr` 2,773 行，D1 未提供使用证据 | 1 周 |
| DSSL 内嵌 IDE | R0：无任何随附脚本/配置依赖它 | 1 周 |
| 自定义主题 | `theme` 5,107 行 → 换 2–3 个内置主题 + CSS 变量 | 1 周 |
| Hellrage v1–v5 / MSR v1–v6 / LegacyNCPF v2–v8 | 无真实样本，无法验证 | 1–2 周 |
| 3D 视图延后到 M3 之后 | — | 1.5 周 |
| Distiller | R0：无随附配置 | 1 周 |

**保留的核心**：SFR ×2 + MSR 物理、NCPF 读写、LegacyNCPF v10/v11 读、Hellrage v6 读写、
中文 i18n、方块网格编辑器、生成器。

---

## 10. 风险登记册（按 R0 证据更新）

| # | 风险 | 等级 | R0 提供了什么证据 | 缓解 |
|---|---|---|---|---|
| R-1 | **物理移植出错** | 🔴 高 | 分歧集中在慢化剂连线/簇构建（`fuel_only` 零分歧）；真实设计差 6.78× | §3.4 的黄金测试 + **R1.5h 独立手算验证**（不可省）+ R1.5i 分歧区单独报告 |
| R-2 | **TS 表达力不足以复刻 Java 数值行为** | 🟡 中 | R1.0a 会量化（确定性测量） | M1 闸门；若卡住切 Kotlin（§3.3 备选），沉没成本 5–7 周 |
| R-3 | 兼容性丢失，老存档读不出 | 🔴 高 | 19 个真实历史文件已建立基线；`LegacyNCPF1Reader` 已确认坏 | §3.2 双层验收 + 「反向清单」明确哪些按修复后语义做 |
| R-4 | **把旧 bug 抄进新实现** | 🔴 高 | 4 条已确认产品 bug；真实设计上 `cooling` 差 6.78× | 两个 NCPF writer 语义分列；§3.1.5 规范化层；D1 明确「按修复后语义」 |
| R-5 | 生成器性能不如 JVM | 🟡 中 | 未测 | R4.2 Worker → R4.3 WASM；阈值明确 |
| R-6 | 上游继续演进 | 🟡 中 | R0 未复查 | D4：R1 前花 1–2 天复查 |
| R-7 | 长期无可用版本（19–31 周） | 🟡 中 | — | Java 版保持可发布；M2 后可先出 CLI |
| R-8 | 排期不确定性 | 🟡 中 | `port-audit.md` 是包级规则分类 | **R1.0d** 做文件级复核 |
| R-9 | 翻译质量参差 | 🟢 低 | 1,101 + 26 条草稿已就绪 | 术语表 + code review + CI 门禁 |
| R-10 | 一个人做不完 | 🔴 高 | — | §9.3 裁剪版；先做 SFR/MSR 闭环 |

---

## 11. 工程约定

### 11.1 仓库布局

```
nc-plannerator-ts/
├── packages/
│   ├── ncpf/       # 格式与数据模型（无 UI、无 IO）
│   ├── kernel/     # 物理内核（唯一实现；禁止 import UI）
│   ├── formats/    # reader / writer
│   ├── i18n/       # LocaleManager / MessageBundle / DataNameBundle
│   └── app/        # UI
├── lang/           # en_US.json（规范源）+ zh_CN.json + zh_CN.data.json
├── datasets/       # ← R0 产物（黄金数据集 / fixtures / 元素清单）
├── tools/          # ← R0 工具（保留，用于重生成基线）
└── docs/           # ← r0/** 与本文档
```

### 11.2 铁律（来自 R0 实测）

1. **物理只有一份实现**，编辑器与生成器共用（用 `simulateFast` / `simulateVerbose` 区分入口）。
2. **逻辑只用英文 canonical 或元素身份**，显示名只用于显示。
   引用配方**不用「配置内索引 + 结构相等」**（那正是 `matches()` bug 的来源）。
3. **i18n key 是稳定 ID**，不是英文原文；带参数的句子整体做 key，禁止拼接。
4. **缺 key 整条回退**，绝不半翻译。
5. **写要分两种语义**（保存 / 导出），不得混用。
6. **数据名身份键四段式**。
7. **新增语言零代码**。

### 11.3 CI 门禁

| 检查 | 阈值 |
|---|---|
| 单元测试 | 全绿 |
| 黄金数据集 | SFR/Underhaul/MSR/Turbine 通过率 100%（`error` 用例按 §3.1.4） |
| NCPF 往返指纹 | 38/38 |
| fixtures 读取 | §3.2 的「已验证可读」清单全部通过 |
| i18n 覆盖率 | 未翻译 key = 0；未使用 key = 0；冲突 key = 0 |
| 裸字符串 lint | 核心包 0 命中 |
| 构建体积 | 静态资源（不含数据集）< 15 MB |

### 11.4 与 R0 工具的关系

- **不删 `tools/`**。它是基线再生器：D1 若选了修复方案、或将来发现新的历史版本，
  都要用它重新生成数据集与 fixtures。
- 每次重新生成基线，**必须**更新 `docs/r0/golden-datasets.md` 里的「基线版本」记录
  （Java 提交号 + 种子 + 参数）。

---

## 12. 待决策清单（汇总）

| # | 决策 | 建议 | 阻塞什么 |
|---|---|---|---|
| **D1** | 4 个产品 bug 修不修（A 全不修 / B 修最重要的 2 个 / C 全修） | **B** | R1 消费 golden/fixtures 之前 |
| **D1b** | 若修，是否单独开 hotfix 分支给现有用户 | 建议是 | 与 D1 一起定 |
| **D2** | 兼容契约 C1–C4 确认；P0 表按真实验证状态重写 | 接受建议 | R2 的范围 |
| **D3** | 目标平台与分发形态 | Web + PWA | R3.1 |
| **D4** | 上游关系：彻底分叉 / 回推能力 / 采用 TWD 版 | **先花 1–2 天复查再定** | 可能影响整个 R1–R4 |
| **D5** | DSSL 是否移植 | 不移植 | R4.5 |
| **D6** | Fusion 是否做 | 裁剪版砍掉 | R1.6e |
| **D7** | Distiller 是否做（需先构建配置） | 砍掉或最后做 | R1.6d |
| **D8** | 裁剪版还是全量 | 1 人 → 裁剪版 | §9.3 |

---

## 附录 A：R0 产物 → 后续用途对照

| R0 产物 | 在 R1–R5 中的用途 |
|---|---|
| `datasets/golden/*.jsonl.gz` | §3.4 的物理测试；M1 闸门 |
| `datasets/ncpf-elements.jsonl` | §3.1.3 数据名身份键的权威清单；`DataNameBundle` 单测 |
| `datasets/fixtures/**` | §3.2 格式回归；每个 reader 一行覆盖记录 |
| `datasets/translations/legacy-translations.json` | R1.2f 的迁移输入 |
| `lang/*.draft.json` | R1.2f / R5.1 的语言包起点 |
| `docs/r0/port-audit.md` | R1.0d 文件级复核的起点；§9.3 裁剪依据 |
| `docs/r0/compat-contract.md` | R2 的范围定义；D2 |
| `docs/r0/findings.md` | §11.2 铁律的来源；R-4 风险的证据 |
| `docs/r0/format-roundtrip.md` | §3.2 写出层验收（38/38 指纹） |
| `docs/r0/*fixture*coverage*.md` | §3.2 读取层验收清单 |
| `tools/**` | 基线再生器（§11.4） |

## 附录 B：R0 未测、R1 需补的测量

| 项 | 为什么重要 | 任务 |
|---|---|---|
| Java 引擎逐次确定性 | 容差无法定死 | R1.0a |
| MSR/Turbine 的黄金数据 | R1.6 无法验收 | R1.0b / R1.0c |
| 文件级移植行数 | 排期 ±30% 不确定性 | R1.0d |
| 真实设计的统计意义分歧率 | 只有 2 个样本 | 投喂 `--from-ncpf` |
| 上游当前状态 | 可能影响整个方案 | D4 |
| 生成器性能基线 | R4 阈值是否可达 | R1 期间用 Java 版跑一次计时 |
