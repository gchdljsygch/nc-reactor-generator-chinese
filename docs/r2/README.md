# R2 状态报告 — 格式兼容层

> 计划：`docs/rewrite-plan-r1-r5.md` §5（R2.1–R2.12）、§11.3（CI 门禁）。
> 本文件是 **R2 的唯一状态入口**：每项任务做了什么、证据在哪、什么没做。
> 所有"通过"都可以用文中的命令复现；没有实测支撑的项一律标 `未验证`。

---

## 0. 一句话结论

**R2 交付。** 兼容层的验收标准是「同一个文件，TS reader 读出的 NCPF 树与冻结版 Java
reader 的转换结果**结构 + 指纹**完全一致」，而这条线现在有 36 个 fixture、21 个 Java 金样本：

| 指标 | 数值 |
|---|---:|
| fixture 总数 | 36 |
| 冻结版 Java 读入成功（有金样本） | 21 |
| **TS 与 Java 金样本结构 + 指纹一致** | **21 / 21** |
| **TS 读入成功** | **36 / 36** |
| TS 读入失败 | 0 |
| 其中：Java 会抛异常、TS 按"修复后语义"读入 | 15（9 个 v1/v2/v5/v8 + 6 个 R2.9/R2.10/写侧缺陷文件，见 §4） |

覆盖表（TS 侧、机器生成）：**`docs/r2/fixture-coverage.md`**
（`pnpm r2:coverage` 重新生成，CI 断言"重新生成后无 diff"）。

```powershell
pnpm install
pnpm verify          # typecheck + lint + 全量测试（含 R2 全部 golden 断言）
pnpm r2:coverage     # 重新生成 docs/r2/fixture-coverage.md
pnpm build:app; pnpm size     # R3 的构建体积门禁
```

---

## 1. 任务清单

| # | 任务 | 状态 | 产物 / 证据 |
|---|---|---|---|
| R2.1 | NCPF 读取完善（addons、`legacy_names`、全局元素） | ✅ R1.4 已交付 | 38/38 指纹 → `docs/r1/r1.4-ncpf-io.md` |
| R2.2 | LegacyNCPF **v10/v11** 只读 | ✅ | `legacy/ncpf11.ts` + `legacy/ncpf10.ts`；**12 个 v11 + 6 个 v10 fixture**，其中有金样本的 11 + 6 个**结构 + 指纹全等**（第 12 个 v11 文件 `fusion_test.ncpf` 是 Java 会抛异常的修复后语义读取） |
| R2.3 | LegacyNCPF **v9** 只读 | ✅ | `legacy/ncpf09.ts`（1,141 行，`LegacyNCPF9Reader extends LegacyNCPF10Reader`，order 3）；**v9 本身没有样本**（见 §4），共享的装载器用 v10 金样本做交叉验证：同一 modpack 的 `po3.ncpf`(v10) 与 `po3-v5.ncpf`(v5) 在配置键、`underhaul_sfr` 全部设置值、active cooler 合并结果上逐字段一致，且只在 v9 必须不同的地方不同（无 `legacy_names`、无 fusion 配置） |
| R2.4 | LegacyNCPF **v1** 只读（按修复后语义） | ✅ | `legacy/ncpf01.ts`…`ncpf08.ts`；**9 个真实样本**（v1 ×4、v2 ×2、v5 ×2、v8 ×1）全部读入，命中的 reader 与 `MANIFEST.json` 逐条一致，且 `matches()` 的负向对照在**全部 36 个 fixture × 11 个版本**上成立 |
| R2.5 | Hellrage SFR **v6** 只读 + Hellrage 写出 | ✅ | `legacy/hellrage.ts`（读）+ `legacy/hellrageWriter.ts`（写）+ `test/r2.5-hellrage-write.test.ts`（19 项）；Java `-Probe` 回读见 §3.3 |
| R2.6 | Hellrage **underhaul** 只读 | ✅ | `UnderhaulHellrage2Reader` 读 `underhaul.json`（金样本 0 元素/1 设计一致）与 90 元素的 `usfr-hellrage.json` |
| R2.7 | Hellrage v1–v5 / MSR v1–v6 只读 | ⛔ 降级为 P2 | 计划本身允许："若拿不到，明确降级为 P2 并写进契约"。SFR v5 **已顺带交付**（`historical/overhaul.json` 由 `OverhaulHellrageSFR5Reader` 读入）；MSR 各版本无样本 |
| R2.8 | NCConfig underhaul `.cfg` 只读 | ✅ | `legacy/ncconfig.ts`；`ncconfig-underhaul.cfg` 90 元素、指纹全等 |
| R2.9 | NCConfig overhaul `.cfg` 只读（按修复后语义） | ✅ | Java 抛 `Cannot create an element stack…`；TS 读入 **777 元素**（差异与理由见 §3.2） |
| R2.10 | **关键**：Hellrage 用 `legacyNames` / 元素身份匹配 | ✅ | 3 个 Java 会抛 `Invalid … name` 的 fixture 全部读入；`r2.2` 的 fixed-semantics 断言 **12/12**（6 个文件 × 读取 + 命中 reader） |
| R2.11 | `config2`（`settings.dat`）一次性迁移 CLI | ✅ | `tools/ts/migrate-settings.mjs` + `legacy/settings.ts` + `test/r2.11-settings.test.ts`（10 项）；端到端实测见 §3.4 |
| R2.12 | PNG 导出 | ✅ | `app/src/model/imageExport.ts`（纯布局）+ `app/src/ui/imageExport.ts`（canvas）+ `test/imageExport.test.ts`（8 项）；浏览器内的目视验收步骤见 `docs/r3/README.md` §4 |

