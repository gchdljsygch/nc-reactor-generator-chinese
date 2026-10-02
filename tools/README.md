# R0 工具集 — 黄金数据集、元素导出、译文迁移、移植审计

> 这是重写方案 **R0 阶段**（`docs/rewrite-plan.md` §6）的工具与产物。
> 所有工具都**不修改任何产品代码** —— 它们依赖两个已存在的开关让 Java 版脱离 OpenGL 运行。

---

## 1. 为什么能在没有 OpenGL 的环境跑反应堆物理

| 开关 | 位置 | 作用 |
|---|---|---|
| `-Dplannerator.skipTextures=true` | `planner/ncpf/module/TextureModule.java:19` | `convertFromObject` 提前返回，跳过 base64 PNG 解码。NCPF 配置约 10 MB、几乎全是贴图载荷，因此这一步让配置能脱离 GL 加载 |
| `Main.isBot = true` | 读取于 `planner/Core.java:869,875,881` | `Core.warning/error/criticalError` 在解引用 `Core.gui`（headless 下为 null）之前 return |

启动顺序沿用 `MenuInit`（`Core.resetMetadata()` → 注册 reader → 注册 module →
`Core.refreshModules()` → `Configuration.initNuclearcraftConfiguration()` → `Core.setConfiguration()`），
到"应用配置"为止，不创建窗口。实现见 `src/.../Bootstrap.java`。

编辑器侧的计算严格对齐 `Multiblock.recalculate()`：

```java
forceRescan = true;  List<T> blox = getBlocks();  clearData(blox);  validate();  calculate(blox);
```

harness 里就是 `sfr.clearCaches(); sfr.recalculate();`。

---

## 2. 目录结构

```
tools/
├── golden/
│   ├── golden.ps1                     ← 一键编译 + 生成黄金数据集
│   ├── fixtures.ps1                   ← 生成 + 验证格式 fixtures（Overhaul / Underhaul 各一套）
│   ├── historical-fixtures.ps1        ← 从 git 历史提取真实历史格式文件
│   ├── src/net/ncplanner/plannerator/tools/
│   │   ├── Bootstrap.java             ← headless 启动（被下列工具共用）
│   │   ├── GoldenGen.java             ← 黄金数据集 + 编辑器/生成器分歧集
│   │   ├── ElementDump.java           ← NCPF 元素身份导出 + 旧中文化审计
│   │   ├── RoundTrip.java             ← NCPF 格式往返测试 + 单文件读取检查
│   │   ├── FixtureGen.java            ← 各格式 fixtures 生成与往返验证
│   │   └── ConfigFixtureGen.java      ← NCConfig (.cfg) fixtures 合成与验证
│   └── build/                         ← 编译产物（.gitignore）
├── i18n/
│   ├── extract-translations.ps1       ← 从 Java 抽出 1185 条译文
│   └── classify-translations.ps1      ← 拆分为数据名 / UI 文案，产出语言包草稿
└── audit/
    └── port-audit.ps1                 ← 831 个文件逐个归类（移植/重写/丢弃）
```

---

## 3. 用法

### 3.1 生成黄金数据集（R0.3）

```powershell
# 列出支持的堆型（含为何某些类型不可用）
pwsh -File tools/golden/golden.ps1 -SkipCompile ... # 或直接：
java -cp "<cp>" net.ncplanner.plannerator.tools.GoldenGen --list-types

# Overhaul SFR（编辑器 + lite 双引擎，5000 例）
pwsh -File tools/golden/golden.ps1 -Type sfr -Cases 5000 -Seed 20260101 `
     -MinSize 3 -MaxSize 14 -Out datasets/golden/sfr-cases.jsonl

# Underhaul SFR（交叉验证）
pwsh -File tools/golden/golden.ps1 -Type underhaul-sfr -Cases 5000 -Seed 20260101 `
     -MinSize 3 -MaxSize 14 -Out datasets/golden/usfr-cases.jsonl -SkipCompile

# 快速冒烟
pwsh -File tools/golden/golden.ps1 -Type sfr -Cases 200 -Seed 7 -Out "$env:TEMP\smoke.jsonl" -SkipCompile

# 指定策略与尺寸
pwsh -File tools/golden/golden.ps1 -Type sfr -Cases 2000 -Strategies "checker,fuel_mod" -MinSize 5 -MaxSize 12 -SkipCompile

# 只诊断一例（打印坐标探测、逐层 ASCII 图、两个引擎的统计）
pwsh -File tools/golden/golden.ps1 -Type sfr -Cases 1 -Diag -Strategies mixed -MinSize 5 -MaxSize 5 -SkipCompile
```

