# R0.7 — 兼容性契约定稿

> 目标：定义重写版（TypeScript / Web）**必须**能读写的格式范围，以及检测规则。
> 依据：`MenuInit.java:76-105` 的 reader 注册表（含版本注释）、各 reader 的
> `formatMatches()` 实现、`FileFormat.java` 的导出格式枚举。
>
> **本文档是 R0 的决策产物，需要用户最终确认**（见文末「待确认项」）。

---

## 1. 总原则

1. **读优先。** 老用户手里是历史文件，读不进来就是数据丢失；写只需要覆盖当前格式 + 最常用的交换格式。
2. **检测规则必须原样复刻。** 现有实现依赖"按注册顺序依次尝试 `formatMatches`"，且**最新的版本排在前面**。这个顺序是隐式契约，TS 侧必须一致，否则同一文件会被错误的 reader 接走。
3. **读进来的东西语义等价即可，不要求逐字节往返。** 老格式本身信息有损（例如缺 `display_name`、缺贴图），现有代码也会做推断。
4. **写出必须能被冻结的 Java 版本读回。** 这是唯一可自动化的往返测试。

---

## 2. 输入格式（读）

### 2.1 必须支持（P0）

| 格式 | 扩展名 | 检测规则 | 文件 | 行数 |
|---|---|---|---|---:|
| **NCPF（现代）** | `.ncpf.json` | 恒定 `true`，**注册在最后**，作为兜底 | `NCPFReader` → `NCPFFileReader` | 18 + 377 |
| Legacy NCPF v11 | `.ncpf` | `Config.version == 11` | `LegacyNCPF11Reader` | 1,363 | ✅ **真实文件验证通过**（2021–2022 共 7 个） |
| Legacy NCPF v10 | `.ncpf` | `Config.version == 10` | `LegacyNCPF10Reader` | 125 | ✅ **真实文件验证通过**（2021 共 2 个） |
| Legacy NCPF v9 | `.ncpf` | `Config.version == 9` | `LegacyNCPF9Reader` | 739 | ⏳ 无真实样本 |
| Hellrage SFR v6 | `.json` | `SaveVersion.Major==2`，`Data.FuelCells` 存在，键**不以** `[F4]` 开头 | `OverhaulHellrageSFR6Reader` | 165 |
| Hellrage MSR v6 | `.json` | `SaveVersion.Major==2`，`Data.FuelCells` 存在，键**以** `[F4]` 开头 | `OverhaulHellrageMSR6Reader` | 164 |
| Underhaul Hellrage v2 | `.json` | `major==1 && minor==2 && build>=23` | `UnderhaulHellrage2Reader` | 53 |

### 2.2 建议支持（P1，取决于老用户分布）

| 格式 | 检测规则 | 文件 |
|---|---|---|
| Hellrage SFR v5 | `Major==2`，`SaveVersion.Minor/Build` 落在 2.0.32–2.0.37，顶层 `FuelCells` | `OverhaulHellrageSFR5Reader` |
| Hellrage MSR v5 | 同上 + `[F4]` 前缀 | `OverhaulHellrageMSR5Reader` |
| Hellrage SFR v4 | 2.0.31 | `OverhaulHellrageSFR4Reader` |
| Hellrage MSR v4 | 2.0.31 | `OverhaulHellrageMSR4Reader` |
| Hellrage SFR v3 | 2.0.30 | `OverhaulHellrageSFR3Reader` |
| Hellrage MSR v3 | 2.0.30 | `OverhaulHellrageMSR3Reader` |
| Legacy NCPF v8 | `Config.version == 8` | `LegacyNCPF8Reader` |
| Underhaul Hellrage v1 | `major==1 && minor==2 && 5<=build<=22` | `UnderhaulHellrage1Reader` |
| NCConfig（underhaul）`.cfg` | `fission.fission_cooling_rate` 存在 | `UnderhaulNCConfigReader`（102 行）—— ✅ 已验证可读 |
| NCConfig（overhaul）`.cfg` | `fission.fission_sink_cooling_rate` 存在 | `OverhaulNCConfigReader`（433 行）—— ❌ **reader 自身抛异常，整条路径不可用**（见 §5） |

### 2.3 明确不移植（P2）

