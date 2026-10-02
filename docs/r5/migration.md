# R5.4 — 数据迁移指引（用户文档）

> 计划：`docs/rewrite-plan-r1-r5.md` §8 R5.4（「旧格式导入（含 §2 D1 的修复后语义）→ 新格式导出」）。
> 本文档是**给用户看的**：哪些老文件能导入、哪些不能、不能的怎么办，以及怎么把设置和语言搬过来。
>
> **证据规则**：本文的每一行导入能力都绑到 `docs/r2/fixture-coverage.md`（TS 侧覆盖表，
> 由 `node --experimental-transform-types tools/ts/r2-coverage.mjs` 生成）里的一行，不引用计划里的
> 目标或设想。凡是只能由人在浏览器里完成的步骤，一律标 **【手工步骤】**。

---

## 0. 一句话结论

新版能读 `docs/r2/fixture-coverage.md` 里**全部 36 个 fixture**（其中 15 个连冻结版 Java 自己都会抛异常），
覆盖 NCPF JSON、LegacyNCPF v1–v11、Hellrage SFR v5/v6、Underhaul Hellrage v1/v2、NCConfig `.cfg` 两类；
**但只能写 NCPF 一种数据格式**（保存 / 导出两种语义），不写 LegacyNCPF / BG String / ZenScript；
`settings.dat` 不能自动读取，必须用 `tools/ts/migrate-settings.mjs` 一次性迁移，再把结果在
`File ▸ Import settings` 里导入应用。

| 用户问题 | 答案 | 依据 |
|---|---|---|
| 我的 `.ncpf.json` 能打开吗 | 能 | 覆盖表 3 行（`usfr-ncpf-save` / `usfr-ncpf-export` / `sfr-ncpf-save`） |
| 我的老 `.ncpf`（v1–v11）能打开吗 | v1/v2/v5/v8/v10/v11 有真实样本，都能打开；v3/4/6/7/9 没有样本 | 覆盖表「未覆盖的版本」表 |
| 我的 Hellrage 存档能打开吗 | SFR v5/v6、underhaul v2 能；**MSR 全线不能** | `packages/formats/src/legacy/hellrage.ts:28`、`hellrageReaders()` |
| 我的 `nuclearcraft.cfg` 能导入吗 | underhaul 能；overhaul 也能（按修复后语义，旧版 Java 读不了） | 覆盖表 `ncconfig-*.cfg` 两行 |
| 保存后旧版 Java 还能读吗 | 能（38/38 指纹一致，`docs/r1/r1.4-ncpf-io.md` §5.2） | 冻结 Java 版回读实测 |
| 设置怎么办 | 命令行迁移 + 手工导入，且**只有部分字段会被保留** | 本文 §4 |

---

## 1. 导入能力（唯一依据：`docs/r2/fixture-coverage.md`）

### 1.1 扩展名不参与判定

应用**按文件内容**判定格式，不看扩展名：拖放任意文件走同一链路
（`packages/app/src/ui/app.ts:1074-1088`），文件选择器只是过滤扩展名
`'.json,.ncpf,.cfg,.txt'`（`packages/app/src/ui/app.ts:361`）。判定实现在
`packages/formats/src/legacy/detect.ts`：先试 NCPF JSON（以 `{` 开头且带数字 `version`），
失败后按 `order` 依次试 17 个已注册的 legacy reader。

所以：**把老文件改成 `.txt` 不会提高成功率，把 `.ncpf` 改成 `.json` 也不会。**

### 1.2 逐格式状态

下表每一行的「实测」列都是 `docs/r2/fixture-coverage.md` 的 TypeScript 列，
「fixture 数」是该 reader 在覆盖表里命中的行数。