**计划 §5 的硬要求**（每个 reader 记一行、TS 侧产出自己的覆盖表、字段与 R0 一致）：
`docs/r2/fixture-coverage.md` 由 `tools/ts/r2-coverage.mjs` 生成，逐列对应
`docs/r0/fixture-coverage.md` 的 fixture / 命中的 reader / 同时匹配 / 读入 / 元素数 / 设计数 / 结果。

---

## 2. 验收标准与判定

### 2.1 结构 + 指纹全等（21/21）

`packages/formats/test/r2.2-legacy-goldens.test.ts` 对每个有金样本的 fixture 断言三件事：

1. 命中的 reader 与 Java 一致；
2. 读出的树与 `datasets/converted/ncpf/<fixture>.ncpf.json` **结构全等**
   （`jsonDiff` 逐路径比较，键序不敏感、数组序敏感）；
3. 元素数 / 设计数 / R0 指纹与 `MANIFEST.json` 一致。

判据不放松的理由：R0 指纹把**模块存在性**折进哈希，因此多一个空模块、少一条
`legacy_names` 都会在这里失败（本次移植中确实靠它抓到了 6 类真实缺陷，见 §3.1）。

### 2.2 "同时匹配"列

`docs/r2/fixture-coverage.md` 的 TS 表列出每个文件被哪些 reader 声明匹配。
`NCPFReader` 的 `formatMatches` 恒为 true（它靠 `read()` 返回 null 让位），
其余 reader 靠版本号 / 容器特征互相排斥——目前每个文件的 legacy 命中数为 0 或 1。

### 2.3 CI 门禁（§11.3）

| 检查 | 落点 | 结果 |
|---|---|---|
| 单元测试全绿 | `pnpm test` | 475 passed / 2 skipped |
| fixtures 读取清单 | `r2.2-legacy-goldens.test.ts`（75 项）+ `r2.3-legacy-ncpf-chain.test.ts`（45 项） | 36/36 读入，21/21 金样本全等 |
| NCPF 往返指纹 38/38 | R1.4 测试 | 通过 |
| 裸字符串 lint | `pnpm lint` | 核心包 0 命中 |
| i18n 覆盖率（未翻译 key = 0） | `pnpm i18n:audit` | 通过 |
| 构建体积（不含数据集 < 15 MB） | `pnpm build:app && pnpm size` | 1.57 MB |
| 覆盖表不过期 | CI：`pnpm r2:coverage` + `diff` | 通过 |

