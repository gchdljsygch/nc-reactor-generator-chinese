# R0.4 — 格式兼容性回归语料（fixtures）

> 由 `tools/golden/fixtures.ps1` 生成。**请勿手工编辑**这些文件。
> **生成器已在 `docs/java-exit-plan.md` §P4 随 Java 树归档**；文件本身已入库，
> `pnpm test` 直接读它们，不需要 Java。要重跑生成器先取回冻结树：
> `git checkout java-frozen-c79c557f -- src tools/golden libraries nbproject build.gradle build.xml`
>
> 详细逐格式验证结果见 `docs/r0/fixtures.md`（Overhaul SFR）与
> `docs/r0/fixtures-underhaul.md`（Underhaul SFR 对照）。

## 这是什么

仓库里**没有**任何历史格式的真实样本（`git ls-files` 中无 `.ncpf` / hellrage `.json`）。
因此这批 fixtures 由**冻结的 Java 版自己产出**：构造一个已知反应堆 → 用每个 writer 写出 →
再用注册的 reader 链读回 → 比对反应堆的内部方块指纹。

它们固化的是**当前实现的实际输出**，用作 TS 重写版的兼容性回归基准。

## 参考反应堆

| 前缀 | 堆型 | 尺寸 | 内部方块 | 外壳 |
|---|---|---|---:|---:|
| `sfr-` | Overhaul SFR | 5×5×5 | 125 | 218 |
| `usfr-` | Underhaul SFR（对照） | 5×5×5 | 125 | 151 |

两者都是确定性构造：`buildDefaultCasing()` 生成完整外壳（含控制器），
内部按 `(x+y+z)` 奇偶交替放置燃料单元与慢化剂，燃料用固定种子随机选取。

## 文件清单

| 文件 | 格式 | writer | 能读回？ |
|---|---|---|---|
| `usfr-ncpf-save.ncpf.json` | NCPF（保存语义） | `NCPFFileWriter` | ✅ 内部方块指纹一致 |
| `usfr-ncpf-export.ncpf.json` | NCPF（导出语义） | `NCPFWriter` | ✅ 内部方块指纹一致 |
| `usfr-legacy-ncpf.ncpf` | Legacy NCPF | `LegacyNCPFWriter` | ✅ 内部方块指纹一致 |
| `usfr-hellrage.json` | Hellrage JSON | `HellrageWriter` | ❌ `Invalid block name: !` |
| `sfr-ncpf-save.ncpf.json` | NCPF（保存语义） | `NCPFFileWriter` | ❌ NPE（见下） |
| `sfr-hellrage.json` | Hellrage JSON | `HellrageWriter` | ❌ `Invalid fuel name: MOX-241!` |
| `ncconfig-underhaul.cfg` | NCConfig（`.cfg`） | 合成（无 writer） | ✅ `UnderhaulNCConfigReader` 读出 90 元素 |
| `ncconfig-overhaul.cfg` | NCConfig（`.cfg`） | 合成（无 writer） | ❌ reader 自身抛异常（产品 bug，见下） |

**为什么 Overhaul 的 NCPF 文件读不回**：这是一个已确认的产品 bug，
`NCPFSettingsElement.matches()` 对 `legacy_recipe` 元素不满足自反性
（实测 `x.matches(x) == false`），导致设计里的 `coolant_recipe` 被写成索引 `-1`，
读回时该字段为 `null` 并在 `OverhaulSFRDesign.convertFromObject` 抛 NPE。
完整分析与代码位置见 `docs/r0/fixtures.md` 的「发现」章节。

**R0 不修复它**：R0 的目的是冻结 Java 版并记录基线。修复会改变 fixture 输出，
使基线失去可比性。修复要点已记录，可作为独立改动，或在 TS 实现中自然消失
（TS 侧不应使用「配置内索引 + 结构相等」来表示配方引用）。

## `historical/` —— 真实历史文件（从 git 历史提取）

上面的 fixture 都是用**当前** writer 写出的，不含版本多样性。仓库里也没有历史样本 ——
但**本仓库自己的 git 历史里就有真实的历史文件**：2020–2025 年间当时的软件写出的
`.ncpf` / `.json`，后来被陆续转换成了 `*.ncpf.json`。

`tools/golden/historical-fixtures.ps1` 把它们提取到这里，来源与提交号记在 `MANIFEST.txt`。
共 **19 个文件（2020–2023），15 个读入成功、4 个失败**：

