# R0 发现报告 — NC Plannerator 重写前置调研

> 目标技术栈：**TypeScript / Web**
> 本报告由 `tools/golden/golden.ps1`、`tools/golden/.../ElementDump`、
> `tools/i18n/*.ps1`、`tools/audit/port-audit.ps1` 的实测输出汇总而成。
> 所有数字来自**已冻结的 Java 版本**（工作区当前状态）。

---

## 0. 执行摘要

| # | 发现 | 影响 |
|---|---|---|
| **1** | **反应堆物理被实现了两遍，且实测在 42.3% 的样本上给出不同结果；双方都有意义输出时，中位差距 4.03×，最大 87.6×** | 决定重写的核心技术论据成立；新内核必须只有一份物理 |
| **1b** | Underhaul SFR 交叉验证：**41.68% 分歧**，但 `fuel_only` 布局 **725 例零分歧** —— 分歧集中在慢化剂连线/簇构建，不是均匀误差 | 把分歧**定位到具体算法区域**，比单一比例更有说服力 |
| **2** | 5000 例随机反应堆中**没有任何一例**两套引擎完全一致；连"零输出"这种平凡情形都因 `shutdownFactor` 不同而不一致（NaN vs 0.0） | 分歧不是边界情况，是常态 |
| **2b** | **真实存档的用户反应堆也分歧**：2020 年的 `underhaul.json` 上两套引擎的 `cooling` 相差 **6.78×**（720 vs 4880） | 分歧不是随机网格的产物，真实设计同样中招 |
| **3** | 编辑器的 `shutdownFactor` 可为 **NaN**（零输出时）甚至 **负值**（实测 13 例越界） | 现存 bug，重写时需定义为 `[0,1]` 且零输出时为 0 |
| **4** | 数据名的身份键 `type｜definition` **不唯一** —— 29 个键对应互相冲突的显示名；加上 `config/cfgType` 命名空间后冲突降为 0 | 修正重写方案 §4.4 的键设计 |
| **5** | 现有译文表**不是名称映射表，而是词片段替换表**：1185 条里只有 **31 条**能匹配到 NCPF 元素的完整英文名 | 这解释了为什么数据名翻译"看起来还行"而 UI 句子会破损 |
| **6** | 948 个 NCPF 元素显示名：完全翻译 310（32.7%）／中英混排 591（62.3%）／完全未翻译 47（5.0%）。其中混排多数是**刻意保留的化学/同位素记号**（`LEU-233 氟化物`），属可接受 | 数据名不是重写的主要痛点，UI 句子才是 |
| **7** | 译文表用 `LinkedHashMap.put`，同一英文 key 出现两次时**先出现的被静默丢弃**；57 个重复 key 中有 2 个译文互相冲突，即真的丢了一条翻译 | 现存 bug，且说明"英文原文当 key"的模型本身有缺陷 |
| **8** | 9 个文件同时包含物理计算与渲染代码，共 7,214 行 | 这是"物理与表现无法分离"的具体形状 |
| **9** | **`NCPFSettingsElement.matches()` 不满足自反性**（实测 `x.matches(x) == false`）。后果：含 Overhaul SFR 的工程**保存后再打开直接 NPE** | 现存产品 bug；R0 不修复（会破坏基线），修复要点已记录 |
| **10** | 项目里有**两个** NCPF writer，保真度不同：保存（全保真）vs 导出（`makePartial` + 裁剪 `plannerator:*`） | TS 侧必须分别实现，混用会静默损坏用户工程 |
| **11** | **编辑器物理在 5.5%（277/5000）的随机 Overhaul SFR 上直接 NPE** —— `OverhaulSFR.java:1024` 的辐照器分支漏了姐妹分支（1004 行）有的 null 检查 | 现存产品 bug；TS 实现不得复现 |
| **12** | **Overhaul 的 `.cfg`（NCConfig）导入路径完全不可用** —— reader 无条件给 `NCPFListElement`（`canHaveAmount()==false`）传数量，构建器直接抛异常。原本正确的 `getRecipeContainedAlternative()` **全代码库零调用**，是死代码 | 整条导入路径自 NCPF 重构以来就是死的，且无测试覆盖；Underhaul 同路径正常 |
| **13** | 用 git 历史里的**真实历史文件**（2020–2023，共 **19 个**）验证：**15 个读入成功**（v10 ×5、v11 ×9、Hellrage underhaul ×1）；`LegacyNCPF10/11Reader` 与 `UnderhaulHellrage2Reader` **首次被真实文件验证**；但 **`LegacyNCPF1Reader` 读不了真实 v1 文件**（NPE），Hellrage SFR v5 的真实存档也因显示名匹配失败 | P0 兼容性覆盖从「合成样本」升级为「真实文件」；同时暴露 v1 路径损坏 |

**结论**：R0 的产出支持继续重写，并把"单一物理内核 + 黄金数据集校验"从建议升级为**硬性前置条件**。

---

## 1. 方法：如何在没有 OpenGL 的情况下运行物理

这是 R0 的关键使能条件。两个现成的开关（都由已有代码提供，未修改任何产品代码）：

| 开关 | 位置 | 作用 |
|---|---|---|
| `-Dplannerator.skipTextures=true` | `planner/ncpf/module/TextureModule.java:19` | `convertFromObject` 提前返回，跳过 base64 PNG 解码。NCPF 配置约 10 MB，**几乎全是贴图载荷**，所以这一步让配置可以脱离 GL 加载 |
| `Main.isBot = true` | `planner/Core.java:869,875,881` | `Core.warning/error/criticalError` 在解引用 `Core.gui`（headless 下为 null）**之前**就 return |

启动顺序沿用 `MenuInit`，到"加载配置并应用"为止，不碰窗口：

```
Core.resetMetadata()
FileReader.formats.add(new NCPFReader())
Core.modules.add(new CoreModule())      // 默认 active
Core.modules.add(new UnderhaulModule()) // 默认 active
Core.modules.add(new OverhaulModule())  // 默认 active
Core.refreshModules()                   // classgraph 扫描注册
Configuration.initNuclearcraftConfiguration()
Core.setConfiguration(Configuration.NUCLEARCRAFT)
```

因为模块注册走 classgraph（纯反射，无 GL），整个 bootstrap 在 **无显示环境**下可跑通。实测通过。