一条命令跑完全部：`pnpm verify:full`（exit 0）。

---

## 3. 关键证据

### 3.1 移植中抓到的真实缺陷（金样本 diff 驱动）

六个 v11/v10 fixture 最初全部不一致，逐条定位到的**读侧**缺陷：

1. **`blockstate` 丢失**（4 个 fixture）：TS 的 element 是 definition 的**扁平拷贝**，而 Java
   对 `block.definition` 就地 `blockstate.put("active", false)`。拷贝后再改 definition 不再可见。
   命中点：SFR/MSR 的 neutron shield、SFR coolant vent（4 处，均按 Java 行号标注）。
2. **`legacy_names` 写进了错误的模块**：`recip.withModuleOrCreate(LegacyNamesModule::new, …)`
   写在**配方元素**上，TS 写进了 `plannerator:display_name` 模块里（SFR/MSR 配方各一处）。
3. **turbine coil 的规则索引永远解析不到**：`coil.rules = rules.map(cloneJson)` 克隆了规则对象，
   而索引是在所有方块读完之后才回填的——克隆体拿不到回填。Java 是**建两次**（`:1139-1140`）。
4. **`legacyElementJson` 无条件写 `name`**：`NCPFLegacyRecipeElement` 没有 `name` 设置项，
   所以冷却液配方不该有 `name` 键。
5. **active cooler 的 `metadata` 未同步删除**（`definition.metadata = null` 的扁平拷贝版本）。
6. **NCConfig 的一条冷却规则用了方块引用而不是模块引用**
   （`builder.exactly(3, CasingModule::new)` 被写成 `exactlyBlock`）。

以上每条都只改了产生差异的那一处，没有任何"特判 fixture"。

### 3.2 与冻结版 Java 的**故意**差异（每条都在模块头部有 Java 行号）

| # | 差异 | 依据 |
|---|---|---|
| 1 | 贴图一律输出空 `plannerator:texture: {}` | 金样本生成时 `plannerator.skipTextures=true`，写盘时 `convertFromObject` 提前返回，贴图在格式里不可观测 |
| 2 | 缺值不中断读取（Java 用 unchecked cast，缺键即 NPE） | R2.9 要求 `ncconfig-overhaul.cfg` 能读入，而该文件缺整段 `machine` |
| 3 | 列表元素走 `NCPFElementDefinition.getRecipeContainedAlternative()` | `OverhaulNCConfigReader:129` 把 `NCPFListElement` 交给只能收标量的构造器 → Java 里**没有任何 overhaul `.cfg` 能读**（R0 finding §11）。Java 自己实现了这个逃生口却没有调用点 |
| 4 | Hellrage 用元素身份（`legacy_names`）匹配，不用显示名 | R2.10；显示名匹配让 3 个真实文件抛异常 |
| 5 | Hellrage **写出**时：`Cf-252 Neutron Source`（不缩写）、自持燃料写 `False;None`、无后缀燃料加 `[ID]`、underhaul 用 `moderator` 键 | 每条都用一个反向探针复现了 Java 的报错（`Invalid block name: Cf-252!` / `Self!` / `Invalid fuel name: MOX-241!` / `Invalid block name: !`），即 Java 写出来的文件它自己读不回 |
| 6 | Hellrage 读入时，只有在**用到恢复路径**时才把解析出的 configuration 一并返回 | 让 `historical/underhaul.json` 保持与金样本逐字节相同（0 元素/1 设计） |

### 3.3 Hellrage 写出的文件被冻结版 Java 读回

