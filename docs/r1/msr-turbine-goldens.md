# R1.0b / R1.0c — MSR 与 Turbine 黄金数据集

> 本文档记录 R1.0b（Overhaul MSR）与 R1.0c（Overhaul Turbine）的**专用构造器**、生成命令、
> **实测**统计与已知局限。所有数字都是本机实测；没有实测过的数字不写。
>
> 前置文档：`docs/r0/golden-datasets.md` §4（堆型支持矩阵）、§7（局限）；
> `docs/rewrite-plan-r1-r5.md` §4.1、§3.1（黄金数据集契约）。

---

## 1. 交付物

| 文件 | 堆型 | 例数 | 种子 | 尺寸范围 | 有 lite 引擎 |
|---|---|---:|---|---|:--:|
| `datasets/golden/msr-cases.jsonl.gz` | Overhaul MSR | 1000 | 20260101 | 内部 3–14 | ❌ |
| `datasets/golden/turbine-cases.jsonl.gz` | Overhaul Turbine | 500 | 20260102 | 内部 3–14 | ❌ |

记录格式与 `sfr-cases.jsonl.gz` 相同（`datasetVersion 3`）。与既有数据集一致，
**只保留 gzip 后的 `.jsonl.gz`**，不保留未压缩的 `.jsonl`。

压缩方式（Node，`zlib.gzipSync(..., {level: 9})`）：

| 文件 | 未压缩 | 压缩后 | 压缩比 |
|---|---:|---:|---:|
| `msr-cases.jsonl.gz` | 8,818,253 B | 1,008,422 B | 11.4% |
| `turbine-cases.jsonl.gz` | 4,118,301 B | 94,045 B | 2.3% |

两份数据集都**逐字节可复现**：用同一命令重新生成，输出与已归档的 `.jsonl.gz` 解压后
`Buffer.compare` 完全一致（**MSR 与 Turbine 均已实测 `true`**）。

### 1.1 `"lite": null` 的原因（必读）

MSR 与 Turbine 的每条记录都是 `"lite": null`，`divergence` 也都是 `{}`。
**这不是数据缺失，而是事实**：整个仓库只有 **两个** `LiteMultiblock` 实现
（`OverhaulSFR.compile()` 与 `UnderhaulSFR.compile()`）。`OverhaulTurbine.compile()`
直接 `return null`，`OverhaulMSR` 甚至没有 `compile()` 覆盖。

所以这两种堆型**只存在一份引擎**（编辑器引擎），`editor` 字段就是唯一的黄金值。
R1.6 移植时**没有"与 lite 对拍"这一步**，也不应期待 MSR/Turbine 有分歧数据。
这也意味着 `docs/r0/golden-datasets.md` §3.1.1 关于"分歧集用于定位最容易出错的区域"
的用法，**不适用于这两个堆型**——它们的风险只能靠独立手算验证（R1.5h 同类做法）。

---

## 2. 复现命令

仓库自带的 Gradle 构建是坏的；harness 用普通 `javac` 编译。应用类可用
`tools/golden/golden.ps1` 重建（它会同时编译 `src/` 与 harness），或按下述命令手工编译。