| 格式 | 理由 |
|---|---|
| Hellrage SFR/MSR v1、v2 | 对应 NuclearCraft 2.0.1–2.0.29，年代久远 |
| Legacy NCPF v1–v7 | 早于当前主流版本。注：**v1 已确认读不了真实文件**（NPE），见 `docs/r0/findings.md` §12.2 |
| `config2` 设置文件 | 只写一次性迁移 CLI（见 §4） |
| DSSL 脚本（`.dssl`） | 无随附脚本、无配置引用；若确有需求，Web 栈用 JS 沙箱替代 |

**把 8,166 行（53 文件）的格式 IO 压到约 2,500–3,000 行（P0 + 一部分 P1）。**

---

## 3. 输出格式（写）

> ⚠️ **R0.4 实测补充：项目里有两个 NCPF writer，保真度不同，TS 侧必须分别实现。**
>
> | writer | 用在哪 | 行为 | 往返实测 |
> |---|---|---|---|
> | `NCPFFileWriter`（`Core.java:611`） | **用户保存工程** | `project.convertToObject()` 后直接写，**不裁剪任何模块** | **38 / 38 指纹完全一致** ✅ |
> | `NCPFWriter`（`FileWriter.NCPF`，`MenuMain:316-320`） | **导出单个多方块** | 先 `makePartial()`（只保留被设计引用到的元素），再 `trimPlanneratorModules()`（删掉所有非 `ncpf:` 前缀模块 → `plannerator:display_name` / `texture` / `legacy_names` 全丢） | 配置类文件无设计 → 元素被全部剥离（设计如此） |
>
> 混用这两者的后果：要么用户保存的工程丢显示名与贴图，要么导出的多方块文件塞进整份配置。
>
> 另：**模块激活状态影响配置文件可读性**。`fusion_test.ncpf.json` 随仓库发布，但其
> `fusion_test` 模块默认不激活，**默认安装读不了这个文件**；激活后 38/38 全部通过。
> TS 侧必须复刻这一行为（否则会把"模块未激活"误判成"文件损坏"）。

| 格式 | 现状 writer | 建议 | 说明 |
|---|---|---|---|
| **NCPF — 保存语义** | `NCPFFileWriter` + `JSONNCPFWriter` | ✅ **必须** | 全保真，往返测试的基础 |
| **NCPF — 导出语义** | `NCPFWriter` | ✅ **必须** | `makePartial` + 裁剪 `plannerator:*` |
| Hellrage Reactor | `HellrageWriter`（257 行） | ✅ **必须** | 唯一的第三方交换格式（Hellrage 规划器互通） |
| PNG 图片 | `PNGWriter`（168 行） | ✅ 建议 | 分享设计图 |
| Legacy NCPF | `LegacyNCPFWriter`（830 行） | ❌ **不写** | 只读不回写；用户要降级请用冻结的 Java 版 |
| BG String | `BGStringWriter`（171 行） | ⏸ 按需 | Building Gadget 蓝图字符串 |
| ZenScript | `ZenScript` | ⏸ 按需 | CraftTweaker 脚本；取决于是否有人用 |
| DSSL | — | ❌ | 同上 |

> ⚠️ **`HellrageWriter` 有一个必须处理的陷阱**：它通过**从英文显示名剥离词缀**生成方块名
> （`HellrageWriter.java:63,112,126,140,154`，例如 `StringUtil.superRemove(b.getDisplayName(), "Reactor Cell", "Fuel Cell", ...)`）。
> 这是重写方案「根因 5：把英文显示名当标识符」的一个实例。TS 侧必须改用**语言无关的
> 元素身份**（见 `docs/r0/findings.md` §4），否则一旦数据名被本地化，导出文件就会损坏。

---

## 4. 设置文件迁移

现状：`settings.dat` 由 `config2` 包（12 文件 / 1,399 行）读写，`Core.java:342-379` 保存
theme / modules / overlays / dssl / vsync / 光标校准 / pins 等 20 余项。

**决定**：不移植 `config2`。改为：

1. 新版本设置用 JSON（`settings.json`），与 NCPF 一样可人工编辑；
2. 提供一个**一次性迁移 CLI**，读取旧 `settings.dat` 并输出新 `settings.json`；
3. 新版本同时新增 `language` 字段（现状缺失，见 `docs/refactoring-plan.md` 根因 3）。

---

## 5. 往返测试要求（R0.4 的实现依据）

对每个 P0/P1 格式：

1. 从冻结的 Java 版本**生成** fixtures —— 构造一个已知反应堆，用对应 writer 写出；
2. 用对应的 reader 读回，断言**语义等价**（方块网格 + 燃料 + 配置 + 冷却配方）；
3. 新实现必须：(a) 能读入同一批 fixtures 得到相同语义；(b) 写出的文件能被冻结的 Java 版本读回。