| reader | 真实文件数 | 结果 |
|---|---:|---|
| `LegacyNCPF10Reader` | 5 | ✅ 2 / 4 / 86 / 91 / 94 元素 |
| `LegacyNCPF11Reader` | 9 | ✅ 44 / 83 / 86 / 94 / 116 / 246 / 529 / 606 / 622 元素 |
| `UnderhaulHellrage2Reader` | 1 | ✅ 读出 1 个设计（`underhaul.json`, 2020） |
| `LegacyNCPF1Reader` | 2 | ❌ `NullPointerException: "<local5>.settings" is null` |
| `OverhaulHellrageSFR5Reader` | 1 | ❌ `Invalid block name: Cf-252!` |
| `LegacyNCPF11Reader` (`fusion_test.ncpf`) | 1 | ❌ `UnknownNCPFModule` CCE —— 该文件需要 `fusion_test` 模块激活 |

逐文件结果见 `docs/r0/historical-fixtures.md`，分析见 `docs/r0/findings.md` §12。

**价值**：这批文件把兼容性验证从「合成样本」升级为**真实文件**，
`LegacyNCPF10Reader` / `LegacyNCPF11Reader`（契约里的 P0 项）由此首次得到确认；
同时暴露了 `LegacyNCPF1Reader` 读不了真实 v1 文件，以及 Hellrage 的显示名匹配在真实老存档上同样失败。

## NCConfig（`.cfg`）fixtures 为什么是"合成"的

`OverhaulNCConfigReader` / `UnderhaulNCConfigReader` 读的是 **NuclearCraft 模组的 Forge 配置**
（`config/nuclearcraft.cfg`），不是规划器写出的文件：

- 输入是配置而非设计，所以没有「构造反应堆 → writer 写出」这条链路；
- 规划器**只能读不能写** `.cfg`，没有对应的 writer；
- 仓库里也没有任何真实 `.cfg` 样本。

因此这两个 fixture 由 `tools/golden/src/.../ConfigFixtureGen.java` 按 reader 源码**逐属性合成**：
标量/列表与元素类型取自 reader 使用的访问器（`getInt`→`I:`、`getDouble`→`D:`、
`getString`→`S:`、`getBoolean`→`B:`），列表长度取自 reader 里出现的最大字面量下标，
燃料族的长度取自 `addFuels`/`addSFRFuels` 的实参个数。
详见 `docs/r0/fixtures-ncconfig.md`。

> ⚠️ `ncconfig-overhaul.cfg` 本身是完整的，但 **overhaul 的 `.cfg` 导入路径是死的**：
> `OverhaulNCConfigReader:129-131` 无条件给 `NCPFListElement`（`canHaveAmount()==false`）传数量，
> 构建器抛 `IllegalArgumentException`。这是产品 bug，不是 fixture 的问题。
> Underhaul 同路径正常。详见 `docs/r0/findings.md` §11。

## 未产出的格式

| 格式 | 原因 |
|---|---|
| BG String | `Cannot export element definition in BG String: oredict (...)` —— 该格式无法表达 oredict 引用的方块 |
| PNG | `PNGWriter` 需要 GL 上下文与已加载字体，headless harness 下无法测试 |
| Legacy NCPF v9-v11 / Hellrage v1-v5 / Underhaul Hellrage v1 / MSR / Turbine / Fusion / Distiller | 见 `docs/r0/fixtures.md` 与 `docs/r0/findings.md` §13 的待办清单 |

写失败的 writer 不会留下 0 字节文件（`FixtureGen` 会清理）。

## 怎么用

> 生成/校验命令需要冻结树与 JDK（见文首）；**日常不需要跑**——fixtures 已入库，
> TS 侧的测试直接读文件。

```powershell
# 重新生成（需要先跑过一次 tools/golden/golden.ps1 来编译应用类）
pwsh -File tools/golden/fixtures.ps1

# 单独读取验证
java -cp "<appClasses>;<toolClasses>;src;<jars>" `
     net.ncplanner.plannerator.tools.RoundTrip --check datasets/fixtures/usfr-ncpf-save.ncpf.json
```

TS 侧的验收口径见 `docs/r0/fixtures.md` 的「TS 实现的验收口径」章节。

## 局限

1. 这批文件是**当前实现的输出**，不是历史版本的真实存档。要覆盖真实的版本多样性，
   需要收集社区的老文件（见 `docs/r0/findings.md` §10）。
2. 只覆盖 Overhaul / Underhaul SFR；MSR / Turbine / Fusion / Distiller 尚未加入。
3. 参考反应堆是**合成的**，不含端口、中子源、辐照器等带配方的方块，
   因此没有覆盖「方块配方」的往返路径。