| 格式 | 命中的 reader | fixture 数 | 实测 | 证据（覆盖表 / 代码） |
|---|---|---:|---|---|
| **NCPF（现代）** | `NCPFReader` | 3 | 3/3 读入；2 个有 Java 金样本且**与 Java 一致**；`sfr-ncpf-save` 按修复后语义 | 覆盖表 `usfr-ncpf-save` / `usfr-ncpf-export` / `sfr-ncpf-save` |
| LegacyNCPF **v11** | `LegacyNCPF11Reader` | 12 | 11 个**与 Java 一致**；`fusion_test.ncpf` 按修复后语义（46 元素） | 覆盖表 12 行 |
| LegacyNCPF **v10** | `LegacyNCPF10Reader` | 6 | 6/6 **与 Java 一致** | 覆盖表 6 行（`aop-v10`、`e2e`、`extreme_reactors`、`ic2`、`po3`、`trinity`） |
| LegacyNCPF **v9** | `LegacyNCPF9Reader` | 0 | reader 已交付，**没有真实样本**（v9 从未被提交过） | 覆盖表「未覆盖的版本」 |
| LegacyNCPF **v8** | `LegacyNCPF8Reader` | 1 | 读入 17 元素，按修复后语义 | 覆盖表 `fusion_test-v8.ncpf` |
| LegacyNCPF **v7** | `LegacyNCPF7Reader` | 0 | reader 已交付，无样本 | 覆盖表「未覆盖的版本」 |
| LegacyNCPF **v6** | `LegacyNCPF6Reader` | 0 | reader 已交付，无样本 | 同上 |
| LegacyNCPF **v5** | `LegacyNCPF5Reader` | 2 | 2/2 读入，按修复后语义 | 覆盖表 `e2e-v5`、`po3-v5` |
| LegacyNCPF **v4** | `LegacyNCPF4Reader` | 0 | reader 已交付，无样本 | 同上 |
| LegacyNCPF **v3** | `LegacyNCPF3Reader` | 0 | reader 已交付，无样本 | 同上 |
| LegacyNCPF **v2** | `LegacyNCPF2Reader` | 2 | 2/2 读入，按修复后语义 | 覆盖表 `e2e-v2`、`po3-v2` |
| LegacyNCPF **v1** | `LegacyNCPF1Reader` | 4 | 4/4 读入，按修复后语义 | 覆盖表 `asdf`、`e2e-v1`、`po3-v1`、`qwerty` |
| **Hellrage SFR v6** | `OverhaulHellrageSFR6Reader` | 1 | 读入 560 元素 / 1 设计 | 覆盖表 `sfr-hellrage.json` |
| **Hellrage SFR v5** | `OverhaulHellrageSFR5Reader` | 1 | 读入 560 元素 / 1 设计 | 覆盖表 `historical/overhaul.json` |
| Hellrage SFR v1–v4 | — | 0 | **未移植** | `packages/formats/src/legacy/hellrage.ts:28-30` |
| Hellrage **MSR v1–v6** | — | 0 | **未移植**（R2.7 降级为 P2，无任何样本） | 同上；`hellrageReaders()` 只返回 4 个 reader（`hellrage.ts:1332-1339`） |
| **Underhaul Hellrage v2** | `UnderhaulHellrage2Reader` | 2 | 1 个**与 Java 一致**（`underhaul.json`，0 元素/1 设计）；`usfr-hellrage.json` 按修复后语义（90 元素/1 设计） | 覆盖表 2 行 |
| Underhaul Hellrage v1 | `UnderhaulHellrage1Reader` | 0 | reader 已交付，无样本 | 覆盖表「未覆盖的版本」外：无 fixture |
| **NCConfig `.cfg`（underhaul）** | `UnderhaulNCConfigReader` | 1 | 90 元素，**与 Java 一致** | 覆盖表 `ncconfig-underhaul.cfg` |
| **NCConfig `.cfg`（overhaul）** | `OverhaulNCConfigReader` | 1 | 777 元素，按修复后语义（Java 抛异常） | 覆盖表 `ncconfig-overhaul.cfg` |

**已注册的 reader 清单**（可复现，见 §7 命令）：

```text
count=17
order=1  LegacyNCPF11Reader
order=2  LegacyNCPF10Reader
order=3  LegacyNCPF9Reader
order=4  LegacyNCPF8Reader
order=5  LegacyNCPF7Reader
order=6  LegacyNCPF6Reader
order=7  LegacyNCPF5Reader
order=8  LegacyNCPF4Reader
order=9  LegacyNCPF3Reader
order=10 LegacyNCPF2Reader
order=11 LegacyNCPF1Reader
order=13 OverhaulHellrageSFR6Reader
order=14 OverhaulHellrageSFR5Reader
order=19 UnderhaulHellrage2Reader
order=20 UnderhaulHellrage1Reader
order=26 OverhaulNCConfigReader
order=27 UnderhaulNCConfigReader
```

> `order` 与冻结版 Java 的注册顺序一一对应（`packages/formats/src/legacy/index.ts:6-10`），
> 缺号（12、15–18、21–25）就是**没移植的 Hellrage 老版本与 MSR reader**。

### 1.3 打开时到底会发生什么

老 `.ncpf` 不是 JSON，而是长度前缀的二进制流（首字节形如
`\x00\x00\x00\x10version\x00\x00\x00\x01count…`），**不要手工编辑**；现代 NCPF 是纯 JSON 文本
（以 `{"addons":[],"configuration":{…` 开头）。两者都由内容判定，见 §1.1。

一个完全无法识别的文件会得到：