```powershell
# 1) 编译（应用类 + harness）
$jars  = Get-ChildItem libraries -Filter *.jar -File |
         Where-Object { $_.Name -notlike 'lwjgl*' -and $_.Name -ne 'joml-1.10.5.jar' }
$jars += Get-ChildItem libraries\DizzyEngine -Filter *.jar -File |
         Where-Object { $_.Name -notlike '*-sources.jar' -and $_.Name -notlike '*-javadoc.jar' }
$jarPaths = $jars | ForEach-Object { $_.FullName }

# 应用类（约 7 秒；R1.0b 需要 MSR 源码里的修复，见 §5.1，所以必须重编）
Get-ChildItem src -Recurse -Filter *.java | ForEach-Object { $_.FullName } |
    Set-Content tools\golden\build\sources.txt -Encoding UTF8
javac -encoding UTF-8 -nowarn -d build\classes -cp ($jarPaths -join ';') "@tools\golden\build\sources.txt"

# harness
javac -encoding UTF-8 -nowarn -d tools\golden\build\tools `
      -cp ((@('build\classes') + $jarPaths) -join ';') `
      (Get-ChildItem tools\golden\src -Recurse -Filter *.java | ForEach-Object { $_.FullName })

# 2) 生成
$runCp = @('build\classes','tools\golden\build\tools','src') + $jarPaths
$env:JAVA_TOOL_OPTIONS='-Dfile.encoding=UTF-8'

java -cp ($runCp -join ';') net.ncplanner.plannerator.tools.GoldenGen `
     --type msr --cases 1000 --seed 20260101 --min-size 3 --max-size 14 `
     --out datasets/golden/msr-cases.jsonl

java -cp ($runCp -join ';') net.ncplanner.plannerator.tools.GoldenGen `
     --type turbine --cases 500 --seed 20260102 --min-size 3 --max-size 14 `
     --out datasets/golden/turbine-cases.jsonl

Remove-Item Env:\JAVA_TOOL_OPTIONS

# 3) 压缩（Node）
node -e "const fs=require('fs'),z=require('zlib');
for(const t of ['msr','turbine']){
  const s='datasets/golden/'+t+'-cases.jsonl';
  fs.writeFileSync(s+'.gz', z.gzipSync(fs.readFileSync(s), {level:9}));
}"

# 4) 单例诊断（打印坐标探测、逐层 ASCII 图与两个引擎的统计）
java -cp ($runCp -join ';') net.ncplanner.plannerator.tools.GoldenGen `
     --type msr --cases 1 --min-size 7 --max-size 7 --out "$env:TEMP\msr1.jsonl" --diag
java -cp ($runCp -join ';') net.ncplanner.plannerator.tools.GoldenGen `
     --type turbine --cases 1 --min-size 7 --max-size 7 --out "$env:TEMP\t1.jsonl" --diag
```

> `--diag` 会把 `--cases` 强制为 1。`--dump-blocks` / `--dump-blocks-id <id>` 打印逐方块引擎状态
> （含 `valid` / `isActive` / 配方规则求值结果），是调试 T1.6 移植的主要手段。

---

## 3. Overhaul MSR 专用构造器

### 3.1 为什么通用填充不行

R0 的 `docs/r0/golden-datasets.md` §4 已指出：通用反射填充造出的 MSR
`totalFuelVessels` 恒为 0、全部统计为 0。原因是通用填充是**类别盲**的：
它不理解"燃料容器组"、"加热器放置规则"与"慢化剂连线"这三件事是 MSR 出功率的前提。

读 `OverhaulMSR` 自己的物理可以反推出一个可用反应堆需要什么：

| 机制 | 代码位置 | 对构造器的要求 |
|---|---|---|
| 容器组 `VesselGroup` | `getBlocks(Block)` 4-邻接洪泛，要求 **同模板且同 `Fuel` 实例** | 相邻容器必须共用同一个 `Fuel` 对象，否则永远拆成单容器组 |
| 组是否"已启动" `isPrimed()` | `getSources() >= getRequiredSources()`，后者 `= getOpenFaces()/6` | 单容器 6 个开放面 → 表面因子 1 → 自持燃料即可启动 |
| 中子通量传播 | `propogateNeutronFlux`：沿轴最多走 `neutronReach+1` 格，**遇到空格立即 `break`**，且给另一个容器通量要求 `length > 0`（中间至少 1 个非空方块） | 两个容器之间必须**恰好**留 1 个慢化剂，不能是 0 个（贴在一起）也不能 ≥2 个（被 `break` 打断） |
| 容器是否"活跃" | `isFuelVesselActive()` = `group.neutronFlux >= group.criticality` | 通量来自 `moderator.flux`，所以**慢化剂通量必须够大** |
| 加热器是否有效 | `calculateHeater` → `NCPFPlacementRule.isValid`，规则里总会出现 `fuel_vessel` 和/或 `moderator`/`casing` | 加热器必须 6-邻接一个燃料容器，且其规则树在"容器 + 慢化剂 + 外壳"这套邻居下可满足 |
| 簇 `Cluster` | 仅由 `createsCluster()` 为真的方块创建（燃料容器/辐照器/中子屏蔽），且必须 `wallCheck` 连到外壳 | 至少一个活跃容器所在的簇要贴到内壁 |
| 输出 `totalTotalOutput` | 对每个"有配方的加热器方块"累加 `cluster.efficiency * sparsityMult` | 需要 ≥1 个**活跃**簇且簇里有加热器 |