编辑器侧的计算流程严格对齐 `Multiblock.recalculate()`：

```java
forceRescan = true;
List<T> blox = getBlocks();
clearData(blox);
validate();
calculate(blox);
```

即 `harness: sfr.clearCaches(); sfr.recalculate();` —— **不是**自己拼一条计算流程。

---

## 2. 发现 1+2：两套物理引擎在 42.3% 的样本上给出不同结果

### 2.1 采样方法

| 项 | 值 |
|---|---|
| 样本数 | **5,000** |
| 堆型 | Overhaul SFR |
| 尺寸 | 内部 3×3×3 … 14×14×14（配置允许 1…24） |
| 外壳 | `buildDefaultCasing()`（含控制器、通风口、端口、边角外壳） |
| 内部填充策略 | `random` / `mixed` / `fuel_mod` / `fuel_only` / `fuel_heatsink` / `checker` / `casing_only` |
| 燃料 | 从该方块可用燃料中随机 |
| 种子 | 20260101（可复现） |
| 对比字段 | `totalFuelCells, rawOutput, totalOutput, totalCooling, totalHeat, netHeat, totalEfficiency, totalHeatMult, totalIrradiation, functionalBlocks, sparsityMult, shutdownFactor` |

同一份方块网格分别喂给：

- **编辑器引擎** `OverhaulSFR` → `recalculate()`
- **生成器引擎** `OverhaulSFR.compile()` → `LiteOverhaulSFR.calculate()`

`compile()` 的实现（`OverhaulSFR.java:1851`）只把**内部**方块搬进 lite 表示（外壳隐含假定为完整）：

```java
public LiteOverhaulSFR compile(){
    LiteOverhaulSFR sfr = new LiteOverhaulSFR(CompiledOverhaulSFRConfiguration.compile(getSpecificConfiguration()));
    sfr.importAndConvert(this);   // 仅 forEachInternalPosition
    return sfr;
}
```

### 2.2 结果

| 结果 | 例数 | 占比 |
|---|---:|---:|
| **完全一致** | **0** | **0.00%** |
| 仅 `shutdownFactor` 分歧 | 2,885 | 57.7% |
| **核心物理分歧** | **2,115** | **42.3%** |

按字段统计（5000 例中受影响的例数）：

| 字段 | 受影响例数 | 占比 |
|---|---:|---:|
| `shutdownFactor` | 3,378 | 67.6% |
| `functionalBlocks` | 2,089 | 41.8% |
| `sparsityMult` | 2,089 | 41.8% |
| `totalFuelCells` | 2,077 | 41.5% |
| `totalHeat` | 2,077 | 41.5% |
| `netHeat` | 2,077 | 41.5% |
| `totalOutput` | 2,028 | 40.6% |
| `totalEfficiency` | 2,020 | 40.4% |
| `rawOutput` | 1,993 | 39.9% |
| `totalHeatMult` | 1,991 | 39.8% |
| `totalIrradiation` | 465 | 9.3% |
| `totalCooling` | 458 | 9.2% |

### 2.3 核心物理分歧的严重程度

把 2,115 例核心分歧再细分：

| 情形 | 例数 |
|---|---:|
| 双方输出都为 0（仅其它字段不同） | 25 |
| 一方为 0、另一方非 0 | 268 |
| 一方为极小值（浮点下溢，<1） | 42 |
| **双方都有量级意义的输出（≥1）** | **1,780** |

对这 1,780 例计算 `max/min` 差距倍数：

- **中位差距：4.03×**
- 超过 2× 的：**1,444 / 1,780（81.1%）**
- 最大：**87.56×**（`sfr-004893`，7×11×10，checker 策略：编辑器 90.97 vs 生成器 7,965.19）

差距最大的 8 例：

| 用例 | 尺寸 | 策略 | 编辑器输出 | 生成器输出 | 倍数 |
|---|---|---|---:|---:|---:|
| `sfr-004893` | 7×11×10 | checker | 90.97 | 7,965.19 | 87.6× |
| `sfr-002944` | 10×8×10 | checker | 105.65 | 8,127.71 | 76.9× |
| `sfr-001160` | 5×16×14 | checker | 132.21 | 10,038.24 | 75.9× |
| `sfr-003014` | 9×10×8 | checker | 104.79 | 7,912.83 | 75.5× |
| `sfr-004257` | 7×16×7 | checker | 82.89 | 5,891.27 | 71.1× |
| `sfr-003655` | 12×6×14 | checker | 167.43 | 11,637.79 | 69.5× |
| `sfr-002089` | 7×9×12 | checker | 179.49 | 11,735.15 | 65.4× |
| `sfr-002701` | 11×8×6 | fuel_mod | 12.00 | 738.99 | 61.6× |

**分歧集中在 `checker` 与 `fuel_mod` 这类"燃料单元密集交错"的堆型** —— 也就是 `propogateNeutronFlux` / 簇构建 / 慢化剂连线逻辑（两份实现只有 24.4% 的行相同）所在的地方。`random`/`casing_only`/`fuel_heatsink`/`fuel_only` 多数只分歧在 `shutdownFactor`。

### 2.3b 交叉验证：Underhaul SFR（第二个双引擎堆型）

把 harness 泛化后对 **Underhaul SFR** 跑同一套 5,000 例（同种子、同尺寸范围、同策略）：

```
written        : 5000
editor crashed : 0
productive     : 4244  (84.9%)
diverged       : 2084  (41.68%)
```

按字段：`netHeat` 17.0%、`power` 16.7%、`heat` 16.2%、`efficiency` 15.1%、`heatMult` 15.1%。

**按策略——这一列把分歧的位置钉住了：**

| 策略 | 例数 | 分歧 | 分歧率 |
|---|---:|---:|---:|
| `fuel_only` | 725 | **0** | **0.0%** |
| `checker` | 676 | 155 | 22.9% |
| `fuel_mod` | 712 | 213 | 29.9% |
| `fuel_heatsink` | 717 | 304 | 42.4% |
| `random` | 688 | 313 | 45.5% |
| `mixed` | 727 | 344 | 47.3% |
| `casing_only` | 755 | 755 | 100.0%（平凡：零除/未初始化，非物理分歧） |

**这比单一分歧率更有说服力**：

