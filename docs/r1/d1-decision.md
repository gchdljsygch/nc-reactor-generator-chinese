# D1 决策记录 — 四个产品 bug 修不修

> 决策对象：`docs/rewrite-plan-r1-r5.md` §2 D1（选项 A 全不修 / B 修最重要的两个 / C 四条全修）。
> 本文档记录 **R1 实际执行了什么、以什么证据**，并且把「TS 侧语义」与「冻结 Java 基线」
> 两件事分开写清楚 —— 这是 D1 唯一容易出错的地方。

---

## 1. 决策

| 项 | 决定 |
|---|---|
| D1 | **选 B**（修 `matches()` 自反性 + 辐照器 NPE），但**分两条通道执行** |
| D1 通道 1（TS 语义） | TS 一律按**修复后语义**实现，包括 `matches()` 的正确比较与辐照器的 null guard |
| D1 通道 2（Java 基线） | **辐照器 NPE 已在冻结源码上修复并重新生成黄金数据集**（见 §3）；`matches()` **不回改 Java**，因为它只影响保存/读取路径，由 R1.4 在 TS 侧按修复后语义实现并记录差异 |
| D1b（热修分支） | 不在本工作区执行：该仓库处于「基线冻结 + 无 CI」状态，热修需要先建立分支与发布流程（R5.5）。此处只保留可复核的补丁与证据 |

## 2. 四个 bug 的处置表

| bug | 位置 | R1 处置 | 理由 |
|---|---|---|---|
| 辐照器分支 NPE | `OverhaulSFR.java:1024` | ✅ **已修 Java 并重生成数据集** | 它决定 277/5000 条用例能不能有黄金值；修完黄金覆盖率 94.5% → 100% |
| `matches()` 不自反 | `NCPFSettingsElement.java:186-210` | ⛔ 不改 Java；TS 按正确语义实现 | 只影响 NCPF **保存/读取**（R1.4 范围）。Java 侧保持冻结，避免动到 R0 的 38/38 往返基线 |
| Overhaul `.cfg` 死路径 | `OverhaulSFRConfigurationBuilder.java:188` 等 | ⛔ 不改 Java；列入 R2 范围 | 导入路径，R2 才实现；届时按修复后语义做并在覆盖表标注 |
| `shutdownFactor` NaN/越界 | `OverhaulSFR.java:945` 等 | ⛔ 不改 Java；TS 定义为 `[0,1]` 并在比较层规范化 | 见 §4 |

## 3. 通道 2 的具体改动与验证

### 3.1 改动（1 处，等价于姊妹分支的写法）

```java
// src/net/ncplanner/plannerator/multiblock/overhaul/fissionsfr/OverhaulSFR.java
// 辐照器分支（原 1024 行）
for(int j = 1; j<i; j++){
    Block b = getBlock(that.pos.offset(d,j));
    if(b.template.moderator!=null)f += b.template.moderator.flux;   // ← 补的 guard
    fluxDecals.enqueue(new OverhaulModeratorLineDecal(that.pos.offset(d,j), d, f, efficiency/length));
}
```

同一文件 1004 行的反射器分支本来就写了同样的守卫，所以这是「补齐漏写的姐妹分支」，
不是新逻辑。`f` 只用于**贴图装饰**（`OverhaulModeratorLineDecal`），不参与任何统计量，
因此该修复在原理上不可能改变已能用例的物理值 —— 实测也确实如此。

### 3.2 重生成与对照（同一 seed/参数）

```text
修复前：written 5000 · editor crashed 277 · productive 1390 · diverged 4703
修复后：written 5000 · editor crashed   0 · productive 1433 · diverged 4976
```

逐条对照（`sfr-cases.pre-d1.jsonl.gz` vs 新数据集）：

```text
previously-crashing now computing: 277 ; still erroring: 0
editor identical: 4723 ; differing: 277      ← 277 条正是原先没有 editor 值的那批
errors in new dataset: 0
```