### 3.2 构造策略

1. **容器晶格**：`(x-1)%2==0 && (y-1)%2==0 && (z-1)%4==0`（即 x/y 隔 2 格、z 隔 4 格）。
   - x/y 隔 2 → 两容器之间正好 1 个慢化剂，通量可达（这是"慢化剂连线"）。
   - z 隔 4 → 容器的 z 邻居**不是**隔着 2 格的容器。若 z 也用隔 2（全 `2` 晶格），
     则每个容器的 6 个邻居**全都**落在"容器—容器"连线上，于是没有一个格子能放加热器，
     反应堆有容器但**没有有效加热器、输出恒 0**。实测（同为 300 例、seed 20260101、
     尺寸 3–14，仅改晶格）：z 隔 2 → `productive 41.0%`；z 隔 4 → `productive 52.3%`
     （当时的慢化剂还是随机挑的，见下面第 3 条）。
3. **慢化剂**：所有非容器格先铺满慢化剂；**取通量最高**的那个慢化剂模板
   （本配置里 Heavy Water `flux=36`，另有 Beryllium 22、Graphite 10）。
   这一条是出功率的关键：只用"随机挑一个慢化剂"时 1000 例的
   `totalFuelVessels > 0` 只有 68.3%、`productive` 52.3%；换成通量最高慢化剂后
   提升到 `totalFuelVessels > 0` **98.0%**、`productive` **87.6%**（§3.3 的最终数字）。
2. **燃料**：只从容器模板 `fuels` 里挑 `stats.selfPriming == true` 的子集（本配置 4/27 个），
   并把**连续几个容器绑到同一个 `Fuel` 实例**上（`groupSize = 1+rand.nextInt(volume>=64?3:2)`），
   使容器组真的成组。自持燃料保证不依赖中子源即可启动。
3. **慢化剂**：所有非容器格先铺满慢化剂；**取通量最高**的那个慢化剂模板
   （本配置里 Heavy Water `flux=36`，另有 Beryllium 22、Graphite 10）。
   这一条是出功率的关键：加通量最高慢化剂后，`totalFuelVessels > 0` 从 68.3% 提升到 97.8%。
4. **加热器**：候选格 = 6-邻接某容器、且**不在**任何"容器—容器"慢化剂连线上的格子；
   每个容器最多取 6 个候选。再按 `cooling` 从配置里挑模板，并用一个规则树可行性判断
   （`heaterTemplateFits`）排除那些要求"另一种加热器"或"某种不存在的方块"的模板
   （例如 Iron/Redstone/Glowstone 加热器分别要求 moderator、fuel_vessel+moderator、
   ≥2 moderator，本布局下不成立）。放置比例 `heaterRatio = 0.45 + rand*0.45`。
5. **反射层 / 中子屏蔽 / 导体**：在剩下的非容器、非加热器格里按随机比例
   （反射层 10–35%、屏蔽 5–20%、导体 5–20%）替换，用于制造簇形态的多样性。
   中子屏蔽取**闭合态**模板（`unToggled` 为空的那个），这样构造器无需调用
   `Block.setToggled`。
6. **中子源**：在贴着第一个容器的外壳格上放 1 个（兜底保险；自持燃料本身不需要它）。