```text
NcpfFormatError: hello.txt: unknown file format (tried NCPFReader, LegacyNCPF11Reader, LegacyNCPF10Reader, LegacyNCPF9Reader, LegacyNCPF8Reader, LegacyNCPF7Reader, LegacyNCPF6Reader, LegacyNCPF5Reader, LegacyNCPF4Reader, LegacyNCPF3Reader, LegacyNCPF2Reader, LegacyNCPF1Reader, OverhaulHellrageSFR6Reader, OverhaulHellrageSFR5Reader, UnderhaulHellrage2Reader, UnderhaulHellrage1Reader, OverhaulNCConfigReader, UnderhaulNCConfigReader)
```

界面上对应 `error.dropUnsupported`（`packages/app/src/ui/app.ts:192-200`），不会打印 reader 链——
所以「打不开」时要按 §5 的办法自己在命令行拿到上面这条信息。

### 1.4 明确导不进来的东西

| 东西 | 为什么 | 你能做什么 |
|---|---|---|
| Hellrage **MSR** 存档（任意版本） | reader 未移植（无样本，R2.7 降级 P2） | 见 §5 最后一条 |
| Hellrage SFR **v1–v4** | 未移植 | 见 §5 最后一条 |
| `.dssl` 脚本 | 明确不移植（无随附脚本或配置引用它） | 用冻结的 Java 版跑；新版不提供等效能力 |
| BG String（Building Gadget 蓝图字符串） | C3 决策：**不写**（`docs/r0/compat-contract.md` §3、§7） | 用冻结的 Java 版导出 |
| ZenScript（CraftTweaker） | 同上 | 同上 |
| 旧版 `.cfg` 里的**设计** | `.cfg` 里只有配置（方块/燃料/配方定义），没有设计 | 设计要从 `.ncpf` / Hellrage 存档迁移 |

---

## 2. 导出能力：两种写语义（**混用会静默损坏工程**）

R0 证明项目里有两个 writer，保真度不同（`docs/r0/findings.md` §9 = 发现 10，
`docs/rewrite-plan-r1-r5.md` §1.2 事实 6）。新版的铁律 5 是「写要分两种语义，不得混用」。
界面上这两件事分在菜单的两个条目上：

| | **保存**（File ▸ Save，Ctrl+S） | **导出**（File ▸ Export） |
|---|---|---|
| 新建的文件名 | `<配置 id>.ncpf.json` | `design-<n>.ncpf.json` |
| 代码路径 | `packages/app/src/ui/app.ts:247-260` → `document.saveText()`（`packages/app/src/model/document.ts:374-376`） | `packages/app/src/ui/app.ts:262-273` → `document.exportText(this.designIndex)`（`document.ts:379-380`） |
| TS 函数 | `writeNcpfSave` | `writeNcpfExport` |
| Java 对应 | `NCPFFileWriter`（`Core.java:611`） | `NCPFWriter`（`FileWriter.NCPF`，`MenuMain:316-320`） |
| 语义 | **全保真**，不裁剪任何模块 | `makePartial()` + 裁掉所有非 `ncpf:*` 模块 |
| 用途 | **用户保存工程** | **导出单个多方块**（与别人交换一个设计） |
| 实测 | 38/38 往返指纹一致；未修改的工程逐字节往返 | 结构保留、装饰被裁；`usfr` 用例与 Java 输出**逐字节一致** |

**用错会怎样**（R0 已经量化）：语料里 `plannerator:*` 模块键出现 **44,836** 次（23 个不同键）、
`nuclearcraft:*` **26,218** 次、`ncpf:*` 只有 **3,716** 次（仅 `ncpf:block_recipes`）。
导出语义会删掉 **71,054** 处模块键。也就是说：

- 把「导出」的文件当工程保存 → **显示名、贴图、`legacy_names`、tags、全局元素、配置元数据全丢**，
  而且用旧版 Java 打开时这些是找不回来的（文件里没有信息）；
- 把「保存」的文件当设计分享 → 对方拿到的是整份配置（含 948 个元素和贴图），文件很大。

**判断方法**：文件里若只剩 `ncpf:*` 模块、且 `addons` 被清空，那就是导出语义的产物。
应用不会把导出文件标记成「只读」，请自己区分文件名。

**已知限制（导出）**：Java 的导出作用在 `conglomeration`（主配置 + addon 合并后的结果）上，
所以 addon 贡献的元素会出现在 Java 的导出里；TS 侧只复刻了 `addons.clear()`，
**没有**做元素合并（`packages/formats/src/write.ts:150-154`，归属 R2）。
影响面：只有「文件里既有 addon 又有设计」时才会丢元素；随仓库发布的 38 个配置都没有设计，
因此基线不受影响。**未验证**：带 addon 且带设计的真实工程。

---

## 3. 「按修复后语义」对用户意味着什么

### 3.1 旧版打不开、新版能打开的文件（15 个）

