# R0.3 — 黄金数据集与编辑器/生成器分歧集

> 由 `tools/golden/golden.ps1` 生成，工具说明见 `tools/README.md`。
> 本文档记录**每个数据集的口径、结果与局限**。核心发现汇总见 `docs/r0/findings.md`。

---

## 1. 交付的数据集

| 文件 | 堆型 | 例数 | 种子 | 尺寸范围 | 引擎 |
|---|---|---:|---|---|---|
| `datasets/golden/sfr-cases.jsonl.gz` | Overhaul SFR | 5,000 | 20260101 | 内部 3–14 | 编辑器 + lite |
| `datasets/golden/usfr-cases.jsonl.gz` | Underhaul SFR | 5,000 | 20260101 | 内部 3–14 | 编辑器 + lite |

两者都覆盖全部 7 种填充策略：`random` `mixed` `fuel_mod` `fuel_only` `casing_only` `fuel_heatsink` `checker`。

### 记录格式（datasetVersion 2）

每行一个 JSON 对象；**第一行**是元数据。

```jsonc
{"id":"sfr-000003","type":"sfr","strategy":"checker","size":[6,12,8],
 "blockNames":["nuclearcraft:solid_fission_cell", ...],   // 索引 -> 方块模板名（语言无关）
 "recipeNames":["fuel=leu_235", ...],                     // 索引 -> 配方/燃料名
 "grid":[12,-1,3, ...],       // 展平索引 x*dimY*dimZ + y*dimZ + z；-1 = 空
 "recipes":[0,-1,...],        // 同上索引；-1 = 无配方
 "editor":{...所有数值字段...},   // ← 黄金值：用户看到的
 "lite":{...同名字段...},         // ← 生成器引擎；无 lite 引擎时为 null
 "divergence":{"totalFuelCells":[3,64], ...},  // ← 分歧集
 "error":"..."}               // 仅当编辑器引擎自己抛异常时出现，此时无 editor 统计
```

**相对 v1 的改进**：

1. 统计不再手工挑选，而是**反射取全部数值字段**（含 private）。因此数据集现在携带
   `numControllers` / `missingCasings` / `offOutput` 等有效性诊断字段，覆盖 TS 实现必须匹配的
   完整统计面。
2. 新增 `recipeNames` / `recipes`：v1 只记录方块，带配方的方块（燃料单元、辐照器、
   加热器）无法重建。现在可完整重建。
3. `error` 字段：编辑器引擎崩溃的用例被**显式记录**而不是静默丢弃。
4. 排除 `lastChangeTime`（`Multiblock.resetMetadata()` 写的挂钟时间戳）—— 它会让数据集
   不可复现。
5. 分歧比较改为「两引擎共有的全部数值字段」，不再限定 12 个字段。

---

## 2. 结果

### 2.1 Overhaul SFR

```
cases            : 5000
written          : 5000
failed           : 0
editor crashed   : 277   (5.5%)   ← 编辑器引擎直接抛 NPE
usable records   : 4723
productive       : 1390  (27.8%)
diverged         : 4703  (94.06%)
```

在 **4,723 条可用记录**里：

| 结果 | 例数 | 占比 |
|---|---:|---:|
| 两套引擎**完全一致** | **0** | **0%** |
| 仅 `shutdownFactor` 分歧 | 3,123 | 66.1% |
| **核心物理分歧** | **1,600** | **33.9%** |

按字段（占 5,000 例）：

| 字段 | 例数 | 占比 |
|---|---:|---:|
| `shutdownFactor` | 3,335 | 66.7% |
| `functionalBlocks` / `sparsityMult` | 1,568 | 31.4% |
| `netHeat` / `totalHeat` | 1,558 | 31.2% |
| `totalFuelCells` | 1,555 | 31.1% |
| `totalHeatMult` | 1,527 | 30.5% |
| `totalOutput` | 1,514 | 30.3% |
| `totalEfficiency` | 1,511 | 30.2% |
| `rawOutput` | 1,488 | 29.8% |
| `totalCooling` | 30 | 0.6% |
| `totalIrradiation` | 7 | 0.1% |

崩溃按策略分布：`mixed` 276、`random` 1。

### 2.2 Underhaul SFR

```
cases            : 5000
written          : 5000
failed           : 0
editor crashed   : 0
productive       : 4244  (84.9%)
diverged         : 2084  (41.68%)
```

按字段：

| 字段 | 例数 | 占比 |
|---|---:|---:|
| `netHeat` | 852 | 17.0% |
| `power` | 833 | 16.7% |
| `heat` | 810 | 16.2% |
| `efficiency` | 756 | 15.1% |
| `heatMult` | 756 | 15.1% |

**按策略——这一列信息量最大：**

| 策略 | 例数 | 分歧 | 分歧率 |
|---|---:|---:|---:|
| `fuel_only` | 725 | **0** | **0.0%** |
| `checker` | 676 | 155 | 22.9% |
| `fuel_mod` | 712 | 213 | 29.9% |
| `fuel_heatsink` | 717 | 304 | 42.4% |
| `random` | 688 | 313 | 45.5% |
| `mixed` | 727 | 344 | 47.3% |
| `casing_only` | 755 | 755 | 100.0% |