一个 7×7×7 内部、z 隔 4 的布局（`v`=燃料容器，`H`=加热器，`m`=慢化剂，`S`=中子源）：

```
  z=1 层 (x-y 平面)          z=2 层
  y                           y
  7  . v . v . v .            7  . m . m . m .
  6  . m m m m m .            6  . H . H . H .
  5  . v . v . v .            5  . m . m . m .
  4  . m m m m m .            4  . H . H . H .
  3  . v . v . v .            3  . m . m . m .
  2  S m m m m m .            2  . H . H . H .
  1  . v . v . v .            1  . m . m . m .
     . . . . . . .               . . . . . . .
     0 1 2 3 4 5 6 x             0 1 2 3 4 5 6 x

  z=1 与 z=5 是容器层（隔 4），z=2..4 是慢化剂/加热器层。
  x/y 方向：v(m)m v，两个 v 之间正好 1 个 m —— 这是通量能过的"慢化剂连线"。
```

一个完整的 12×12×12 内部实例（`--type msr --cases 1 --min-size 12 --max-size 12 --diag`
的实测）：`totalFuelVessels=186`、`totalTotalOutput=23.41`，`totalCooling` / `totalHeat` /
`netHeat` / `totalEfficiency` / `sparsityMult` / `shutdownFactor` 等字段齐全
（完整字段清单见 §6）。

### 3.3 实测统计（1000 例，seed 20260101，内部 3–14）

```
cases requested : 1000
written         : 1000
failed          : 0
editor crashed  : 0     ← 0% 崩溃
productive      : 876   (87.6%)   ← editor.totalTotalOutput != 0
totalFuelVessels>0 : 980 (98.0%)
```

| 字段 | 最小 | 最大 | 均值 |
|---|---:|---:|---:|
| `totalTotalOutput` | 0 | 23.410734 | 3.8825 |
| `totalFuelVessels` | 0 | 186 | 36.605 |

按最大内部尺寸的 productive 率（实测）：

| 最大内部尺寸 | productive / 例数 | 率 |
|---|---:|---:|
| 4–5 | 0 / 1 | 0.0% |
| 6–8 | 17 / 41 | 41.5% |
| 9–11 | 140 / 180 | 77.8% |
| 12–14 | 321 / 363 | 88.4% |

小反应堆出功率低是**物理原因**，不是构造器缺陷：容器要活跃就必须拿到足够通量，
而通量只能沿慢化剂连线从另一个容器传来。内部尺寸 ≤5 时晶格上最多只有 1 个容器，
连不出任何连线 → `totalFuelVessels=0`（1000 例里 20 例）。

**按策略：** 7 个策略标签（`random` `mixed` `fuel_mod` `fuel_only` `casing_only`
`fuel_heatsink` `checker`）在这两种堆型上**不产生差异**——专用构造器完全忽略策略参数，
只从 `strategy` 里取随机数继续走 `java.util.Random` 序列。实测每个策略单独跑
200 例，productive 都是 **175/200 = 87.5%**（MSR）；`editor crashed` 全为 0。
`strategy` 字段仍按原样记录，便于与 SFR 数据集一致地解析。

---

## 4. Overhaul Turbine 专用构造器

### 4.1 为什么通用填充不行

涡轮的效率是乘法链：

```
totalEfficiency = coilEfficiency * rotorEfficiency * throughputEfficiency * idealityMultiplier
```

`coilEfficiency` 来自 `z==0` 与 `z==externalDepth-1` 两个面上 `isCoil() && isActive()`
的方块；`rotorValid` 要求**每一个 z 切片的叶片环被同一个模板填满**。
通用填充两者都给不出，所以输出恒 0。

### 4.2 构造策略与布局

轴向 = z。构造器生成的布局：