`docs/r2/fixture-coverage.md` 的 Java 列里有 **15 个 fixture 是冻结版 Java 自己抛异常**的。
这些文件在新版里**读得进来**，报错原文与读入结果如下（第 15 行是 R0 发现 #9 的产物）：

| fixture | 命中的 reader | 冻结版 Java 的报错（覆盖表原文） | 新版读入 |
|---|---|---|---|
| `historical/asdf.ncpf` | `LegacyNCPF1Reader` | `NullPointerException: Cannot assign field "minSize" because "<local5>.settings" is null` | 207 元素 |
| `historical/e2e-v1.ncpf` | `LegacyNCPF1Reader` | 同上 | 86 元素 |
| `historical/po3-v1.ncpf` | `LegacyNCPF1Reader` | 同上 | 86 元素 |
| `historical/qwerty.ncpf` | `LegacyNCPF1Reader` | 同上 | 211 元素 |
| `historical/e2e-v2.ncpf` | `LegacyNCPF2Reader` | 同上 | 90 元素 |
| `historical/po3-v2.ncpf` | `LegacyNCPF2Reader` | 同上 | 89 元素 |
| `historical/e2e-v5.ncpf` | `LegacyNCPF5Reader` | 同上 | 90 元素 |
| `historical/po3-v5.ncpf` | `LegacyNCPF5Reader` | 同上 | 89 元素 |
| `historical/fusion_test-v8.ncpf` | `LegacyNCPF8Reader` | `NullPointerException: Cannot assign field "minInnerRadius" because "<local4>.settings" is null` | 17 元素 |
| `historical/fusion_test.ncpf` | `LegacyNCPF11Reader` | `ClassCastException: … UnknownNCPFModule cannot be cast to … OverhaulFusionSettingsModule` | 46 元素 |
| `historical/overhaul.json` | `OverhaulHellrageSFR5Reader` | `IllegalArgumentException: Invalid block name: Cf-252!` | 560 元素 / 1 设计 |
| `sfr-hellrage.json` | `OverhaulHellrageSFR6Reader` | `IllegalArgumentException: Invalid fuel name: MOX-241!` | 560 元素 / 1 设计 |
| `usfr-hellrage.json` | `UnderhaulHellrage2Reader` | `IllegalArgumentException: Invalid block name: !` | 90 元素 / 1 设计 |
| `ncconfig-overhaul.cfg` | `OverhaulNCConfigReader` | `IllegalArgumentException: Cannot create an element stack, with an amount, using a definition that cannot have an amount!` | 777 元素 |
| `sfr-ncpf-save.ncpf.json` | `NCPFReader` | `NullPointerException: Cannot invoke "…NCPFElement.copyTo(Supplier)" because "this.definition.coolantRecipe" is null` | 948 元素 / 1 设计 |

> 「按修复后语义」的意思就是：**不复刻这些崩溃**。原因逐条记录在
> `docs/r0/findings.md` §8（`matches()`）、§10（辐照器 NPE）、§11（overhaul `.cfg` 死路径）、
> §12.2/§12.3（v1 与 Hellrage 显示名），以及 `docs/r1/d1-decision.md`（D1 决策）。

### 3.2 R0 发现 #9 的保存 bug 在新版里没有了

用户的原始症状是：**保存一个含 Overhaul SFR 的工程，再打开直接崩**
（`docs/r0/findings.md` §8.4 的传导路径：配方索引被写成 `-1` → 读回时 `coolantRecipe` 为 `null` → NPE）。

新版：

- 设计引用不再用「配置内索引 + 结构相等」，而是**按元素身份**存取
  （`docs/r1/r1.4-ncpf-io.md` §3.5）；
- 正向证据：把 `sfr-ncpf-save` 的冷却配方引用按身份赋成 `coolant_recipes[0]` 后保存，
  写出的是 `"coolant_recipe": 0`，**不是** Java 会写出的 `-1`（`packages/formats/test/r1.4d-identity.test.ts`）；
- `datasets/fixtures/sfr-ncpf-save.ncpf.json` **首次能往返**（`docs/r1/r1.4-ncpf-io.md` §5.2）。

**但已经写坏的文件恢复不了**：如果某个工程是**旧版保存的**、里面已经有
`"coolant_recipe": -1`，那个 `-1` 在写文件时就丢了信息（文件里没有任何字段能指出原本引用哪个冷却配方）。
新版读取不抛异常、保存时**保持 `-1` 不变**，所以：**打开这类工程后，请手工重新指定冷却配方，
然后再保存一次**。这条限制的原文见 `docs/r1/r1.4-ncpf-io.md` §7 第 1 条。

### 3.3 数值层面的两处「修复后语义」