| **已产出**：`datasets/fixtures/`（含 `README.md`），由 `tools/golden/fixtures.ps1` 生成。
逐格式结果见 `docs/r0/fixtures.md`（Overhaul SFR）、`docs/r0/fixtures-underhaul.md`（对照）、
`docs/r0/fixtures-ncconfig.md`（`.cfg`）；**reader 覆盖表**见 `docs/r0/fixture-coverage.md`
（每个 fixture 命中的 reader、结果、元素数）。

**已通过真实历史文件验证**（`docs/r0/historical-fixtures.md`，12 个文件 / 9 个读入成功）：
`LegacyNCPF10Reader`、`LegacyNCPF11Reader` —— 这是本节 P0 的两项，现已用**真实文件**而非合成样本确认。
**已通过合成 fixture 验证**：`NCPFReader`、`UnderhaulNCConfigReader`。

**已确认读不了真实文件的**：`LegacyNCPF1Reader`（真实 2020 v1 文件 NPE，见
`docs/r0/findings.md` §12.2）、`OverhaulHellrageSFR5Reader`（真实 2020 Hellrage 存档
`Invalid block name: Cf-252!`，§12.3）、`OverhaulNCConfigReader`（§11 死路径）。

**仍未验证**：`LegacyNCPF2`–`v9`、Hellrage MSR v1–v6、Underhaul Hellrage v1。
补齐方式：往 `tools/golden/historical-fixtures.ps1` 的路径清单里加更多历史文件（或提供社区老存档）。

**`.cfg`（NCConfig）单独说明**：这两个 reader 读的是**配置**而不是设计，没有对应的 writer，
所以无法用环回链路覆盖。R0 按 reader 源码**逐属性合成**了 fixture：

| fixture | reader | 结果 |
|---|---|---|
| `ncconfig-underhaul.cfg` | `UnderhaulNCConfigReader` | ✅ 读出 90 个元素，配置名 `Underhaul SFR Configuration` |
| `ncconfig-overhaul.cfg` | `OverhaulNCConfigReader` | ❌ **reader 自身抛异常** —— 见下 |

> ⚠️ **Overhaul 的 `.cfg` 导入路径完全不可用。** `OverhaulNCConfigReader:129-131` 无条件地把
> `new NCPFListElement(...)` 传给 `builder.irradiatorRecipe(...)`，而
> `OverhaulSFRConfigurationBuilder:188` 执行 `new NCPFElementStack(definition, 1)`；
> `NCPFListElement.canHaveAmount()` 是 `false`，构造函数直接抛
> `IllegalArgumentException`。原本为此存在的 `getRecipeContainedAlternative()` **全代码库零调用**。
>
> 后果：**任何** overhaul `nuclearcraft.cfg` 都读不进来（NuclearCraft 2.x 配置导入是一条死路径）。
> Underhaul 同路径正常（它不构造 list 型输入）。
>
> **TS 实现应按修复后的语义实现**：用 `getRecipeContainedAlternative()`，或让 list 定义可带数量。
> 不要复刻这个崩溃。详见 `docs/r0/findings.md` §11。

| 格式 | Overhaul SFR | Underhaul SFR（对照） |
|---|---|---|
| `NCPFFileWriter`（保存语义） | ❌ NPE，`coolant_recipe` 被写成 -1 | ✅ 内部方块指纹一致 |
| `NCPFWriter`（导出语义） | ❌ 同上 | ✅ |
| `LegacyNCPFWriter` | ❌ 同上 | ✅ |
| `HellrageWriter` | ❌ `Invalid fuel name: MOX-241!` | ❌ `Invalid block name: !` |
| `BGStringWriter` | ❌ 无法表达 oredict 方块 | ❌ 同 |
| `PNGWriter` | ❌ headless 下需要 GL | ❌ 同 |

> ⚠️ **Overhaul 侧三个 NCPF/Legacy 格式的读回失败是产品 bug，不是格式缺陷。**
> `NCPFSettingsElement.matches()` 不满足自反性（实测 `x.matches(x) == false`），
> 原因是它的 `Set` 分支假设集合元素是 `NCPFElementDefinition`，而
> `NCPFLegacyRecipeElement.inputs/outputs` 实际是 `HashSet<NCPFElementStack>`。
> 因此任何 `legacy_recipe` 元素都匹配不上，`setIndex` 写成 -1，读回时字段为 null → NPE。
>
> **TS 实现不应复刻这个行为。** 正确做法：配方引用直接写**元素身份**
> （见 `docs/r0/findings.md` §4），不要用「配置内索引 + 结构相等」。
> 完整分析见 `docs/r0/findings.md` §8。