```
        z=0                z=1 .. z=depth              z=depth+1
   +-------------+    +------------------------+    +-------------+
   | 外壳 + 轴承 |    | 叶片环（每层单一模板，  |    | 外壳 + 轴承 |
   | + 线圈      |    | 可混入定子）           |    | + 线圈      |
   | + 入口      |    | + 轴心（shaft）         |    | + 出口      |
   +-------------+    +------------------------+    +-------------+
```

1. **轴承 / 轴**：镜像引擎自己的搜索。`doCalculationStep` case 1 用带标签的循环
   `BEARING:`，第一个装得下的直径就 `break BEARING` 出整个循环。实测：
   `bearingMin == bearingMax == externalWidth/2`，实际用到的直径是
   `(内宽偶数 ? 2 : 1)`（数据集里 `bearingDiameter` 也确实只取到 `1` 与 `2`，
   与内宽奇偶一一对应）。`bearing` 模板放两个端面，`shaft` 放中间每一层。
   **构造器必须逐字复刻这套边界**，否则填出来的环不是引擎校验的那个环，
   `rotorValid` 恒为 false。详见 §5.2。
2. **叶片环**：每层把"恰好一个坐标落在轴承范围内"的格子填满，同一层用同一个模板；
   按 `expansion` 从高到低随机取（1.8 / 1.6 / 1.4），并以最多 `min(depth,3)` 层的概率
   混入 `stator`（`expansion=0.75`）来改变 `idealExpansion` 曲线。
3. **线圈**：`case 5` 只在 `z=0` 与 `z=externalDepth-1` 两面上求和，而 `calculateCoil`
   要求线圈"6-邻接一个**已经有效**的方块"且自身规则成立。本配置里 6 种线圈有 5 种的规则
   要求**另一种线圈**相邻（silver 要求 gold 且 copper，gold 要求 aluminium，
   beryllium 要求 magnesium ……），这在构造阶段不可能满足。唯一规则只提到
   bearing/connector 的模板是**效率最低的那个**（Magnesium，0.88），构造器显式按
   `coil.efficiency` 取最小者作为"启动线圈"，填满两个端面的环。
4. **线圈连接器**：其规则是"至少 1 个线圈相邻"。线圈占据了 `z=0` 面上环里那些
   **同时贴着外壳面**的格子（例如 7×7×7、轴承范围 `[3,3]` 时是 `(1,3,0)` 等），
   所以连接器可以落在 `(1,2,0)` 之类的位置并满足规则。构造器扫描外壳面上所有
   "与某个线圈 6-邻接"且非控制器的格子，放一个连接器，然后返回（实测每例最多 1 个，
   7×7×7 时落在 `(1,2,0)`，与 `(1,3,0)` 的线圈相邻）。
5. **控制器 / 入口 / 出口**：由 `buildDefaultCasing()` 自动提供，构造器不动它们。

### 4.3 实测统计（500 例，seed 20260102，内部 3–14）

```
cases requested : 500
written         : 500
failed          : 0
editor crashed  : 0     ← 0% 崩溃
productive      : 483   (96.6%)   ← editor.totalOutput != 0
```

| 字段 | 最小 | 最大 | 均值 |
|---|---:|---:|---:|
| `totalOutput` | 0 | 187911 | 16787.1240 |
| `bladeCount` | 3 | 14 | 8.374 |
| `coilEfficiency` | 0.44 | 0.44000003 | — |
| `bearingDiameter` | 1 | 2 | — |
| `numControllers` / `missingCasings` | 1 / 0 | 1 / 0 | — |

（`totalOutput` 非零样本的最小值为 31；`bladeCount` 恒等于 `size[2]-2`。）

按最大内部尺寸的 productive 率（实测）：

| 最大内部尺寸 | productive / 例数 | 率 |
|---|---:|---:|
| 4–5 | 2 / 3 | 66.7% |
| 6–8 | 48 / 50 | 96.0% |
| 9–11 | 120 / 125 | 96.0% |
| 12–14 | 127 / 129 | 98.4% |