1. 满内部燃料单元的 `fuel_only` **725 例零分歧** —— 两套实现在不触发连线逻辑的布局上完全一致；
2. 含慢化剂/散热器交错的布局分歧率 42–47%；
3. 与 Overhaul SFR 的观察一致（分歧集中在 `checker` / `fuel_mod`）。

**即：分歧不是一个均匀分布的误差，而是集中在「慢化剂连线 + 簇构建」这个具体算法区域。**
这也解释了为什么用户平时未必立刻察觉 —— 简单堆型是一致的。

### 2.3c 【最强证据】真实存档的用户反应堆也分歧

前面所有分歧率都来自**随机网格**。用 `GoldenGen --from-ncpf` 跑 2020 年真实存档里的一个
Hellrage underhaul 设计（`datasets/fixtures/historical/underhaul.json`，来自本仓库 git 历史）时：

```
DIVERGENCE underhaul.json#1 (underhaul-sfr) -> ["cooling":[720,4880], "netHeat":[10080,5920]]
```

| 字段 | 编辑器引擎 | 生成器引擎 | 倍数 |
|---|---:|---:|---:|
| `cooling` | 720 | 4,880 | **6.78×** |
| `netHeat` | 10,080 | 5,920 | 1.70× |

**这是真实用户当年设计并保存的反应堆**，不是随机生成的网格。两套引擎对它的散热能力判断相差近 7 倍。

这消除了 §2.5 里那条方法学保留意见的一半 —— 「分歧比例不能外推到手搭反应堆」仍然成立
（只有一个样本），但「分歧在手搭反应堆上同样存在、且可以很大」现在是**实测事实**。

> 注：该文件是 Hellrage 格式（`.json`），`--from-ncpf` 现在也接受 `.json`，
> 因为设计归档通常在 Hellrage 文件里。

### 2.4 用户可见的含义

编辑器里显示的功率/热量/效率，和"生成器优化时用的目标函数"，来自两套代码。**当用户点"生成"得到一个反应堆，编辑器告诉他的输出可能只有生成器认为的 1/4（中位情况），极端情况差 87 倍。**

另外：Overhaul SFR 有 **5.5% 的随机布局会让编辑器引擎直接抛 NPE**（见 §10）。

### 2.5 方法学局限（必须说明）

生成的样本是**随机的方块网格**，很多在物理上不合理（内部填满、无中子源、无结构）。因此：

- 「42.3%」这个比例**不能直接外推到手搭反应堆**。
- 但「同一份方块网格、两套引擎给出中位 4× 的差异」这一事实**与样本是否现实无关** —— 物理应当是输入的函数，不该取决于哪份实现。
- **待补**：用真实用户 `.ncpf` 设计重跑同一套 harness。这是 R0.3 的收尾项，需要一个真实设计样本库（可从社区/issue 附件收集）。

---

## 3. 发现 3：`shutdownFactor` 的两个现存缺陷

### 3.1 零输出时为 NaN

`OverhaulSFR.java:945`：

```java
shutdownFactor = 1-(offOutput/totalOutput);
```

当 `totalOutput == 0` 时是 `1 - (0/0)` = **NaN**。实测 5,000 例中有 3,382 例（67.6%）属于这一类（含零输出堆）。同一情形下 lite 引擎给出 `0.0`。

编辑器工具提示会把它渲染成 `Shutdown Factor: NaN%`（`OverhaulSFR.java:1186` 用 `MathUtil.percent(shutdownFactor, 2)`）。

### 3.2 可以为负 / 大于 1

实测 **13 例** `shutdownFactor` 落在 `[0,1]` 之外。例如 `sfr-000007`：

```
editor shutdownFactor = -0.31397545
lite   shutdownFactor =  0.0
```

即 `offOutput > totalOutput` 时得到负值。这个量在语义上应是 `[0,1]` 的比例。

**重写要求**：`shutdownFactor` 定义为 `[0,1]`，且 `totalOutput == 0` 时为 `0`。黄金数据集需要同时记录**旧实现的原值**与**规范化后的值**，以便 TS 侧对拍。

---

## 4. 发现 4：数据名的身份键必须加配置命名空间

重写方案 §4.4 原建议以 `definition.type + "|" + definition.toString()` 作为 `DataNameBundle` 的键。实测**不够**：

| 键的形式 | 去重后键数 | 显示名冲突的键数 | 结论 |
|---|---:|---:|---|
| `type｜definition` | 660 | **29** | ❌ 不可用 |
| `config/cfgType/type｜definition` | 732 | **0** | ✅ 可用 |

冲突实例（同一个 legacy_item 名称在不同配置下代表不同物品）：

```
identity: legacy_item|nuclearcraft:fuel_americium:2
    'HEA-242'            <- Underhaul SFR Configuration
    'LEA-242 Nitride'    <- Overhaul SFR Configuration

identity: legacy_item|nuclearcraft:fuel_californium:5
    'HECf-249 Oxide'     <- Overhaul SFR Configuration
    'LECf-251 Oxide'     <- Underhaul SFR Configuration
```

**修正**：`DataNameBundle` 的键采用四段式

```
<config>/<cfgType>/<definition.type>|<definition.toString()>
```

加上命名空间后仍有 108 个键"碰撞"，但碰撞方的显示名**完全一致**（同一元素出现在多个元素列表中，例如全局元素与配置元素），可安全合并。

---

## 5. 发现 5+6：现有译文表是"词片段表"，不是名称映射表

### 5.1 只有 31 条能匹配元素完整英文名

把 1185 条译文与 NCPF 元素的英文名（含 `legacy_names`，去重后 1,379 个）做**精确匹配**：

| 归类 | 翻译对数 |
|---|---:|
| 命中 NCPF 元素完整英文名（→ 数据名） | **31** |
| 其余（→ UI 文案候选） | 1,154 |

只有 31 条！说明这张表**几乎从不以完整元素名作为 key**。它的工作方式是：把 `"Solid Fission Controller"` 里的 `"Controller"` 之类的**词片段**替换掉。

这解释了为什么数据名的翻译"看起来还行"：元素名大多是 `[不可译记号] + [可译词]` 的结构，逐词替换恰好能工作。

### 5.2 948 个元素显示名的实测翻译状态