| 现象（旧版） | 新版行为 | 依据 |
|---|---|---|
| 零输出反应堆的 `Shutdown Factor: NaN%` | `shutdownFactor` 定义域 `[0,1]`，`totalOutput == 0 → 0` | `docs/r1/d1-decision.md` §4 |
| Turbine 无叶片时 `rotorEfficiency` 为 `NaN` 并传染 `totalEfficiency` / `totalFluidEfficiency` | 未定义值置 0（**不**夹到 1，因为 >1 是合法值） | `docs/r1/d1-decision.md` §4.1 |

因此：**同一个反应堆，新版面板上可能显示 `0` 而旧版显示 `NaN`**——这是有意的，不是算错。

### 3.4 新版刻意不做的事

- **不写 LegacyNCPF**（不把新工程降级成老 `.ncpf`）。C3 决策：需要降级请用冻结的 Java 版
  （`docs/r0/compat-contract.md` §3、§7）。
- **不写 BG String / ZenScript**（同上）。
- **Hellrage 写出没有界面入口**：`packages/formats/src/legacy/hellrageWriter.ts` 里的
  `writeHellrageText` 已实现并有测试（`packages/formats/test/r2.5-hellrage-write.test.ts`），
  但它**没有**从 `packages/formats/src/index.ts` 导出，也没有任何菜单项调用它
  （`packages/app/src` 里没有任何 `hellrage` 引用）。所以用户**目前无法**在应用里导出 Hellrage 存档。
- **Hellrage 写出不保 addon**：Java 自己的 `HellrageWriter` 就会警告
  「Saves created by this program are NOT compatible with addons, and addons will not be saved!」
  （`HellrageWriter.java:31`，见 `packages/formats/test/r2.5-hellrage-write.test.ts:14`）。

---

## 4. `settings.dat` → 新版设置文档

### 4.1 现状

`settings.dat`（`config2`，12 文件 / 1,399 行）**不移植**。新版设置是 JSON，
默认落在 `localStorage` 的 `ncplanner.settings` 下（`packages/app/src/settings.ts:55`），
启动时**不会**去读磁盘上的 `settings.json`（`packages/app/src/main.ts:40`）。

所以流程是两步：**命令行迁移 → 在应用里手工导入**。

### 4.2 迁移命令（实测原始输出）

在仓库根目录执行：

```powershell
node --experimental-transform-types tools/ts/migrate-settings.mjs settings.dat $env:TEMP\out.json --language=zh_CN
```

实测输出（stderr，退出码 0；`settings.dat` 是随仓库的真实文件）：

```text
note: settings.dat: the legacy file has no "language" key (the fork hardcoded its localizer), so the new document uses "zh_CN"
note: settings.dat: "imageExportCasingParts" is written by Core.java:363 but never read by MenuInit; the stored value is kept and the legacy app always started from true
note: settings.dat: cursor.xOff=0, cursor.yOff=0; MenuInit.java:219-220 read them with the legacy default 1
migrated settings.dat -> C:\Users\q1470\AppData\Local\Temp\out.json (language zh_CN, 3 notes)
(node:21604) ExperimentalWarning: Transform Types is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
```

参数与行为（`tools/ts/migrate-settings.mjs`）：

| 参数 | 默认 | 说明 |
|---|---|---|
| `inFile` | `./settings.dat` | 旧设置文件 |
| `outFile` | `./settings.json` | 新 JSON 文档（注意 `.gitignore:16` 的 `/*.json` 会忽略仓库根的 `settings.json`） |
| `--language=<tag>` | `en_US` | 新应用启动语言。旧文件**没有** language 字段，所以必须由调用者决定 |
| `--dry-run` | — | 只解码 + 迁移，把 JSON 打到 stdout，不写文件 |
| `--help` / `-h` | — | 打印用法 |
| 退出码 | — | 0 = 成功（含 dry run）；1 = 用法/IO/解码失败 |