**按策略：** 同 MSR，策略无关。每策略单独 200 例实测 productive 都是
**189/200 = 94.5%**，`editor crashed` 全为 0。

---

## 5. 已知局限（全部为本机实测发现，未修复的都在这里）

### 5.1 【已修复】MSR 加热器配方导致引擎抛 `ClassCastException`

**这是 R1.0b 期间发现的、R0 未记录的产品缺陷，且它让所有 MSR 黄金数据都不可能生成。**

- 现象：任何"有活跃加热器且加热器带配方"的 MSR 都在 `OverhaulMSR` 抛
  `ClassCastException: class NCPFLegacyFluidElement cannot be cast to class NCPFLegacyRecipeElement`。
- 位置：`OverhaulMSR.java` 三处（原 473 / 745 / 1037 行）
  `b.heaterRecipe.getRecipeDefinition().outputs`。
- 根因：`HeaterRecipe extends LegacyRecipeElement`，而
  `LegacyRecipeElement.getRecipeDefinition()` **无条件**强转成 `NCPFLegacyRecipeElement`；
  但 `src/configurations/nuclearcraft.ncpf.json` 把 MSR 的 96 条加热器配方声明为
  `"type":"legacy_fluid"`（只有 `heater_stats.cooling`，没有 inputs/outputs）。
  对照：SFR 的 2 条 coolant recipe、SFR/MSR 的辐照器配方**都是正确的 `legacy_recipe`**，
  所以 SFR 数据集从未踩到它。
- 修法（本次改动，3 处，最小化）：只有定义真的是 `NCPFLegacyRecipeElement` 时才去累加
  `totalOutput`；`totalTotalOutput += out` 对所有加热器照常执行，所以**加热器吞吐量的语义
  没有改变**，只是不再因为"配方是纯流体"而崩。
- 影响面：`src/net/ncplanner/plannerator/multiblock/overhaul/fissionmsr/OverhaulMSR.java`
  一个文件。`--type sfr` 行为经 300 例逐字段比对**完全不变**（§5.4）。
- 建议：这应当并入 R1.0e 的 D1 决策记录（D1 现有 A/B/C 三案都未包含它），
  并在 `docs/r0/golden-datasets.md` 的「基线版本」里登记。

### 5.2 轴承边界与"引擎实际用到哪个直径"（含一个被我修正过的早期误判）

`doCalculationStep` case 1 的边界公式

```
bearingMin = getExternalWidth()/2 - i/2
bearingMax = getExternalWidth()/2 + i/2 - (i 偶数 ? 1 : 0)
```

在**奇数**直径下化简为 `bearingMin == bearingMax == getExternalWidth()/2`。而迭代区间是
`[getMinBearingDiameter(), dimX-2]`，其中 `getMinBearingDiameter()` 是
**奇数内宽 1、偶数内宽 2**（取的是内部宽度 `dimX`，不是外部宽度）：

```
internalWidth=4 externalWidth=6 minBearingDiameter=2 maxBearingDiameter=2
internalWidth=5 externalWidth=7 minBearingDiameter=1 maxBearingDiameter=3
internalWidth=6 externalWidth=8 minBearingDiameter=2 maxBearingDiameter=4
```

两件事因此成立，且都已实测：

- **偶数内宽也完全可用**。区间 `[2,2]`、`[2,4]` 都非空，迭代会执行；实测
  内部宽度 4 / 6 分别得到 `bearingDiameter=2`、`bladeCount=4` / `6`、
  `rotorEfficiency` 非零、`totalOutput` 非零。数据集里 500 例中有 **244 例
  `size[0]` 为偶数**，它们的 productive 率与奇数内宽没有区别。
  > ⚠️ 早期分析（本任务过程中）曾误判"偶数内宽使 `bearingMin..bearingMax` 覆盖整个
  > 截面、叶片环为空"，并据此在 harness 里加过"强制奇数内宽"的规避。该误判把
  > **外部**宽度 `dimX+2` 当成了内部宽度。规避已**删除**，数据集在**不做任何规避**的
  > 情况下生成；删掉规避后 productive 仍是 `483/500`，只是 26 条记录的网格内容不同。