首次运行会用 `javac` 编译 831 个应用源文件（约 1 分钟）。之后加 `-SkipCompile` 跳过。

**堆型支持**（详见 `docs/r0/golden-datasets.md` §4）：

| `--type` | 双引擎 | 可用性 |
|---|:--:|---|
| `sfr` | ✅ | 已产出 5,000 例 |
| `underhaul-sfr` | ✅ | 已产出 5,000 例 |
| `msr` / `turbine` | ❌ | 可运行，但通用填充造不出**可用**反应堆（统计恒 0） |
| `fusion` | ❌ | 不是长方体网格，本 harness 无法构造 |
| `distiller` | ❌ | 没有任何随附配置包含它的 settings |

统计通过**反射**取堆型对象的全部数值字段（含 private），因此对所有类型通用；
`lastChangeTime` 等非确定性字段被排除，保证数据集可复现。

#### 用真实设计产出黄金数据（`--from-ncpf`）

随机网格的分歧**比例**不能外推到手搭反应堆，所以 harness 支持直接读入真实工程文件：

```powershell
# 单个工程文件，或一个目录（递归找 *.ncpf / *.ncpf.json）
java -cp "<appClasses>;<toolClasses>;src;<jars>" `
     net.ncplanner.plannerator.tools.GoldenGen `
     --from-ncpf path/to/designs --out datasets/golden/imported.jsonl
```

- 扫描 `.ncpf`、`.ncpf.json` **和 `.json`** —— 设计归档通常在 Hellrage `.json` 里；
- 每个 design 按**它自己**的工程配置求值（文件自带配置），因此 addon 配置也能正确评估；
- 记录格式与生成器完全一致，只是 `"strategy":"imported"`，元数据里 `source":"ncpf-import"`；
- 读不进来的文件会打印 `FILE FAILED`（例如含 Overhaul SFR 的工程会撞上 `matches()` bug）；
- 非长方体堆型（如 Fusion）会打印 `skipping non-cuboidal design` 并跳过。

对 `datasets/fixtures/historical/` 实测（19 个真实历史文件）：

```
files           : 19
designs seen    : 1
records written : 1
failed          : 4
DIVERGENCE underhaul.json#1 (underhaul-sfr) -> ["cooling":[720,4880], "netHeat":[10080,5920]]
```

即那个 **2020 年真实存档的用户反应堆**上，两套引擎的散热相差 **6.78×**。
这是整个 R0 里最有说服力的一条证据 —— 分歧不是随机网格的产物。

实测样例（对 `datasets/fixtures/usfr-ncpf-save.ncpf.json` 里的单个设计）：

```
DIVERGENCE usfr-ncpf-save#1 (underhaul-sfr) -> ["power":[30959,30960]]
```

即**结构化**反应堆上两套引擎只差 1（相对差 3e-5），而随机网格上的核心分歧中位差是 4.03×。
这印证了 `docs/r0/golden-datasets.md` §3 的结论：分歧集中在混乱布局的连线逻辑上。

### 3.2 导出 NCPF 元素身份（R0.5 支撑）

```powershell
# 需要先编译过一次（golden.ps1 会生成 tools/golden/build/）
pwsh -File tools/golden/golden.ps1 -Cases 1 -Out "$env:TEMP\throwaway.jsonl"   # 只为编译

java -cp "tools/golden/build/classes;tools/golden/build/tools;src;<jars>" `
     net.ncplanner.plannerator.tools.ElementDump datasets/ncpf-elements.jsonl
```

输出 JSONL，每行一个元素，含**语言无关身份**：

```json
{"config":"default","cfgType":"nuclearcraft:overhaul_sfr","src":"config",
 "type":"legacy_block","def":"nuclearcraft:solid_fission_controller",
 "identity":"legacy_block|nuclearcraft:solid_fission_controller",
 "display":"Solid Fission Controller","legacy":["Solid Fission Controller"]}