| 状态 | 元素数 | 占比 |
|---|---:|---:|
| 完全翻译（无残留拉丁字母） | 310 | 32.7% |
| 中英混排 | 591 | 62.3% |
| 完全未翻译 | 47 | 5.0% |

⚠️ **重要区分**：这 591 个"混排"里，绝大多数是**刻意保留的化学/同位素记号**，属于正确行为，不是 bug：

```
Ra-Be Neutron Source  ==>  Ra-Be 中子源          （同位素记号保留，正确）
Cf-252 Neutron Source ==>  Cf-252 中子源         （正确）
LEU-233 Fluoride      ==>  LEU-233 氟化物         （正确）
TBU Fluoride          ==>  TBU 氟化物             （正确）
```

完全未翻译的 47 个也基本是纯记号（`MF4-239`、`TBU`、`LEU-233`）——本来就无可译内容。

**结论修正**：数据名的中文化现状**基本可用**；重写的主要收益不在这里。
真正破损的是 **UI 句子**（见 `docs/i18n-audit-baseline.txt`）：

```
Standard editor only supports one cursor!   ==>  标准 editor only supports one cursor!
Failed to load NuclearCraft configuration!  ==>  失败 to load NuclearCraft configuration!
Error opening menu!                         ==>  错误 opening menu!
Label cannot be null!                       ==>  Label cannot be 空值!
Dropped File Loading Thread                 ==>  Dropped 文件 正在加载 线程
```

这是"子串替换 + 英文原文当 key"在面对**带语序/语法的句子**时必然的失败。这类文案在 `planner/gui`、`planner/module`、`multiblock`、`discord` 四个包中共有 1,029 条，其中 39.8% 完全未翻译、20.9% 混排。

---

## 6. 发现 7：译文表自身会静默丢翻译

`SimplifiedChineseLocalizer.add()`：

```java
private static void add(Map<String, String> translations, String... values){
    for(int i = 0; i<values.length; i += 2)translations.put(values[i], values[i+1]);
}
```

用的是 `Map.put`（`LinkedHashMap`），所以**同一英文 key 出现两次时，后出现的覆盖先出现的**。

实测 1,185 条中：

- 重复 key：**57 个**
- 其中译文互相冲突（即真的丢了一条翻译）：**2 个**

| 英文 key | 两个译文 | 实际生效 |
|---|---|---|
| ` AND ` | `且` / `和` | 只有 `和` |
| `Active` | `已启用` / `运行中` | 只有 `运行中` |

其余 55 个重复项译文相同，无影响。

影响不大，但它精确地暴露了"用英文原文当 key"这个模型的根本缺陷：**同一个英文串在不同上下文需要不同译文时，这个模型无处表达。**

---

## 7. 发现 8：物理与渲染同居的 9 个文件

| 行数 | 文件 |
|---:|---|
| 1,878 | `multiblock/overhaul/fissionsfr/OverhaulSFR.java` |
| 2,076 | `multiblock/overhaul/fissionmsr/OverhaulMSR.java` |
| 902 | `multiblock/overhaul/turbine/OverhaulTurbine.java` |
| 879 | `multiblock/overhaul/fusion/OverhaulFusionReactor.java` |
| 549 | `multiblock/underhaul/fissionsfr/UnderhaulSFR.java` |
| ~略 | 其余 4 个 |

共 **9 文件 / 7,214 行**同时含物理计算与 `Renderer`/`draw` 调用。这是"必须推倒重来"的具体形状 —— 没有安全切口能把物理单独摘出来加测试。

---

## 8. 发现 9：`matches()` 不满足自反性 —— 保存的工程打不开（R0.4 发现，严重）

R0.4 在生成格式 fixtures 时撞到并定位了一个**产品 bug**。

### 8.1 现象

用应用自己的保存路径（`NCPFFileWriter`，`Core.java:611`）写出一个含 Overhaul SFR 的工程，
再读回来：

```
write -> 352.9 KB, coolant_recipe: -1
read  -> NullPointerException:
         Cannot invoke "NCPFElement.copyTo(Supplier)"
         because "this.definition.coolantRecipe" is null
```

### 8.2 决定性证据：自反性

```
sfr.coolantRecipe.definition.matches(itself) = false
```

**一个相等性判定对自身返回 false**，必然是 bug。

### 8.3 原因（`NCPFSettingsElement.java:186-210`）

`matches()` 的 `Set` 分支假设集合元素是 `NCPFElementDefinition`：

```java
Set s1 = (Set)val1;                       // 实际是 HashSet<NCPFElementStack>
...
for(Object elem1 : s1){
    for(Object elem1Again : s1){
        if(elem1 instanceof NCPFElementDefinition && elem1Again instanceof NCPFElementDefinition){
            if(((NCPFElementDefinition)elem1).matches((NCPFElementDefinition)elem1Again))count1++;
        }else
            equal = false;                // <-- 对 NCPFElementStack 恒定命中
    }
}
```

而 `NCPFLegacyRecipeElement.inputs/outputs` 是 `HashSet<NCPFElementStack>`，
且 `NCPFElementStack extends DefinedNCPFModularObject` —— **不是** `NCPFElementDefinition`。
于是只要 `inputs` 或 `outputs` 非空，`matches` 就恒为 `false`：**对每一个真实配方都失败**。

### 8.4 传导路径

```
NCPFObject.setIndex("coolant_recipe", recipe, config.coolantRecipes)
  → indexof(recipe, list): for(...) if(list.get(i).definition.matches(recipe.definition)) return i;
  → 全部 false → 写入 -1
  → 读回时 getIndex(...) 因 index == -1 返回 null
  → OverhaulSFRDesign.convertFromObject:42  definition.coolantRecipe.copyTo(...) → NPE
```

**用户可见后果：保存一个含 Overhaul SFR 的工程后再打开，直接崩溃。**

### 8.5 对照组（证明格式机制本身没问题）

用 Underhaul SFR 做对照：它没有 coolant recipe，配方索引走 `legacy_item`（name 型设置，
不触发 `Set` 分支）。结果 **3/6 格式端到端往返，内部方块指纹完全一致**：