即：**4,723 条可用记录逐字段（15 个数值字段）完全不变**，277 条从「无黄金值」变成
「有黄金值」，TS 内核随后对这 5,000 条**全部通过**（`docs/r1/r1.5-kernel.md`）。

### 3.3 数据集版本

`datasetVersion 3`（命名改为单射，见 `docs/r1/r1.0-dataset-naming.md`）+ D1 修复
= 当前 `datasets/golden/sfr-cases.jsonl.gz`。基线记录见 `datasets/golden/BASELINE.md`。
修复前的数据保留为 `datasets/golden/sfr-cases.pre-d1.jsonl.gz`，供审计对照。

## 4. `shutdownFactor` 的域定义（不改 Java，改 TS 语义层）

冻结实现有三种表现：`totalOutput == 0` 时 `NaN`、实测 13 例越界（<0 或 >1）、其余正常。
TS 侧：

- 内核保留原始值 `statsRaw().shutdownFactor`（用于证据与对拍旧行为）；
- 对外 `stats().shutdownFactor` 定义为 `[0,1]`，且 `totalOutput == 0 → 0`
  （`packages/kernel/src/sfr/reactor.ts` 的 `normalizeShutdownFactor`）；
- 比较层对**两侧**都施加同一规范化（`packages/kernel/src/stats.ts`），
  于是「旧实现的越界值」不会污染对拍结果。

### 4.1 同类问题：Turbine 的 `rotorEfficiency`（R1.0c 发现）

冻结的 `OverhaulTurbine` 在 `rotorEfficiency /= numberOfBlades` 处
在**没有叶片**时得到 `0.0f/0` → `NaN`，并传染到 `totalEfficiency` /
`totalFluidEfficiency`（实测 500 条 turbine 记录中有 **17 条**为 `"NaN"`，
全部满足 `size[2]==5 && statorCount==dimZ`）。

TS 侧定义域：

```ts
// packages/kernel/src/turbine/reactor.ts
stats(): TurbineStats {          // statsRaw() 保留原始值用于证据
  if (!Number.isFinite(raw.rotorEfficiency)) raw.rotorEfficiency = 0;
  if (!Number.isFinite(raw.totalEfficiency)) raw.totalEfficiency = 0;
  if (!Number.isFinite(raw.totalFluidEfficiency)) raw.totalFluidEfficiency = 0;
  return raw;
}
```

**刻意不做**的事：不把 `rotorEfficiency` 夹到 `[0,1]`。
它是叶片效率的加权和，在黄金数据里合法地大于 1（最大 1.0957）；
第一版实现夹到 1，导致 **21/500 例失败**（`expected 1.0956606 got 1`），
改为「只定义未定义值」后恢复 500/500。这条教训写进了
`packages/kernel/src/turbine/reactor.ts` 的注释。

回归测试：`packages/kernel/test/finite-stats.test.ts` ——
四个数据集**每一条记录的每一个统计量**都必须是有限值（11,500 条全查）。

## 5. 未做与原因

- **未回改 `matches()`**：会让 R0 的 38/38 往返指纹基线失效，而收益（保存路径）在 R1.4 由 TS
  新实现直接获得。R1.4 的报告需要显式声明「与冻结版行为不同，这是有意的」。
- **未修 `.cfg` 死路径**：R2 才实现该 reader；现在改 Java 无法被任何 R1 验收覆盖。
- **未建热修分支（D1b）**：需要发布流程（R5.5）与用户可见的版本策略，超出 R1。

---

## 6. 追加：R1.0b 期间发现的第 5 个产品 bug（MSR 加热器配方）

> R0 记录了 4 个 bug，D1 的选项 A/B/C 也是围绕它们设计的。
> R1.0b（为 MSR 生成黄金数据）时发现**第 5 个**，且它使 MSR 的黄金数据**完全不可能产生**，
> 因此按与辐照器 NPE 相同的原则处理：修 Java、记录、验证。