---

## 3. 这些数字说明什么

### 3.1 分歧不是随机噪声，而是结构性的

两个数据集都呈现同一个模式：**布局越均匀，两套引擎越一致；布局越混合，分歧越大。**

- Underhaul SFR 的 `fuel_only`（整个内部全是燃料单元）**725 例零分歧** —— 两套实现在这种
  极端简单布局上完全一致。
- 含慢化剂/散热器交错的策略（`mixed` / `random` / `fuel_heatsink`）分歧率 42–47%。
- 这与 Overhaul SFR 的观察一致（分歧集中在 `checker` / `fuel_mod` 这类燃料单元密集交错的堆型）。

**结论**：分歧集中在**慢化剂连线（moderator lines）与簇（cluster）构建**逻辑上 ——
正好是两份 `propogateNeutronFlux` 只有 24.4% 行相同的那个区域。
`fuel_only` 之所以零分歧，是因为它根本不触发连线逻辑。

这比"42.3% 分歧"这个单一数字更有说服力：它把分歧**定位到了一个具体的算法区域**，
也解释了为什么用户平时可能不会立刻发现（很多简单堆型是一致的）。

### 3.2 `casing_only` 的 100% 是平凡分歧

空反应堆（只有外壳、无内部方块）两引擎输出均为 0，分歧来自 `shutdownFactor`
（编辑器 NaN / 1.0，lite 0.0）以及 underhaul 的 `netHeat`。这是零除与未初始化的问题，
不是物理分歧。**统计时应把 `casing_only` 单列。**

### 3.3 编辑器引擎会崩溃（5.5%）

Overhaul SFR 有 277 例（5.5%）在编辑器引擎里直接抛 NPE，全部集中在含辐照器的 `mixed`
布局。原因是一个**缺失的 null 检查**，详见 `docs/r0/findings.md` §10。

这不影响数据集的可用性（这些用例被标记 `error`），但它是**必须不得在 TS 实现里复现**的行为。

---

## 4. 堆型支持矩阵

harness 通过 `Core.multiblockTypes` 里注册的模板用 `newInstance(conf, x, y, z)` 泛型创建堆型，
所以是否能跑取决于三件事：类型是否注册、配置里是否有它的 settings、是否是长方体网格。

| CLI `--type` | 堆型 | 注册 | 配置 | 长方体 | 双引擎 | 结论 |
|---|---|:--:|:--:|:--:|:--:|---|
| `sfr` | Overhaul SFR | ✅ | ✅ | ✅ | ✅ | **已产出 5,000 例** |
| `underhaul-sfr` | Underhaul SFR | ✅ | ✅ | ✅ | ✅ | **已产出 5,000 例** |
| `msr` | Overhaul MSR | ✅ | ✅ | ✅ | ❌ | 可运行，但通用填充造不出**可用**反应堆（`totalFuelVessels` 恒 0），统计全为 0，参考价值低 |
| `turbine` | Overhaul Turbine | ✅ | ✅ | ✅ | ❌ | 同上（叶片/定子/线圈需要特定排布） |
| `fusion` | Overhaul Fusion Reactor | ⚠️ 需 `fusion_test` 模块 | ⚠️ 模块自带配置 | ❌ **环形几何** | ❌ | 不是 `CuboidalMultiblock`，本 harness 无法构造 |
| `distiller` | Overhaul Distiller | ✅ | ❌ **无任何配置包含它** | ✅ | ❌ | 无法实例化（WIP 功能） |

`--list-types` 会列出全部类型；`fusion` / `distiller` 会打印明确的 `UNSUPPORTED` 原因并以退出码 3 结束。

**要让 MSR / Turbine 产出有价值的数据**，需要各自的专用构造器（MSR 需要连续燃料容器组 +
加热器配方；Turbine 需要叶片/定子/线圈排布）。这两类的 `getSuggestors()` 提供了现成的
「如何改进」逻辑，是构造可用反应堆的正路。

---

## 5. 复现

```powershell
# 首次需要编译应用类（约 1 分钟）
pwsh -File tools/golden/golden.ps1 -Type sfr -Cases 5000 -Seed 20260101 -MinSize 3 -MaxSize 14 `
     -Out datasets/golden/sfr-cases.jsonl

pwsh -File tools/golden/golden.ps1 -Type underhaul-sfr -Cases 5000 -Seed 20260101 -MinSize 3 -MaxSize 14 `
     -Out datasets/golden/usfr-cases.jsonl -SkipCompile

# 单例诊断（打印坐标探测、逐层 ASCII 图、两个引擎的统计）
pwsh -File tools/golden/golden.ps1 -Type sfr -Cases 1 -Diag -Strategies mixed -MinSize 5 -MaxSize 5 -SkipCompile
```

产品代码零改动，因此同一份源码 + 同一种子可重放出同一数据集。

---

## 6. TS 实现的验收口径