| 格式 | Overhaul SFR | Underhaul SFR（对照） |
|---|---|---|
| `NCPFFileWriter`（保存） | ❌ NPE | ✅ |
| `NCPFWriter`（导出） | ❌ NPE | ✅ |
| `LegacyNCPFWriter` | ❌ NPE | ✅ |
| `HellrageWriter` | ❌ `Invalid fuel name: MOX-241!` | ❌ `Invalid block name: !` |
| `BGStringWriter` | ❌ 无法表达 oredict 方块 | ❌ 同 |
| `PNGWriter` | ❌ 需要 GL | ❌ 同 |

所以：**NCPF / Legacy NCPF 的读写机制是健全的**，问题被精确隔离在「配方元素的结构相等判定」上。

### 8.6 Hellrage 的独立问题：同样把显示名当标识符

`HellrageWriter` 用**剥离词缀后的显示名**作为方块名/燃料名
（`HellrageWriter.java:63,112,126,140,154`，如 `StringUtil.superRemove(b.getDisplayName(), " ", "HeatSink", "Sink", ...)`）。
读回时 `NonRecoveryHandler.recoverFallbackName()` 拿这个名字去比对
`LegacyNamesModule.legacyNames`，匹配不上就抛 `Invalid <type> name: <name>!`。

两个症状都是同一个根因：
- Overhaul：`Invalid fuel name: MOX-241!`
- Underhaul：`Invalid block name: !`（剥离后变成空串）

**writer 没有使用本来正确的身份通道（`legacyNames`）** —— 这正是重写方案 §2 根因 5 的又一实例。

### 8.7 R0 的处理方式

**不修复。** R0 的目的是冻结 Java 版并记录基线；改产品代码会让 golden/fixture 失去可比性。
修复要点已记录在 `docs/r0/fixtures.md`，可作为**独立改动**，或在 TS 实现里自然消失
（TS 侧不应使用「配置内索引 + 结构相等」来表示配方引用，直接写元素身份即可）。

---

## 9. 发现 10：项目里有**两个** NCPF writer，保真度不同（R0.4）

对 **38 个随仓库发布的 `*.ncpf.json`（18.7 MB 生产语料）** 做 read → write → read 往返：

| writer | 用在哪 | 行为 | 往返结果 |
|---|---|---|---|
| `NCPFFileWriter`（`Core.java:611`） | **用户保存工程** | `project.convertToObject()` 后直接写，**不裁剪任何模块** | **38 / 38 指纹完全一致** ✅ |
| `NCPFWriter`（`FileWriter.NCPF`，`MenuMain:316-320`） | **导出单个多方块** | 先 `ncpf.makePartial()`（只保留被设计引用到的元素），再 `trimPlanneratorModules()`（**删掉所有非 `ncpf:` 前缀模块** → `plannerator:display_name` / `texture` / `legacy_names` 全丢） | 配置类文件无设计 → 元素被全部剥离（设计如此） |

**含义**：NCPF 格式本身是保真的（这是好消息，重写的数据层风险确实低）。但 **TS 侧必须显式实现两种语义**，
不能混用 —— 否则要么用户保存的工程丢显示名/贴图，要么导出的多方块文件臃肿。

另：`fusion_test.ncpf.json` 随仓库发布，但它的 `fusion_test` 模块**默认不激活**，
因此**默认安装无法读取该文件**。激活模块后 38/38 全部通过。这一点需在 TS 侧复刻（模块激活状态影响可读性）。

完整逐文件结果见 `docs/r0/format-roundtrip.md`。

---

## 10. 发现 11：编辑器物理在 5.5% 的随机 Overhaul SFR 上直接 NPE（R0.3 发现）

把 harness 泛化到多个堆型后，Overhaul SFR 的 5,000 例里有 **277 例（5.5%）编辑器引擎自己抛异常**：

```
java.lang.NullPointerException: Cannot read field "flux" because
  "...OverhaulSFR.getBlock(BlockPos).template.moderator" is null
    at OverhaulSFR.propogateNeutronFlux(OverhaulSFR.java:1024)
    at OverhaulSFR.doCalculationStep(OverhaulSFR.java:290)
    at Multiblock.calculate(Multiblock.java:125)
```

崩溃全部集中在含辐照器的 `mixed` 布局（`mixed` 276 例、`random` 1 例）。

### 10.1 原因：辐照器分支漏了姐妹分支有的 null 检查

`OverhaulSFR.java:1017-1029`（辐照器分支）：

```java
if(block.isIrradiator()){
    if(length==0)break;
    if(block.irradiatorRecipe==null)break;
    ...
    for(int j = 1; j<i; j++){
        f += getBlock(that.pos.offset(d,j)).template.moderator.flux;   // ← 无保护，NPE
        ...
    }
}
```

紧邻的**反射器**分支（`OverhaulSFR.java:1002-1012`）写法正确：

```java
for(int j = 1; j<i; j++){
    Block b = getBlock(that.pos.offset(d,j));
    if(b.template.moderator!=null)f += b.template.moderator.flux;      // ← 有保护
    ...
}
```

循环 `for(j = 1; j<i; j++)` 走过源与目标之间的**每一个**位置，却假设它们都是慢化剂。
只要连线上出现非慢化剂方块（辐照器、散热器、空气、外壳……）就崩。

### 10.2 R0 的处理方式

**不修复**（同 §8，冻结基线）。用例以 `"error"` 字段记入数据集，
`docs/r0/golden-datasets.md` 明确要求 **TS 实现不得复现这个崩溃**。

---

## 11. 发现 12：Overhaul 的 `.cfg`（NCConfig）导入路径完全不可用（R0.4 发现）

R0.4 为两个 NCConfig reader 合成了完整的 `.cfg` fixture，结果一边通、一边死：

| fixture | reader | 结果 |
|---|---|---|
| `ncconfig-underhaul.cfg` | `UnderhaulNCConfigReader` | ✅ 读出 90 个元素，配置名 `Underhaul SFR Configuration` |
| `ncconfig-overhaul.cfg` | `OverhaulNCConfigReader` | ❌ `IllegalArgumentException: Cannot create an element stack, with an amount, using a definition that cannot have an amount!` |

### 11.1 原因：给「不可带数量」的定义传了数量

`OverhaulNCConfigReader.java:129-131`（**无条件三行**）：

```java
builder.irradiatorRecipe(new NCPFListElement(new NCPFOredictElement("ingotThorium"), new NCPFOredictElement("dustThorium")),
                         "Thorium", "overhaul/item/thorium_ingust", dustTBP, ...);
```