```

同时打印旧中文化在 948 个元素显示名上的审计结果（完全翻译 / 中英混排 / 未翻译）。

### 3.3 译文抽取与拆分（R0.5）

```powershell
pwsh -File tools/i18n/extract-translations.ps1
pwsh -File tools/i18n/classify-translations.ps1
```

### 3.4 NCPF 格式往返测试（R0.4）

对仓库里 **38 个生产配置**（`src/configurations/**/*.ncpf.json`，18.7 MB）做
read → write → read → 比对结构指纹。

```powershell
java -cp "<appClasses>;<toolClasses>;src;<jars>" `
     net.ncplanner.plannerator.tools.RoundTrip src/configurations docs/r0/format-roundtrip.md
```

实测结果：**生产保存路径（`NCPFFileWriter`）38/38 指纹完全一致**。

同时暴露了一个必须写进契约的事实：**项目有两个 NCPF writer**

| writer | 用在哪 | 行为 |
|---|---|---|
| `NCPFFileWriter`（`Core.java:611`） | 用户保存工程 | 不裁剪，全保真 |
| `NCPFWriter`（`FileWriter.NCPF`） | 导出单个多方块 | `makePartial()` + 裁剪所有 `plannerator:*` 模块 |

`RoundTrip` 对两者分别取样列。另外 `fusion_test.ncpf.json` 需要先
`Bootstrap.activateModule("fusion_test")` 才能读（模块默认不激活）——
工具里已经这么做了。

### 3.5 文件级移植审计（R0.6）

```powershell
pwsh -File tools/audit/port-audit.ps1
```

### 3.6 格式 fixtures 生成与验证（R0.4）

构造一个已知反应堆 → 用每个 writer 写出 → 用注册的 reader 链读回 → 比对内部方块指纹。
跑两遍：Overhaul SFR（暴露 `matches()` bug）与 Underhaul SFR（对照，应当成功）。

```powershell
pwsh -File tools/golden/fixtures.ps1
```

产物：`datasets/fixtures/`、`docs/r0/fixtures.md`、`docs/r0/fixtures-underhaul.md`、
`docs/r0/fixtures-ncconfig.md`。

脚本还会跑 `ConfigFixtureGen`，为两个 NCConfig（`.cfg`）reader **合成**输入并验证
（它们读的是配置而非设计，没有 writer，无法用环回链路覆盖）：

| fixture | reader | 结果 |
|---|---|---|
| `ncconfig-underhaul.cfg` | `UnderhaulNCConfigReader` | ✅ 读出 90 个元素 |
| `ncconfig-overhaul.cfg` | `OverhaulNCConfigReader` | ❌ **reader 自身抛异常 —— 整条 overhaul `.cfg` 导入路径是死的**（`NCPFListElement.canHaveAmount()==false` 却被传了数量）。见 `docs/r0/findings.md` §11 |

实测：Underhaul **3/6 格式端到端一致**（`NCPFFileWriter` / `NCPFWriter` / `LegacyNCPFWriter`）；
Overhaul 的同样三个格式因 `matches()` 不自反导致 `coolant_recipe: -1` 而读回 NPE。
详见 `docs/r0/findings.md` §8。

#### 真实历史文件语料

```powershell
# 从 git 历史提取 2020–2025 的真实 .ncpf / .json（来源记入 MANIFEST.json）
pwsh -File tools/golden/historical-fixtures.ps1

# 然后跑 reader 覆盖表
java -cp "<appClasses>;<toolClasses>;src;<jars>" `
     net.ncplanner.plannerator.tools.RoundTrip --coverage datasets/fixtures/historical docs/r0/historical-fixtures.md
```

实测 12 个文件里 **9 个读入成功**，`LegacyNCPF10Reader` / `LegacyNCPF11Reader` 首次被真实文件验证；
`LegacyNCPF1Reader` 读不了真实 v1 文件。见 `docs/r0/historical-fixtures.md`。

#### 单文件检查

单独检查某一个文件（报告命中的 reader、是否读入、读出多少元素）：

```powershell
java -cp "<appClasses>;<toolClasses>;src;<jars>" `
     net.ncplanner.plannerator.tools.RoundTrip --check datasets/fixtures/usfr-ncpf-save.ncpf.json

# 对全部 fixture 生成 reader 覆盖表
java -cp "<appClasses>;<toolClasses>;src;<jars>" `
     net.ncplanner.plannerator.tools.RoundTrip --coverage datasets/fixtures docs/r0/fixture-coverage.md