### 6.1 现象

任何含「已激活且有配方的加热器」的 MSR 反应堆都会抛：

```text
java.lang.ClassCastException: class net.ncplanner.plannerator.ncpf.element.NCPFLegacyFluidElement
  cannot be cast to class net.ncplanner.plannerator.ncpf.element.NCPFLegacyRecipeElement
  at net.ncplanner.plannerator.multiblock.overhaul.fissionmsr.OverhaulMSR.calcStats(...)
```

### 6.2 根因（已实测复核）

- 随附配置 `nuclearcraft.ncpf.json` 里，MSR 的 **32 个加热器配方全部声明为
  `"type":"legacy_fluid"`**（`{"name":"nak_hot","type":"legacy_fluid", ...}`），
  只有 9 个是真 `legacy_recipe`（属于辐照器）；
- 而 `HeaterRecipe extends LegacyRecipeElement`，其 `getRecipeDefinition()`
  **无条件**把定义强转为 `NCPFLegacyRecipeElement` 并读 `outputs`；
- `legacy_fluid` 没有 `outputs` 字段，于是强转失败。

即：**配置与模型不一致**，且没有任何测试覆盖到它（R0 的 MSR 数据全为 0，从未走到这一行）。

复核命令：

```powershell
node -e "const j=require('./datasets/configurations/nuclearcraft.ncpf.json'); ..."   # 见 §6.4
# → heater recipes: legacy_fluid 32 legacy_recipe 0
```

### 6.3 修法（3 处，同一模式）

`OverhaulMSR.java` 的 `calcStats`（base / shutdown / partial shutdown 各一处）
只在定义确实是 `NCPFLegacyRecipeElement` 时才读 `outputs`：

```java
if(b.heaterRecipe.definition instanceof NCPFLegacyRecipeElement)
    for(NCPFElementStack output : b.heaterRecipe.getRecipeDefinition().outputs){ ... }
```

`totalTotalOutput += out;` **保持无条件执行**，因此加热器的吞吐量统计不受影响 ——
修复只影响「把加热器产出累加到 `totalOutput` 列表」这段（对 `legacy_fluid` 配方本来就没有产出栈可累加）。

### 6.4 验证

| 验证 | 结果 |
|---|---|
| 修复前 | 含激活加热器的 MSR 用例 **100% 抛异常**（MSR 黄金数据全为 0） |
| 修复后（单例诊断，7×7×7） | `totalFuelVessels=8`、`totalTotalOutput=2.2454648`、`totalEfficiency=0.86949337`、`totalCooling=210`、`functionalBlocks=27`、`numControllers=1`、`missingCasings=0`，无异常 |
| 对 SFR 的中性性 | 重新编译后重跑 SFR 生成器，前 60 例的 `grid`/`recipes`/`editor` 与原数据集**逐字节相同**；TS 侧 SFR 黄金测试仍为 5,000/5,000 |
| 独立复核（本文档作者） | 用当前 `src` 重编译后生成前 200 例，与 `sfr-cases.jsonl.gz` 逐条比对 `grid`/`recipes`/`blockNames`/`editor`/`error`：**identical 200 / 200** |
| 对 SFR 无影响的原理 | 改动只在 `OverhaulMSR` 内 |

### 6.5 对计划的影响

- D1 的 bug 表应从 4 条扩为 5 条；
- 这条 bug 说明「MSR 无黄金数据」不只是「构造器难写」，还有**真实的崩溃路径**；
  若当初按 D1 选项 A（全不修）执行，MSR 的黄金数据将永远无法产出；
- 与辐照器 NPE 不同的是，这条**无法用「TS 按修复后语义实现」绕过** —— 因为有黄金值必须先有
  Java 能算出来。这也反过来支持 D1 选 B 而不是 A。