`OverhaulSFRConfigurationBuilder.java:188`：

```java
recipe.getRecipeDefinition().inputs.add(new NCPFElementStack(definition, 1));
```

而 `NCPFListElement.canHaveAmount()` 返回 **`false`**（`NCPFListElement.java:27-29`），
`NCPFElementStack(definition, amount)` 在 `amount` 存在时检查该标志并抛异常（`NCPFElementStack.java:13-14`）：

```java
public NCPFElementStack(NCPFElementDefinition definition, int amount){
    if(!definition.canHaveAmount())throw new IllegalArgumentException(
        "Cannot create an element stack, with an amount, using a definition that cannot have an amount!");
```

### 11.2 本来有正确的机制，但从未被调用

`NCPFElementDefinition.getRecipeContainedAlternative()` 就是为此存在的
（`NCPFListElement` 覆盖它返回 `NCPFStackListElement`，后者可以带数量）：

```java
// NCPFListElement.java:30-33
@Override
public NCPFElementDefinition getRecipeContainedAlternative(){
    return new NCPFStackListElement();
}
```

**实测：全代码库中 `getRecipeContainedAlternative()` 没有任何调用点。** 它是死代码。
构建器直接把定义塞进带数量的构造函数，于是遇到 list 定义就崩。

同一模式还出现在：
- `OverhaulMSRConfigurationBuilder.java:194-195`（MSR 辐照器配方，同一个 reader 也会走到）
- `MenuElementConfiguration.java:98`（`new NCPFElementStack(elem, 1)`）—— 配置编辑器里若用户为
  list 型元素添加带数量的堆叠，也会崩

### 11.3 影响

`OverhaulNCConfigReader` 的第 129-131 行在执行流上**无条件**（前面 128 行都是无分支的构建语句），
因此**任何** overhaul `nuclearcraft.cfg` 都读不进来。这条导入路径（NuclearCraft 2.x 的模组配置
→ 规划器配置）自 NCPF 重构以来就不可用，且没有测试会发现它。

对照：Underhaul 的同类 reader 不构造 list 型的辐照器输入，因此完全正常。

### 11.4 R0 的处理方式

**不修复**（冻结基线）。fixture 本身是完整的、留作兼容性语料；
`docs/r0/fixtures-ncconfig.md` 记录了完整诊断，TS 实现应**按修复后的语义**实现
（用 `getRecipeContainedAlternative()` 或直接让 list 定义可带数量），而不是复刻这个崩溃。

---

## 12. 发现 13：用**真实历史文件**验证后的结果（R0.4 发现）

前一节之前的 fixture 都是「用当前 writer 写出、再用当前 reader 读回」，无法覆盖版本多样性。
后来发现**本仓库自己的 git 历史里就有真实的历史文件** —— 那些文件是当时的软件自己写出来的，
因此是非循环的真实样本。

`tools/golden/historical-fixtures.ps1` 从 git 历史提取了 **19 个**（2020–2023），
来源与提交号记录在 `datasets/fixtures/historical/MANIFEST.txt`。

### 12.1 结果（`docs/r0/historical-fixtures.md`）

19 个文件里 **15 个读入成功**，4 个失败：

| 文件 | 年份 | 命中的 reader | 结果 |
|---|---|---|---|
| `extreme_reactors.ncpf` | 2021 | **LegacyNCPF10Reader** | ✅ 2 元素 |
| `trinity.ncpf` | 2021 | **LegacyNCPF10Reader** | ✅ 4 元素 |
| `ic2.ncpf` | 2021 | **LegacyNCPF10Reader** | ✅ 86 元素 |
| `po3.ncpf` | 2021 | **LegacyNCPF10Reader** | ✅ 91 元素 |
| `e2e.ncpf` | 2021 | **LegacyNCPF10Reader** | ✅ 94 元素 |
| `alloy_heat_sinks.ncpf` | 2021 | LegacyNCPF11Reader | ✅ 44 元素 |
| `inert_matrix_fuels.ncpf` | 2021 | LegacyNCPF11Reader | ✅ 83 元素 |
| `spicy_heat_sinks_stable.ncpf` | 2021 | LegacyNCPF11Reader | ✅ 86 元素 |
| `qmd.ncpf` | 2023 | LegacyNCPF11Reader | ✅ 94 元素 |
| `moar_fuels.ncpf` | 2021 | LegacyNCPF11Reader | ✅ 116 元素 |
| `moar_heat_sinks.ncpf` | 2021 | LegacyNCPF11Reader | ✅ 246 元素 |
| `quanta.ncpf` | 2022 | LegacyNCPF11Reader | ✅ 529 元素 |
| `nuclearcraft.ncpf` | 2022 | LegacyNCPF11Reader | ✅ 606 元素 |
| `aapn.ncpf` | 2021 | LegacyNCPF11Reader | ✅ 622 元素 |
| **`underhaul.json`** | **2020** | **UnderhaulHellrage2Reader** | ✅ **1 个设计**，且两套引擎对它分歧 **6.78×（cooling）** —— 见 §2.3c |
| `fusion_test.ncpf` | 2021 | LegacyNCPF11Reader | ❌ `UnknownNCPFModule` CCE（该文件需要 `fusion_test` 模块激活，与 §9 同类） |
| **`asdf.ncpf`** | **2020** | **LegacyNCPF1Reader** | ❌ NPE |
| **`qwerty.ncpf`** | **2020** | **LegacyNCPF1Reader** | ❌ NPE |
| **`overhaul.json`** | **2020** | **OverhaulHellrageSFR5Reader** | ❌ `Invalid block name: Cf-252!` |

**收获 1：`LegacyNCPF10Reader` 与 `LegacyNCPF11Reader` 用真实文件验证通过** ——
这是兼容性契约里的 P0 项，此前只有合成样本（`docs/r0/compat-contract.md` §2.1）。
版本派发也正确：每个文件只被**对应版本**的 reader 命中。

### 12.2 新发现：`LegacyNCPF1Reader` 读不了真实的 v1 文件

两个 2020 年的 v1 文件（`asdf.ncpf`、`qwerty.ncpf`）都抛：

```
java.lang.NullPointerException: Cannot assign field "minSize" because "<local5>.settings" is null
```