```

---

## 4. 黄金数据集格式（datasetVersion 2）

`datasets/golden/` 下两个文件，gzip 存放。**第一行**是元数据，其余每行一个用例：

| 文件 | 堆型 | 例数 | gz 大小 |
|---|---|---:|---:|
| `sfr-cases.jsonl.gz` | Overhaul SFR | 5,000 | 4.84 MB |
| `usfr-cases.jsonl.gz` | Underhaul SFR | 5,000 | 1.54 MB |

```jsonc
{"id":"sfr-000003","type":"sfr","strategy":"checker","size":[6,12,8],
 "blockNames":["nuclearcraft:solid_fission_cell", "..."],
 "recipeNames":["fuel=leu_235", "..."],
 "grid":  [12,-1,3, ...],   // 索引 = x*dimY*dimZ + y*dimZ + z；-1 = 空
 "recipes": [0,-1,...],     // 同上索引；-1 = 无配方
 "editor": { ...该堆型的全部数值字段... },   // ← 黄金值（用户看到的）
 "lite":   { ...同名字段... },               // ← 生成器引擎；无 lite 时为 null
 "divergence": { "totalFuelCells":[3,64], ... },
 "error": "..." }           // 仅当编辑器引擎自己抛异常时出现
```

要点：

- **`editor` 是黄金值** —— 用户看到的数字。TS 实现必须匹配它。
- **`lite` 是生成器引擎** —— 现存第二份物理实现。它的差异记录在 `divergence`，
  重写后**必须消除**（新实现只有一份物理）。
- **统计字段按堆型而不同**（反射取全部数值字段）。不要假设字段名固定：
  Overhaul SFR 用 `totalOutput`，MSR 用 `totalTotalOutput`，Turbine 用 `totalPower`。
  还包含 `numControllers` / `missingCasings` 这类有效性诊断字段。
- **`error` 的用例没有 `editor` 统计** —— 编辑器引擎自己崩了（见 `docs/r0/findings.md` §10）。
  TS 实现**不得复现**这个崩溃。
- `size` 是**完整网格**尺寸（= 内部尺寸 + 2，外壳各占一层），索引含外壳，可直接重建。
- `blockNames`/`recipeNames` 是语言无关的模板名/配方名。
- 浮点特殊值以字符串 `"NaN"` / `"Infinity"` 表示（JSON 无这些字面量）。
- `lastChangeTime`（挂钟时间戳）被刻意排除，保证数据集可复现。

完整口径、结果与局限见 **`docs/r0/golden-datasets.md`**。

---

## 5. 复现性

| 项 | 值 |
|---|---|
| 数据集种子 | `20260101` |
| 用例数 | 每堆型 5,000 |
| 尺寸范围 | 内部 3..14（配置允许 1..24） |
| 策略 | `random` `mixed` `fuel_mod` `fuel_only` `casing_only` `fuel_heatsink` `checker` |
| 堆型 | `sfr`、`underhaul-sfr`（双引擎）；其余见 §3.1 的矩阵 |
| 编译器 | `javac`（任何 ≥21 的 JDK 均可；实测 25） |
| 依赖 | `libraries/*.jar` + `libraries/DizzyEngine/*.jar`（排除 `*-sources.jar` / `*-javadoc.jar`） |

产品代码零改动，因此任何时候都能用同一份源码 + 同一种子重放出同一数据集。

---

## 6. 已知限制

1. **样本是随机方块网格**，很多物理上不合理。分歧**比例**不能直接外推到真实手搭反应堆，
   但"同一份网格、两套引擎给出中位 4× 差异"这一事实与样本是否现实无关。
2. **没有真实用户设计样本**。R0.3 的收尾需要一个 `--from-ncpf <file>` 模式 + 一批社区 `.ncpf`。
3. **只有 SFR 两个堆型能产出可用数据**（见 §3.1 矩阵）：
   MSR / Turbine 的通用填充造不出可用反应堆（统计恒 0），
   Fusion 不是长方体网格，Distiller 没有随附配置。
4. `tools/golden/build/` 是本地编译产物，已加入 `.gitignore`。