**必须带 `--experimental-transform-types`**：`packages/formats/src/config2.ts` 用了 `const enum`，
strip-only 模式会以 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` 失败；不带标志时脚本会打印正确命令后退出 1
（`tools/ts/migrate-settings.mjs:22-36, 102-111`）。

**三条 note 的含义**（都来自 `packages/formats/src/legacy/settings.ts` 的迁移逻辑）：

1. 旧文件没有 `language`，用你传的 `--language=`；
2. `imageExportCasingParts` 是旧版「只写不读」的字段（`Core.java:363` 写、`MenuInit` 不读，
   旧版启动时总是 `true`）→ 迁移器**保留存的值**并告诉你这件事；
3. `cursor.xOff` / `cursor.yOff` 是 0，而 `MenuInit.java:219-220` 按旧默认值 1 读它们 → 迁移器照实记录。

### 4.3 输出文档的形状（实测）

`--dry-run`（这次没传 `--language=`，所以是默认 `en_US`）的真实输出：

```json
{
  "version": 1,
  "language": "en_US",
  "theme": "Light",
  "modules": {
    "core": true,
    "underhaul": true,
    "overhaul": true,
    "fusion_test": false,
    "rainbow_factor": false,
    "prime_fuel": false,
    "quantum_traversed_efficiency_score": false,
    "tinkers_construct": false,
    "_internal": false
  },
  "overlays": {},
  "ui": {
    "tutorialShown": true,
    "invertUndoRedo": false,
    "autoBuildCasing": true,
    "vsync": true,
    "editor3dView": false,
    "mainMenu3dView": true,
    "rememberConfig": false,
    "dssl": false,
    "lastLoadedConfig": "default"
  },
  "export": {
    "view3d": true,
    "casing": true,
    "casing3d": true,
    "casingParts": true
  },
  "cursor": {
    "xMult": 1,
    "yMult": 1,
    "xGuiScale": 1,
    "yGuiScale": 1,
    "xOffset": 0,
    "yOffset": 0
  },
  "pins": [],
  "extras": {},
  "legacy": {
    "theme_type": "name"
  }
}
```

顶层键共 11 个（实测打印）：`version, language, theme, modules, overlays, ui, export, cursor, pins, extras, legacy`。

### 4.4 ⚠️ 迁移产物 ≠ 应用自己的设置文档（重要，实测）

应用自己的设置形状是 `packages/app/src/settings.ts:24-47`（`version, language, theme('dark'|'light'),
lastConfiguration, viewMode, sliceAxis, sliceIndex, shellOnly, autoCalculate, imageExportCasingParts, legacy`），
**和上面迁移产物的形状不同**。用应用真实的校验函数跑一遍迁移产物（实测）：

```powershell
node --experimental-transform-types --input-type=module -e 'import {readFileSync} from "node:fs"; const s = await import("./packages/app/src/settings.ts"); const parsed = JSON.parse(readFileSync(process.env.TEMP + "/out.json", "utf8")); console.error("migrated keys: " + Object.keys(parsed).join(",")); console.log(JSON.stringify(s.normalizeSettings(parsed), null, 2));'
```

```text
{
  "version": 1,
  "language": "zh_CN",
  "theme": "dark",
  "lastConfiguration": null,
  "viewMode": "2d",
  "sliceAxis": 1,
  "sliceIndex": 0,
  "shellOnly": false,
  "autoCalculate": true,
  "imageExportCasingParts": true,
  "legacy": {
    "theme_type": "name"
  }
}
migrated keys: version,language,theme,modules,overlays,ui,export,cursor,pins,extras,legacy
```

**结论（诚实）**：

- **语言会带过来**（`zh_CN`）——这是迁移里对用户最有价值的一条；
- `"theme": "Light"` 会被应用**拒绝**（应用只接受 `dark` / `light`，`settings.ts:88-91`），
  于是回落到默认 `dark`；
- `modules` / `overlays` / `ui` / `export` / `cursor` / `pins` / `extras` 应用**不认识**，
  不会被采纳（`normalizeSettings` 逐字段白名单，未列出的键直接丢弃）；
- 迁移产物里 **`export.casingParts` 不会被采纳**，应用的 `imageExportCasingParts` 保持自己的默认值
  （迁移产物是「保留旧值 + 提示」，应用是「白名单 + 回落」）。

也就是说：**当前这条迁移链在语言上是通的，在设置项上是不完整的**。
把两者对齐是后续工作（归属 R5.1/R5.4 的收尾），本文档只记录实测现状。

### 4.5 在应用里导入设置 【手工步骤】

1. 先跑 §4.2 的命令生成 `out.json`；
2. 打开应用 → `File ▸ Import settings`（`packages/app/src/ui/app.ts:481-497`）→ 选这个 `.json`；
3. 预期：语言切换为该 tag、界面文案立即变化（`app.ts:489` 调 `i18n.setLocale`）；
4. 也支持反向：`File ▸ Export settings` 会下载 `ncplanner-settings.json`（`app.ts:473-480`），
   文件名与应用内部设置一致（不是迁移产物的形状）。

> **未验证**：上面第 2–4 步是浏览器里的操作，本文档作者没有在浏览器里点过。
> 应用侧的等价行为由 `packages/app/test/bootstrap.test.ts` 覆盖（DOM 桩），但**没有浏览器端自动化测试**
> （`docs/r3/README.md` §4 第 6 条）。

---

## 5. 如果你只有一个打不开的老存档

按顺序做，每一步都能自己验证：

1. **先分清是哪一类文件。**
   - 用文本编辑器打开，头几个字节是 `{"addons":[],"configuration":{…` → 现代 NCPF JSON（一定能开）；
   - 开头是乱码但能看出 `version` / `count` 字样 → 老 `.ncpf`（二进制流，**不要编辑**）；
   - 是缩进的 JSON 且有 `SaveVersion` / `Data.FuelCells` → Hellrage 存档；
   - 是 `key=value` 文本且有 `fission.fission_cooling_rate` → NCConfig `.cfg`（只有配置，没有设计）。

2. **在命令行拿到真实报错**（界面只会说「不支持的文件」）：

   ```powershell
   node --experimental-transform-types --input-type=module -e 'import {readFileSync} from "node:fs"; const f = await import("./packages/formats/src/index.ts"); try { const o = f.readAnyProjectBytes(readFileSync(process.argv[1]), process.argv[1]); console.log("reader=" + o.reader + " issues=" + JSON.stringify(o.issues)); } catch (e) { console.log(e.name + ": " + e.message); }' <你的文件>
   ```

   看到 `reader=…` 就是能读；看到 `unknown file format (tried …)` 就是链上没有 reader 认它。

3. **如果是 Hellrage MSR 或 Hellrage SFR v1–v4** → 新版**永远**读不了（reader 未移植）。
   唯一办法：用**冻结的 Java 版**打开它，另存成 `.ncpf.json`，再把那个 `.ncpf.json` 拿到新版打开。

4. **如果是 `LegacyNCPF v3/4/6/7/9`** → reader 在，但**没有任何真实样本证明它**（见 §1.2）。
   请**保留原文件**再试：万一读进来的元素数明显不对，那就是「仅按构造验证」暴露出来的问题，
   请把这个文件反馈给维护者——它是目前唯一能补齐这五个版本的样本。

5. **如果读进来了但设计没进来**（元素数 > 0、设计数 = 0）→ 老 `.ncpf` 多数是**配置**文件而不是设计
   （覆盖表里 12 个 v11 fixture 全是 `设计数 0`）。设计通常在 Hellrage `.json` 里
   （`underhaul.json` = 0 元素 / 1 设计）。

6. **如果打开报 `coolantRecipe is null` 类错误** → 这是旧版保存 bug 的遗留（§3.2）。
   新版不会抛异常，但那个引用已经丢失：打开后手动重选冷却配方再保存即可。

7. **如果提示「模块未激活」类问题** → `fusion_test.ncpf.json` 随仓库发布，但 `fusion_test` 模块
   默认不激活，**默认安装读不了它**（`docs/r0/findings.md` §9 末、
   `docs/r0/compat-contract.md` §3）。新版能读（46 元素），但这类文件要预期有 warning。

---

## 6. 从旧版本迁移到新版：检查清单

| # | 步骤 | 怎么判成功 | 性质 |
|---|---|---|---|
| 1 | **备份**原始工程（旧文件和 `settings.dat` 各留一份） | 文件还在 | 手工 |
| 2 | 用旧版把工程**另存一份**为 `.ncpf.json`（可选，但最稳） | 旧版能写出文件 | 手工（旧版） |
| 3 | 新版里 `File ▸ Open`（或直接拖进窗口）打开老存档 | 状态栏出现 `message.opened`；有 `message.warnings` 说明有非致命问题 | **手工步骤** |
| 4 | 检查配置与设计：配置下拉里有目标配置；设计列表里有设计 | 元素数与设计数与 §1.2 表相符 | **手工步骤** |
| 5 | 若打开的是旧版保存的 SFR 工程：**重选冷却配方**（§3.2） | 保存后文件里 `"coolant_recipe"` 不再是 `-1` | **手工步骤** |
| 6 | `File ▸ Save`（`<配置 id>.ncpf.json`） | 下载的是**撤销裁剪**的工程（含 `plannerator:*`） | **手工步骤** |
| 7 | 需要分享单个设计时 `File ▸ Export`（`design-<n>.ncpf.json`） | 文件明显更小、`addons` 为空 | **手工步骤** |
| 8 | 设置迁移：跑 §4.2 的命令，再 `File ▸ Import settings` | 语言切换到 `zh_CN`（其余设置项见 §4.4 的现状） | 命令 + **手工步骤** |
| 9 | 切语言：`Settings ▸ 简体中文` | 菜单/面板/元素名立即变中文，刷新后保持 | **手工步骤**（R3 有 DOM 桩测试，见 `docs/r3/README.md` §2.2） |
| 10 | 全流程验收：打开 → 画堆 → 计算 → 导出 | 见 `docs/r3/README.md` §5 的五步手工验收 | **手工步骤** |

> 第 3–10 步都是浏览器操作，本文档**没有**逐条点过；可复核的自动化替代证据在
> `docs/r3/README.md` §2（启动链路 DOM 桩测试、统计面板与黄金数据逐字段一致）。

---

## 7. 本文用到的命令（可复现）

```powershell
# 1) 设置迁移（本文 §4.2 的原始输出）
node --experimental-transform-types tools/ts/migrate-settings.mjs settings.dat $env:TEMP\out.json --language=zh_CN

# 2) 只看不写（本文 §4.3 的输出）
node --experimental-transform-types tools/ts/migrate-settings.mjs settings.dat --dry-run

# 3) 覆盖表（本文 §1 的唯一依据；请勿手改生成物）
node --experimental-transform-types tools/ts/r2-coverage.mjs --help
node --experimental-transform-types tools/ts/r2-coverage.mjs

# 4) 未识别文件的真实报错（本文 §1.3）
#    见 §5 第 2 步的命令

# 5) 已注册 reader 清单（本文 §1.2 的清单）
node --experimental-transform-types --input-type=module -e 'import {registerHooks} from "node:module"; import {existsSync} from "node:fs"; import {fileURLToPath} from "node:url"; registerHooks({resolve(s,c,n){ if((s.startsWith("./")||s.startsWith("../"))&&s.endsWith(".js")&&typeof c.parentURL==="string"&&c.parentURL.endsWith(".ts")){const cand=new URL(s.slice(0,-3)+".ts",c.parentURL); if(existsSync(fileURLToPath(cand))) return {url:cand.href,shortCircuit:true};} return n(s,c);}}); const idx = await import("./packages/formats/src/legacy/index.ts"); const rs = idx.allLegacyReaders(); console.log("count="+rs.length); console.log(rs.map(r=>"order="+r.order+"  "+r.name).join("\n"));'

# 6) 应用真实的设置校验函数对迁移产物的结果（本文 §4.4）
#    见 §4.4 的命令
```

`node tools/ts/r2-coverage.mjs --help` 的实测输出：

```text
usage: node --experimental-transform-types tools/ts/r2-coverage.mjs [outFile]
```

（覆盖表的列定义在 `tools/ts/r2-coverage.mjs:149-190`：Java 组为
`fixture / 命中的 reader / 读入 / 元素数 / 设计数 / 指纹 / 结果`，
TS 组多一列 `同时匹配（含 catch-all）`；这两组列是照 `docs/r0/fixture-coverage.md` 对齐的。）

---

## 8. 未验证 / 已知限制（诚实清单）

1. **界面上的一切都没有被本文实测过**：文件打开/保存/导出、设置导入导出、语言切换、
   PNG 导出、拖放。理由：本仓库**没有浏览器端自动化测试**（`docs/r3/README.md` §4 第 6 条）。
   本文只对**命令与库函数**给实测输出。
2. **LegacyNCPF v3/v4/v6/v7/v9 的 reader 没有金样本**：这五个版本在仓库 git 历史里从未被提交过；
   已取得的 v1/v2/v5/v8 样本上冻结版 Java 自己也会抛 NPE（见 §3.1），所以这九个 reader
   的验收是「reader 选对 + 树可读 + `matches()` 负向对照 + 用同 modpack 的 v10 金样本交叉验证」，
   **不是**「结构 + 指纹全等」。另外这九个样本**全是 `count: 0`**，因此
   **设计/多联体解码路径从未被任何数据跑过**（`docs/r2/README.md` §4 第 1 条）。
3. **Hellrage MSR v1–v6、Hellrage SFR v1–v4、Underhaul Hellrage v1 无样本**：
   前两者未移植（P2），第三者 reader 已交付但无 fixture（`docs/r2/README.md` §4 第 2 条）。
4. **导出语义不合并 addon 元素**（`packages/formats/src/write.ts:150-154`）。
   「既有 addon 又有设计」的真实工程没被验证过。
5. **文件里已有的 `"coolant_recipe": -1` 无法恢复**，只能手工重选（§3.2，
   `docs/r1/r1.4-ncpf-io.md` §7 第 1 条）。
6. **迁移产物与应用设置文档形状不一致**（§4.4）：除 `language`（以及 `legacy` 原样搬运）外，
   其余设置项在应用侧会回落到默认值。本文只报告实测，`settings.ts` / `migrate-settings.mjs`
   两者是否需要统一不在 R5.4 范围内。
7. **Hellrage 写出对用户不可达**：库里有实现与测试，但没有 UI 入口、也没有从
   `packages/formats/src/index.ts` 导出（§3.4）。
8. **`.cfg` 没有金样本可对**：underhaul `.cfg` 与 Java 一致，但 overhaul `.cfg` 是
   「Java 读不了、TS 读得进」，只有 777 元素这一个数字，没有逐字段对照
   （`docs/r2/README.md` §4 第 4 条）。
9. **PNG 导出的「与 Java 版目视一致」无法在 CI 判定**：只有布局算术被单测钉住
   （`docs/r2/README.md` §4 第 3 条、`docs/r3/README.md` §4 第 3 条）。