先用 TS 侧把 `datasets/fixtures/historical/underhaul.json` 读入再用 `writeHellrageText`
写出到任意临时路径 `<file>`，然后：

`pwsh -File tools/golden/format-golden.ps1 -Probe <file>`（首次编译，之后 `-SkipCompile`）
—— 该脚本已在 `docs/java-exit-plan.md` §P4 随 Java 树归档；复现前先
`git checkout java-frozen-c79c557f -- src tools/golden libraries nbproject build.gradle build.xml`。
下面的输出是当时的实测记录。

```
reader    : UnderhaulHellrage2Reader
read      : OK
elements  : 0
designs   : 1
  design  : nuclearcraft:underhaul_sfr
fingerprint: e3b0c44298fc1c149afbf4c8#0
```

TS 写出的 underhaul / usfr-hellrage 文件都被冻结版读回并得到 **1 个设计**；
作为对照，**Java 自己写出的** `usfr-hellrage.json` 反而读不回（`Invalid block name: !`）。

**诚实说明**：overhaul 的 `-Probe` 停在冻结版自身的缺陷上——`FileReader.read` 内部的
`project.copyTo` 因为 `coolant_recipe: -1` 抛 NPE（R0 finding #9）。用**Java 自己写出的**
`sfr-hellrage.json` 做最小改动后同样复现该 NPE，因此这是冻结版的产品缺陷，不是写出格式的问题；
TS 侧用"设计级往返"（`jsonDiff(designs) === null`，19 项断言）作为替代证据。

### 3.4 `settings.dat` 迁移 CLI

```
$ node --experimental-transform-types tools/ts/migrate-settings.mjs settings.dat out.json --language=zh_CN
note: settings.dat: the legacy file has no "language" key … the new document uses "zh_CN"
note: settings.dat: "imageExportCasingParts" is written by Core.java:363 but never read by MenuInit …
note: settings.dat: cursor.xOff=0, cursor.yOff=0; MenuInit.java:219-220 read them with the legacy default 1
migrated settings.dat -> out.json (language zh_CN, 3 notes)
```

`settings.dat`（547 B，随仓库）是真实文件；迁移逻辑在 `legacy/settings.ts`，CLI 只做 I/O，
两条路径共用同一份实现（"不静默丢字段"由 `test/r2.11-settings.test.ts` 断言）。

> 这份文件**必须是真的入库文件**，不能只是「开发机上还在」：`.gitignore` 曾以 `/settings.dat`
> 忽略它，于是 r2.11 的 9 个用例在本地绿、在任何 CI 检出上 `ENOENT`（`docs/java-exit-plan.md`
> §9.2）。`1f0656fa` 把它恢复入库并删掉了那条规则。

### 3.5 fixture 的来源与可再生产

`tools/golden/historical-fixtures.ps1` 从**本仓库自己的 git 历史**里抽取真实历史文件
（不需要网络），并记录 commit / 日期 / 字节数到 `datasets/fixtures/historical/MANIFEST.txt`。
本次为 R2.3/R2.4 扩了清单：对每条 `*.ncpf` 路径的每个 blob 探测 `version` 字段后，
把历史中存在的老版本一并抽出（v1 × 4、v2 × 2、v5 × 2、v8 × 1，另加 v10/v11 各一）。

> 脚本已在 `docs/java-exit-plan.md` §P4 归档（无 JDK 后无法运行），抽取结果
> `datasets/fixtures/historical/**` 与 `MANIFEST.txt` **已入库**，R2.3/R2.4 的测试
> 直接读它们。注意脚本里的路径字符串（`src/configurations/…`）是**历史路径**，
> 靠 `git show <rev>:<path>` 取 blob——即使工作区已无 `src/`，只要 git 历史完整
> 它就仍然可用（`docs/java-exit-plan.md` §P1 明令不改这些字符串）。取回：
> `git checkout java-frozen-c79c557f -- tools/golden`。