即 reader 在给 `settings.minSize` 赋值时 `settings` 为 null。这与 §11 是**同一类**问题
（构建器/配置对象未初始化就写入），但出现在 v1 导入路径上。

对照：v10/v11 的真实文件全部正常，说明这条路径不是整体坏掉，而是**旧版本**的处理没有跟上
后续的配置结构改动。旧版本文件的用户无法导入。

### 12.3 新发现：Hellrage v5 的真实文件同样读不回

2020 年的 `overhaul.json` 被 `OverhaulHellrageSFR5Reader` **正确命中**（版本判定没问题），
但解析时抛 `Invalid block name: Cf-252!`。

这是 §8 那条「用显示名当标识符」问题在**真实历史文件**上的确认 ——
之前只是我在合成反应堆上观察到，现在证明它对真实的老存档同样成立。

### 12.4 影响与 R0 处理

- **兼容性覆盖率显著提高**：现在有 9 个真实历史文件作为回归语料
  （`datasets/fixtures/historical/`），覆盖 v10/v11 两个版本；
- `LegacyNCPF1Reader` 的 NPE 与 Hellrage 的名字匹配失败**记录但不修复**（冻结基线）；
- TS 实现应：v10/v11 按现有语义复刻；v1 按**修复后**语义实现；
  Hellrage 改用 `legacyNames` / 元素身份而不是显示名。

---

## 13. R0 产出清单

| 编号 | 交付物 | 位置 | 状态 |
|---|---|---|---|
| R0.2 | 批处理 harness（脱离 GL，支持多堆型） | `tools/golden/`（`GoldenGen.java`、`Bootstrap.java`、`golden.ps1`） | ✅ |
| R0.2 | NCPF 元素身份导出工具 | `tools/golden/src/.../ElementDump.java` | ✅ |
| R0.3 | 黄金数据集 **Overhaul SFR** 5,000 例 | `datasets/golden/sfr-cases.jsonl.gz`（4.84 MB） | ✅ |
| R0.3 | 黄金数据集 **Underhaul SFR** 5,000 例（交叉验证） | `datasets/golden/usfr-cases.jsonl.gz`（1.54 MB） | ✅ |
| R0.3 | 编辑器/生成器分歧集 + 堆型支持矩阵与局限 | 记录的 `divergence` 字段；`docs/r0/golden-datasets.md` | ✅ |
| R0.3 | 真实设计导入模式（`--from-ncpf`） | `GoldenGen --from-ncpf`；`tools/README.md` §3.1 | ✅ 待输入真实文件 |
| R0.4 | NCPF 格式往返测试（38 个生产配置 / 18.7 MB） | `docs/r0/format-roundtrip.md` | ✅ **38/38 指纹一致** |
| R0.4 | 格式 fixtures + 往返验证（Overhaul / Underhaul 各一套） | `datasets/fixtures/`（含 README）、`docs/r0/fixtures.md`、`docs/r0/fixtures-underhaul.md`、`tools/golden/fixtures.ps1` | ✅ Underhaul 3/6 端到端一致；Overhaul 用于暴露 §8 的 bug |
| R0.4 | NCConfig（`.cfg`）fixtures + reader 验证 | `datasets/fixtures/ncconfig-{underhaul,overhaul}.cfg`、`docs/r0/fixtures-ncconfig.md`、`ConfigFixtureGen.java` | ✅ Underhaul 读出 90 元素；Overhaul 暴露 §11 的死路径 |
| R0.4 | **reader 覆盖表**（fixture → reader → 结果） | `docs/r0/fixture-coverage.md`（`RoundTrip --coverage`） | ✅ 8 个 fixture / 4 个读入成功 |
| R0.4 | **真实历史文件语料**（从 git 历史提取，2020–2025） | `datasets/fixtures/historical/`（含 `MANIFEST.json`）、`docs/r0/historical-fixtures.md`、`historical-fixtures.ps1` | ✅ 12 个文件 / **9 个读入成功**；验证 **LegacyNCPF10/11** | 
| R0.5 | 1185 条译文抽取 | `datasets/translations/legacy-translations.{json,tsv}` | ✅ |
| R0.5 | 数据名/UI 文案拆分草稿 | `lang/zh_CN.elements.draft.json`、`lang/zh_CN.messages.draft.json` | ✅ |
| R0.5 | 迁移报告 | `docs/r0/translation-migration.md` | ✅ |
| R0.6 | 文件级移植审计 | `docs/r0/port-audit.md`（831 文件全部归类） | ✅ |
| R0.7 | 兼容性契约 | `docs/r0/compat-contract.md` | ✅ |
| R0.1 | 冻结 tag / 最终 Java 版发布 | git tag | ⏳ 待用户确认（涉及 git 写操作） |

### 数据集格式（datasetVersion 2）

`datasets/golden/*.jsonl.gz`（每行一个 JSON 对象；首行为元数据）：

```jsonc
{"id":"sfr-000003","type":"sfr","strategy":"checker","size":[6,12,8],
 "blockNames":["nuclearcraft:solid_fission_cell", ...],  // 索引 -> 方块模板名（语言无关）
 "recipeNames":["fuel=leu_235", ...],                    // 索引 -> 配方/燃料名
 "grid":[12,-1,3, ...],       // 展平索引 x*dimY*dimZ + y*dimZ + z，-1 = 空
 "recipes":[0,-1,...],        // 同上索引，-1 = 无配方
 "editor":{...全部数值字段...},  // ← 黄金值（用户看到的）
 "lite":{...同名字段...},        // ← 生成器引擎；无 lite 时为 null
 "divergence":{"totalFuelCells":[3,64], ...},
 "error":"..."}               // 仅当编辑器引擎自己抛异常时出现
```

与 v1 的差异见 `docs/r0/golden-datasets.md` §1（统计改为反射取全字段、新增配方索引、
新增 `error`、排除 `lastChangeTime`、分歧比较覆盖全部共有字段）。

`blockNames`/`recipeNames` 是**语言无关**的模板名/配方名，配合 `grid`/`recipes`/`size` 可完全重建方块网格（含外壳）。

---

## 14. R0 未完成项与后续

> 📌 **后续执行计划见 `docs/rewrite-plan-r1-r5.md`** —— 它把本文档的发现落成了
> R1–R5 的任务分解与可验证的验收标准。