1. **`editor` 是黄金值** —— 用户看到的就是它。TS 实现必须匹配 `editor` 里的每一个字段。
2. **`lite` 是那份应当消失的第二实现**。`divergence` 记录了两者当前的差异；
   重写后 TS 只有一份物理，因此**不存在「与 lite 对拍」这一步** —— `divergence` 的用途是
   记录旧实现的内部不一致，作为「哪些区域最容易出错」的线索。
3. **`error` 的用例不得复现**。TS 实现遇到同样布局必须算出结果（或走显式校验失败路径），
   不能崩。
4. **浮点**：`"NaN"` / `"Infinity"` 以字符串表示；`shutdownFactor` 的 NaN 是旧实现缺陷，
   TS 侧应定义为 `[0,1]` 且零输出时为 0（见 `docs/r0/findings.md` §3）。
5. **重建反应堆**：`blockNames`/`recipeNames` + `grid`/`recipes` + `size` 足以完全重建方块网格，
   包括外壳。

---

## 7. 局限

1. **样本是随机方块网格**，很多物理上不合理（内部填满、无中子源、无结构）。分歧**比例**
   不能直接外推到手搭反应堆；但"同一份网格、两套引擎给出不同结果"与样本是否现实无关。
2. **没有真实用户设计样本**。要让分歧率真正可用于决策，需要一批社区 `.ncpf` 设计。
   harness 侧**已就绪**：`GoldenGen --from-ncpf <fileOrDir>` 会逐个求值工程文件里的设计，
   输出与生成器同格式的记录（`"strategy":"imported"`）。见 `tools/README.md` §3.1。
   实测有两个样本：
   - 对 `datasets/fixtures/` 里一个**结构化**的 underhaul SFR 设计，两套引擎只差 1
     （`power` 30959 vs 30960，相对差 3e-5）；
   - 对 `datasets/fixtures/historical/underhaul.json`（**2020 年真实存档的用户反应堆**），
     两套引擎的 `cooling` 相差 **6.78×**（720 vs 4880）、`netHeat` 相差 1.70×。

   即：分歧在真实手搭反应堆上确实存在，且可以很大；但它在**不同**设计上的表现差异极大
   （一个 3e-5，一个 6.78×），这进一步支持「分歧与具体布局强相关」的结论。
   要给出有统计意义的真实设计分歧率，需要更多存档。
3. **只覆盖 SFR 两型**（见 §4 的矩阵与原因）。
4. **填充策略是通用的**，不是每种堆型的自然构造方式。对 SFR 效果好，对其他类型不足。

---

# R1 更新（datasetVersion 3 + D1-B）

> 本节由 R1 追加。上面的 R0 内容保持原样，作为**当时**的实测记录。
> 基线记录以 `datasets/golden/BASELINE.md` 为准。

## 8. 为什么要升到 datasetVersion 3

R0 的数据集用 `NCPFElement.getName()` 记录模板，而它不是单射：
`nuclearcraft:solid_fission_sink` 有 16 个变体、`fission_reflector` 有 2 个
（反射率 1 vs 0.5），全部塌成同一个名字。用 v2 数据集重建时只能「按名字取第一个」，
600 例抽样里就有 3 例无法复现。

R1.0e 把命名换成 `NCPFElementDefinition.toString()`（`name[:metadata][blockstate]`），
并新增 meta 字段 `templateNaming` / `recipeNaming` 自描述。
详细分析见 **`docs/r1/r1.0-dataset-naming.md`**。

**物理中性已逐条验证**：同一 seed 重新生成后与 v2 对照
`editor diffs 0 · error diffs 0`（SFR 与 USFR 各 5000 例）。

## 9. D1-B：辐照器 NPE 修复后的重新生成

R0 刻意不修产品 bug。R1 按 §2 D1 的建议选了 B，并**只修了影响黄金覆盖率的那一条**：
`OverhaulSFR.java:1024` 的辐照器分支补上与姊妹分支相同的 `moderator != null` 守卫。

| | 修复前 | 修复后 |
|---|---:|---:|
| `editor crashed` | 277 | **0** |
| 可用记录 | 4,723 | **5,000** |
| `productive` | 1,390 | 1,433 |

对照验证：

```text
previously-crashing now computing: 277 ; still erroring: 0
editor identical: 4723 ; differing: 277      ← 277 条正是原先没有 editor 值的那批
```

即 4,723 条可用记录的 15 个数值字段**逐条不变**（修复只影响贴图装饰用的中间变量）。
修复前的数据保留为 `datasets/golden/sfr-cases.pre-d1.jsonl.gz`；
决策与未修项见 **`docs/r1/d1-decision.md`**。

## 10. 当前基线

| 文件 | 内容 |
|---|---|
| `sfr-cases.jsonl.gz` | Overhaul SFR ×5000，`datasetVersion 3`，**0 个 `error`** |
| `usfr-cases.jsonl.gz` | Underhaul SFR ×5000，`datasetVersion 3` |
| `sfr-cases.pre-d1.jsonl.gz` | 未修 NPE 的对照（277 个 `error`） |
| `*-cases.v2.jsonl.gz` | R0 原始版本（有损命名） |

TS 内核在这两个数据集上的验收结果见 `docs/r1/r1.5-kernel.md`
（SFR 5,000/5,000、USFR 5,000/5,000）。