---

## 4. 未完成项与已知限制（诚实清单）

1. **v3、v4、v6、v7、v9 没有样本，因此它们的 reader 没有金样本。**
   对仓库 git 历史里每一条 `*.ncpf` 路径的每个 blob 探测 `version` 字段，得到的版本集合是
   **{1, 2, 5, 8, 10, 11}**：这五个版本**从未被提交过**。更关键的是：已取得的 v1/v2/v5/v8
   样本上，**冻结版 Java 自己全部抛 `NullPointerException: … "<local>.settings" is null`**
   （v4 的 `loadConfiguration` 硬编码 `addon=false`，于是 `settings` 模块永远不被创建），
   所以这九个文件**没有**"结构 + 指纹全等"的金样本。
   这九个 reader 的验收因此分三层（`test/r2.3-legacy-ncpf-chain.test.ts`，45 项）：
   ① 命中的 reader 与 `MANIFEST.json` 逐条一致；② 树被 R1 层接受、指纹可算、元素数与
   文档化的偏差相符（**回归护栏，不是 oracle**）；③ `matches()` 的负向对照覆盖全部 fixture × 全部版本，
   另外用"同一 modpack 的 v10 金样本"交叉验证共享的装载逻辑。
   **真正没被数据覆盖的**：所有九个 fixture 都是 `count: 0`（无设计），因此
   v9 的 `size` 布局、v7/v2/v1 的 id 区间、以及 turbine/fusion 设计解码
   **从未被任何一种实现真正跑过**。
   → R2.3 的计划文本把"需要真实样本"写成前置条件；本次把样本清单做实（`historical-fixtures.ps1`），
   reader 也按 Java 逐行移植并交了，但**设计路径与 v3/4/6/7/9 仍属"仅按构造验证"**。
2. **R2.7 主动降级为 P2**：Hellrage MSR v1–v6 无样本；SFR v1–v4 无样本。
   SFR v5/v6 与 underhaul v2 已交付。
3. **R2.12 的"与 Java 版目视一致"只能在浏览器里判定。** 已用单元测试钉住**布局算术**
   （PNGWriter 的 `multisPerRow` / 行列 / 包围盒 / 部件过滤），canvas 绘制与最终像素需要人工
   目视：步骤见 `docs/r3/README.md` §4（那里叫"手工验收步骤"）。
4. **三个 fixture 没有金样本，只能验"读得进"**：`ncconfig-overhaul.cfg`（Java 读不了，
   TS 读入 777 元素）、`historical/fusion_test.ncpf`（Java 需要非默认 module，TS 读入 46 元素）、
   `sfr-ncpf-save.ncpf.json`（TS 侧 948 元素/1 设计，冻结版的写侧 NPE）。
   它们没有逐字段对照。
5. **`sfr-ncpf-save.ncpf.json` 的写侧 bug 未修**（`coolant_recipe` 为 null 的 NPE，R0 finding #9）：
   TS 能读入，但冻结版不能。修它属于 R5 的数据迁移决策，不在 R2 范围。

---

## 5. 建议的下一步

1. **给 v3/v4/v6/v7/v9 和"带设计的老文件"找样本。** 这是唯一能把这五个 reader 从
   "仅按构造验证"提升到"有金样本"的办法；可行路径：更老的 upstream 提交、
   或在有样本的机器上让当年的旧版本写一个文件。在此之前，
   `test/r2.3-legacy-ncpf-chain.test.ts` 头部已把"什么没被数据覆盖"写清楚。
2. R2.7 的 Hellrage MSR/SFR 老版本同理：需要样本，否则维持 P2。
3. R5.1 的中文语言包完整化应把 `lang/zh_CN.elements.json`（当前 26 条 draft）补到
   948 个元素；`pnpm i18n:audit` 已经能报出"UI 用了但 pack 没有"的 key。