- **`bearingDiameter` 只会取到两个值**：奇数内宽时循环只为奇数直径执行且
  `bearingMin==bearingMax`，第一批可用直径就是最小的那个；偶数内宽时从 2 开始。
  实测数据集里 `bearingDiameter ∈ {1, 2}` 且 `1` 对应奇数内宽、`2` 对应偶数内宽
  （`bearingDiameter == (内宽偶数 ? 2 : 1)`）。

构造器因此按 `bearingMin = bearingMax = externalWidth/2`、直径取
`(内宽偶数 ? 2 : 1)` 复刻引擎的边界。**已用数据反向验证**：对每条记录用
"恰好一个坐标落在 `[bearingMin,bearingMax]`"这一规则重算叶片环，与记录里实际
含叶片/定子的格子**逐格完全一致（60/60 条记录，0 处不符）**。

### 5.3 【未修复】涡轮内部深度为 3 时 `rotorEfficiency` 为 `NaN`

`doCalculationStep` case 3：`numberOfBlades` 只统计**非定子**的切片，
`rotorEfficiency /= numberOfBlades`。当随机抽到 `statorCount == dimZ`（深度 3 时
`rand.nextInt(min(dimZ,3)+1)` 可以取到 3），**所有切片都是定子** → `numberOfBlades == 0`
→ `0.0/0 == NaN` → `totalEfficiency` 为 NaN → `(long)(NaN*x) == 0`，输出为 0。

- 实测：500 例中 17 例输出为 0，**全部**满足 `size[2]==5`（内部深度 3）
  且 `statorCount == dimZ == 3`（三个切片 1/2/3 全为定子）；
  `rotorEfficiency` 全为 `"NaN"`、`bladeCount` 全为 3、`maxInput` 全为 0。
  交叉验证：本次生成中 `statorCount == dimZ` 的用例恰好 17 个，且**全部**是零输出；
  其余 483 例全部非零。TS 侧必须定义 `rotorEfficiency` 的 `[0,1]` 定义域并在无叶片时取 0
  （与 `docs/rewrite-plan-r1-r5.md` §3.1.5 的规范化层同类）。
- 记录里 `"NaN"` 以字符串形式出现（与 SFR 的 `shutdownFactor` 同一约定）。

### 5.4 【已核对】`--type sfr` 与 `--type underhaul-sfr` 行为未变

按要求，用**同一份源码 + 同一构建命令 + 同一参数**，用本 build 生成 300 例 sfr，
与 `datasets/golden/sfr-cases.jsonl.gz` 的前 300 条逐条比对
`grid` / `recipes` / `editor`（另外还比了 `blockNames` / `recipeNames` / `size` /
`strategy` / `error` / `lite`）：

```
new  records: 300
base records: 5000
compared      : 300
whole-record identical: 300/300
records with any field diff: 0
per-field diffs: (none)
DIFFERENCES: 0
```

即 MSR 源码修复**没有**改变 SFR 的任何一个字节。

### 5.5 仍然不支持的堆型

- **Fusion**：`OverhaulFusionReactor` 不是 `CuboidalMultiblock`（环形几何），
  本 harness 结构上无法构造；需要独立的 harness。代码里 `--type fusion` 仍以退出码 3
  打印明确的 `UNSUPPORTED` 原因。
- **Distiller**：`nuclearcraft.ncpf.json` 里**没有任何** distiller settings
  （配置只有 `overhaul_turbine` / `overhaul_msr` / `underhaul_sfr` / `overhaul_sfr`
  四段），`OverhaulDistiller` 无法实例化。要出数据必须先决定是否从 `LegacyNCPF11Reader`
  反推一份 distiller 配置（对应 `rewrite-plan-r1-r5.md` §4.7 R1.6d / 决策 D7）。