### R0.1 冻结与发布
需要 git 写操作（打 tag、可能发布 release）。**等待用户明确许可。**

### R0.4 收尾：剩余格式与堆型

已完成：
- Overhaul / Underhaul SFR 的 fixtures（`datasets/fixtures/`）；
- **NCConfig（`.cfg`）fixtures** —— 按 reader 源码合成输入，Underhaul 读出 90 元素，
  Overhaul 暴露了 §11 的死路径（`docs/r0/fixtures-ncconfig.md`）。

仍然缺（逐条见 `docs/r0/fixture-coverage.md`）：

**已通过真实历史文件验证的 reader**（`docs/r0/historical-fixtures.md`）：
`LegacyNCPF10Reader`、`LegacyNCPF11Reader`。
**已通过合成 fixture 验证**：`NCPFReader`、`UnderhaulNCConfigReader`。

**已知读不了真实文件的**：`LegacyNCPF1Reader`（§12.2）、`OverhaulHellrageSFR5Reader`（§12.3）、
`OverhaulNCConfigReader`（§11）。

**仍完全未验证的 reader**：`LegacyNCPF2`–`LegacyNCPF9`、Hellrage SFR v1–v4 / v6 之外、
Hellrage MSR v1–v6、Underhaul Hellrage v1。

1. **v2–v9 的真实文件** —— 需要用更多历史提交或社区老存档来补；
   `historical-fixtures.ps1` 里的路径清单可以直接加；
2. **其余堆型的 fixtures**（MSR / Turbine / Fusion / Distiller）—— 与 R0.3 同一个障碍：
   通用填充造不出可用反应堆，Fusion 非长方体，Distiller 无配置；
3. **Legacy NCPF / Hellrage 的旧版本 reader** 未逐一验证（v9/v10/v11、v1–v5）——
   需要真实的旧文件，或用冻结版按各版本格式手工构造输入。

### R0.3 收尾

已完成 Overhaul SFR 与 Underhaul SFR 各 5,000 例（见 `docs/r0/golden-datasets.md`）。仍然缺：

1. **真实用户设计样本** —— 当前是随机网格，分歧**比例**不能直接外推到手搭反应堆。
   harness 侧**已就绪**：`GoldenGen --from-ncpf <fileOrDir>` 会逐个求值工程文件里的设计，
   输出同格式记录。**只差输入文件**（社区 `.ncpf` / issue 附件 / Discord pin 的设计）。
   实测一个结构化 underhaul SFR 设计只差 1（`power` 30959 vs 30960），
   与随机网格的 4.03× 中位差形成鲜明对比。
2. **MSR / Turbine 的可用反应堆构造器** —— 通用填充造不出可用反应堆（统计恒 0），
   需要各自的专用构造器（MSR：连续燃料容器组 + 加热器配方；Turbine：叶片/定子/线圈排布）。
   这两个类型的 `getSuggestors()` 是构造可用反应堆的正路。
3. **Fusion** 需要独立的环形几何 harness（不是 `CuboidalMultiblock`）。

### 需要用户决定：是否修复 R0 发现的四个产品 bug

R0 刻意没有修（避免破坏基线）。三个选项：

| 选项 | 影响 |
|---|---|
| 不修，作为已知问题写进 TS 重写 | 冻结的 Java 版保留该 bug；TS 侧天然不会有（不用索引+结构相等） |
| 单独提一个修复 commit（改 `NCPFSettingsElement.matches` 的 `Set` 分支，让它按 `NCPFElementStack` 比较） | 修完需**重新生成** fixtures 与 golden（golden 不受影响，物理无关）；之后 Overhaul 的 NCPF 往返应转为 ✅ |
| 在 `overhaul` 分支之外开 hotfix 分支 | 可在冻结版之外给现有用户一个能用「保存→重开」的版本 |

### 另一件：是否修复 §10 的辐照器 NPE

`OverhaulSFR.java:1024` 补上与 1004 行相同的 `if(b.template.moderator!=null)` 保护即可。
影响：编辑器中 5.5% 的随机布局会直接崩；修完需重新生成 SFR 数据集（崩溃用例会变成正常用例）。

### 还有两件：§2 的 `shutdownFactor` 与 §11 的死路径

| bug | 修复要点 | 影响 |
|---|---|---|
| `shutdownFactor` NaN / 越界（§3） | 定义为 `[0,1]`，`totalOutput == 0` 时取 0 | 纯显示/语义问题，不影响物理；但会让 golden 里那些 `"NaN"` 变成确定值 |
| Overhaul `.cfg` 导入死路径（§11） | 在 `OverhaulSFRConfigurationBuilder:188` 用 `definition.getRecipeContainedAlternative()` 包一层；`OverhaulMSRConfigurationBuilder:194` 与 `MenuElementConfiguration:98` 同处一并修 | 恢复一整条导入路径；修完 overhaul `.cfg` fixture 应转为 ✅ |

### 对重写方案的四条修正
1. **§4.4 `DataNameBundle` 键** → 改为四段式 `<config>/<cfgType>/<type>|<definition>`（见 §4）。
2. **§5 黄金数据集** → 增加两条硬性要求：
   - 记录**旧实现的原始值**（含 NaN / 负值），TS 侧额外实现规范化逻辑并对拍；
   - 物理对拍的验收标准不能是"逐位相等"，因为**旧实现自身在两套引擎间就不一致**。
     正确做法是：**以编辑器引擎为黄金值**（用户看到的是它），生成器引擎的差异单独记录为
     "已知不一致清单"，重写后**必须消除**（新实现只有一份物理）。
3. **§2.2 兼容性契约** → 需明确"写"要分两种语义：**保存**（`NCPFFileWriter`，全保真）与
   **导出**（`NCPFWriter`，`makePartial` + 裁剪 `plannerator:*`），以及
   「模块激活状态影响配置文件可读性」（见 §9）。
4. **§5.2 覆盖面** → 实测只有 **Overhaul SFR 与 Underhaul SFR** 同时具备
   「已注册 + 有配置 + 长方体 + 双引擎」四个条件；MSR/Turbine 缺可用构造器，
   Fusion 非长方体，Distiller 无配置。详见 `docs/r0/golden-datasets.md` §4。

---

*本报告的所有数字均可由 `tools/` 下的脚本重新生成。*