**关于 Hellrage**：`HellrageWriter` 用**剥离词缀后的显示名**当方块名/燃料名，而 reader 用
`LegacyNamesModule.legacyNames` 匹配（`NonRecoveryHandler.recoverFallbackName`）—— 两者对不上就抛异常。
这是「把显示名当标识符」的又一实例；TS 侧必须改用身份或 `legacyNames`。
此外 Hellrage 读写都**不含外壳**（`HellrageWriter.java:54`），比对时只比内部方块。

---

## 6. 检测顺序（已确定，必须逐条复刻）

`FileReader.read`（`FileReader.java:19-32`）的**实际**逻辑：

```java
for(FormatReader reader : formats){          // 正序遍历
    if(reader.formatMatches(provider)){
        Project project = reader.read(provider, handler, fileContext);
        if(project==null)continue;           // ← 关键："其实格式不匹配，虚惊一场"
        return project.copyTo(Project::new);
    }
}
throw new IllegalArgumentException("Unknown file format!");
```

因此 `NCPFReader`（注册在**第 1 位**，`formatMatches` 恒 `true`）并不是优先级陷阱：
它总是先被尝试，但 `NCPFFileReader.read` 在 `NCPFFileReader.java:54` 对非 NCPF 文件
**返回 `null`**（原文注释：*"another way of saying 'this isn't NCPF, invalid format'"*），
于是 `continue` 落到 Legacy/Hellrage/NCConfig 系列。

**确定的解析顺序**（正序，先命中且 `read()` 返回非 null 者胜）：

```
1.  NCPFReader                    // 恒 true，靠 read() 返回 null 让位
2.  LegacyNCPF11Reader
3.  LegacyNCPF10Reader
4.  LegacyNCPF9Reader
5.  LegacyNCPF8Reader
6.  LegacyNCPF7Reader
7.  LegacyNCPF6Reader
8.  LegacyNCPF5Reader
9.  LegacyNCPF4Reader
10. LegacyNCPF3Reader
11. LegacyNCPF2Reader
12. LegacyNCPF1Reader
13. OverhaulHellrageSFR6Reader    // 版本从新到旧
14. OverhaulHellrageSFR5Reader
15. OverhaulHellrageSFR4Reader
16. OverhaulHellrageSFR3Reader
17. OverhaulHellrageSFR2Reader
18. OverhaulHellrageSFR1Reader
19. UnderhaulHellrage2Reader
20. UnderhaulHellrage1Reader
21. OverhaulHellrageMSR6Reader
22. OverhaulHellrageMSR5Reader
23. OverhaulHellrageMSR4Reader
24. OverhaulHellrageMSR3Reader
25. OverhaulHellrageMSR2Reader
26. OverhaulHellrageMSR1Reader
27. OverhaulNCConfigReader
28. UnderhaulNCConfigReader
```

补充：现代 NCPF 下面还有一层子注册表 `NCPFFileReader.formats`（当前只有 `JSONNCPFReader`），
`NCPFFileReader` 同样按列表顺序尝试、以 `null` 表示不匹配。

**TS 侧实现要求**：把上面的顺序写成一张表，逐个尝试；每个探测器的"返回 null 表示不匹配"
语义必须保留（不要改成抛异常），否则错误文件会被更宽松的 reader 误吞。

---

## 7. 待确认项（需要用户拍板）

| # | 决策 | 建议 | 影响 |
|---|---|---|---|
| C1 | P0 集合是否够（NCPF + LegacyNCPF v9–v11 + Hellrage v6 + Underhaul Hellrage v2） | 是 | 决定兼容层工作量 |
| C2 | P1 里哪些真的需要（需要老用户样本/反馈） | 先做 NCConfig + Hellrage v5 | 约 1,000 行 |
| C3 | 是否需要写出 Legacy NCPF / BG String / ZenScript | 否（用冻结的 Java 版降级） | 省约 1,000 行 |
| C4 | 是否接受"设置文件需要一次性迁移" | 是 | 省 1,399 行 |

---

*依据文件：`MenuInit.java`、`FileFormat.java`、`FormatReader.java`、各 `*Reader.formatMatches()`、
`Core.java:342-379`、`HellrageWriter.java`。*