### 5.6 MSR 的 `shutdownFactor` 也有 `"NaN"` 与越界（沿用 §3.1.5 的规范化层）

MSR 的 `shutdownFactor` 是 `1-(offOutput/totalTotalOutput)`，所以
`totalTotalOutput==0` 时同样是 `NaN`。本次 1000 例的实测：

- `"NaN"`：**124 例**，且这 124 例正好就是 `totalTotalOutput == 0` 的全部记录
  （零输出 124 例，其中 `shutdownFactor` 是数值的为 0 例）。
- 数值越界（`<0` 或 `>1`）：**118 例**。

这与 R0 在 SFR 上观察到的同一类缺陷一致（SFR：`NaN` 若干 + 13 例越界），
TS 侧按 `docs/rewrite-plan-r1-r5.md` §3.1.5 统一处理即可（`[0,1]` 定义域、
零输出取 0）。本次**未**改动引擎这一语义。

---

## 6. TS 侧移植要点（由本次实测导出）

1. **字段名按堆型不同**，且 MSR/Turbine 与 SFR 不共享任何统计字段名：

   | 堆型 | editor 字段 |
   |---|---|
   | Overhaul MSR | `totalFuelVessels` `totalCooling` `totalHeat` `netHeat` `totalEfficiency` `totalHeatMult` `totalIrradiation` `functionalBlocks` `sparsityMult` `totalTotalOutput` `shutdownFactor` `numControllers` `missingCasings` `offOutput` |
   | Overhaul Turbine | `bearingDiameter` `bladeCount` `coilEfficiency` `idealityMultiplier` `maxInput` `maxUnsafeInput` `rotorEfficiency` `safeOutput` `throughputEfficiency` `totalEfficiency` `totalFluidEfficiency` `totalOutput` `unsafeOutput` `numControllers` `missingCasings` |

   注意 MSR 用 **`totalTotalOutput`**（不是 `totalOutput`），涡轮用 **`totalPower`
   这个字段根本不存在**——涡轮就是 `totalOutput`（`long`）。`docs/rewrite-plan-r1-r5.md`
   §3.1.2 与 §1.2 事实 4 里写的 "Turbine 用 `totalPower`" 与实测不符，应更正。
2. **`lite` 恒为 null**（§1.1），`divergence` 恒为空。测试框架对这两种堆型不能复用
   SFR 的 `lite` 对拍路径。
3. **重建反应堆**：与 SFR 一样，`blockNames` / `recipeNames` + `grid` / `recipes` +
   `size` 足以完全重建（含外壳）。两点区别：
   - MSR 的 `recipes` 数组里同时出现 `fuel=...` 与 `heaterRecipe=...`；
   - 涡轮的方块**不带配方**，所以 `recipeNames` 是空数组、`recipes` 是长度等于
     `size[0]*size[1]*size[2]` 的全 `-1` 占位数组（实测一例如 `len=392`）。
     涡轮的配方是引擎级 `TurbineRecipe`，不落在方块上；本次生成用的是配置里的第一条
     （`OverhaulTurbine` 构造器在 `recipe==null` 时取 `recipes.get(0)`）。
4. **`bladeCount` 不是叶片总数**：它等于 `blades[]` 里非 null 的**切片数**，
   即内部深度（实测 500/500 条满足 `bladeCount == size[2]-2`）。
   （引擎内部把每层的"叶片位"按 `bearingDiameter*4*(getInternalWidth()/2-bearingDiameter/2)`
   计量，注意 `getInternalWidth()` 返回的是**内部宽度本身**、不是含外壳的尺寸；
   对 `size=[5,5,6]` 即 `1*4*(3/2-0)*4 = 16` 个方块位，与实测一致。）
5. **`shutdownFactor` 的 `"NaN"`**（MSR）与 **`rotorEfficiency` 的 `"NaN"`**（涡轮）
   都按 `docs/rewrite-plan-r1-r5.md` §3.1.5 的规范化层处理。
