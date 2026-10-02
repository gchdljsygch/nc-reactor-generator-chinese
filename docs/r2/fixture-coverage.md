# R2 — fixture 覆盖表（TypeScript 侧）

> 由 `node --experimental-transform-types tools/ts/r2-coverage.mjs` 生成；**请勿手改**。
>
> 逐行对应 `docs/r0/fixture-coverage.md` 的表格字段（fixture / 命中的 reader / 同时匹配 /
> 读入 / 元素数 / 设计数 / 结果），"Java" 一列组取 `datasets/converted/MANIFEST.json`
> （冻结版 Java reader 链跑出来的产物，采集脚本 `tools/golden/format-golden.ps1` 已在
> java-exit-plan §P4 随 Java 树一起删除；数据本身已入库，复现见 `docs/changelog-java.md` 同级说明），"TS" 一列组是
> `packages/formats/src/legacy/index.ts` 注册的同一条链。
>
> 「同时匹配」只列 TS 侧：`NCPFReader` 的 `formatMatches` 恒为 true（它靠 `read()` 返回
> null 让位），LegacyNCPF / Hellrage / NCConfig 各版本靠版本号或容器特征互相排斥——
> 正常情况下同一条链里只有一个 legacy reader 匹配。

## Java（冻结版）

| fixture | 命中的 reader | 读入 | 元素数 | 设计数 | 指纹 | 结果 |
|---|---|:--:|---:|---:|---|---|
| `historical/aapn.ncpf` | `LegacyNCPF11Reader` | ✅ | 622 | 0 | `4f6e725be2e5e7cf219facda#628` |   |
| `historical/alloy_heat_sinks.ncpf` | `LegacyNCPF11Reader` | ✅ | 44 | 0 | `5f8ec99c8649074fd5472f5f#47` |   |
| `historical/aop-v10.ncpf` | `LegacyNCPF10Reader` | ✅ | 4 | 0 | `8a385e5f86ec9d2c7a8fbbed#7` |   |
| `historical/asdf.ncpf` | `LegacyNCPF1Reader` | ❌ | — | — | — | NullPointerException: Cannot assign field "minSize" because "<local5>.settings" is null |
| `historical/e2e-v1.ncpf` | `LegacyNCPF1Reader` | ❌ | — | — | — | NullPointerException: Cannot assign field "minSize" because "<local5>.settings" is null |
| `historical/e2e-v2.ncpf` | `LegacyNCPF2Reader` | ❌ | — | — | — | NullPointerException: Cannot assign field "minSize" because "<local5>.settings" is null |
| `historical/e2e-v5.ncpf` | `LegacyNCPF5Reader` | ❌ | — | — | — | NullPointerException: Cannot assign field "minSize" because "<local5>.settings" is null |
| `historical/e2e.ncpf` | `LegacyNCPF10Reader` | ✅ | 94 | 0 | `284aa25e057b1b747cfcc821#97` |   |
| `historical/extreme_reactors.ncpf` | `LegacyNCPF10Reader` | ✅ | 2 | 0 | `4735de4b9cbb1069dfcce516#4` |   |
| `historical/fusion_test-v8.ncpf` | `LegacyNCPF8Reader` | ❌ | — | — | — | NullPointerException: Cannot assign field "minInnerRadius" because "<local4>.settings" is null |
| `historical/fusion_test.ncpf` | `LegacyNCPF11Reader` | ❌ | — | — | — | ClassCastException: class net.ncplanner.plannerator.ncpf.module.UnknownNCPFModule cannot be cast to class net.ncplanner.plannerator.planner.ncpf.module.configuration.settings.OverhaulFusionSettingsModule (net.ncplanner.plannerator.ncpf.module.UnknownNCPFModule and net.ncplanner.plannerator.planner.ncpf.module.configuration.settings.OverhaulFusionSettingsModule are in unnamed module of loader 'app') |
| `historical/ic2.ncpf` | `LegacyNCPF10Reader` | ✅ | 86 | 0 | `286e25309a694790bab78e12#89` |   |
| `historical/inert_matrix_fuels.ncpf` | `LegacyNCPF11Reader` | ✅ | 83 | 0 | `a3d6f86f6ac4425d8dfc5c61#85` |   |
| `historical/moar_fuels.ncpf` | `LegacyNCPF11Reader` | ✅ | 116 | 0 | `c9b714588b6042792b3e7970#119` |   |
| `historical/moar_heat_sinks.ncpf` | `LegacyNCPF11Reader` | ✅ | 246 | 0 | `b5a1a4a6c934db638a0e56ab#249` |   |
| `historical/nuclearcraft.ncpf` | `LegacyNCPF11Reader` | ✅ | 606 | 0 | `253c236ed8b381ff445751ab#610` |   |
| `historical/overhaul.json` | `OverhaulHellrageSFR5Reader` | ❌ | — | — | — | IllegalArgumentException: Invalid block name: Cf-252! |
| `historical/po3-v1.ncpf` | `LegacyNCPF1Reader` | ❌ | — | — | — | NullPointerException: Cannot assign field "minSize" because "<local5>.settings" is null |
| `historical/po3-v2.ncpf` | `LegacyNCPF2Reader` | ❌ | — | — | — | NullPointerException: Cannot assign field "minSize" because "<local5>.settings" is null |
| `historical/po3-v5.ncpf` | `LegacyNCPF5Reader` | ❌ | — | — | — | NullPointerException: Cannot assign field "minSize" because "<local5>.settings" is null |
| `historical/po3.ncpf` | `LegacyNCPF10Reader` | ✅ | 91 | 0 | `98333b10e02b2001757219cb#93` |   |
| `historical/qmd.ncpf` | `LegacyNCPF11Reader` | ✅ | 94 | 0 | `0376325c8b5f02c02f0cb4b0#98` |   |
| `historical/quanta.ncpf` | `LegacyNCPF11Reader` | ✅ | 529 | 0 | `7da51c73ef53696e9771b403#534` |   |
| `historical/qwerty.ncpf` | `LegacyNCPF1Reader` | ❌ | — | — | — | NullPointerException: Cannot assign field "minSize" because "<local5>.settings" is null |
| `historical/spicy_heat_sinks_stable.ncpf` | `LegacyNCPF11Reader` | ✅ | 86 | 0 | `efe4d4007fdf890119702d1f#89` |   |
| `historical/thorium_mixed_fuels.ncpf` | `LegacyNCPF11Reader` | ✅ | 83 | 0 | `c658119e76aefbdc395d1175#85` |   |
| `historical/trinity.ncpf` | `LegacyNCPF10Reader` | ✅ | 4 | 0 | `4bd652f02adf5cb724eb5102#7` |   |
| `historical/underhaul.json` | `UnderhaulHellrage2Reader` | ✅ | 0 | 1 | `e3b0c44298fc1c149afbf4c8#0` |   |
| `ncconfig-overhaul.cfg` | `OverhaulNCConfigReader` | ❌ | — | — | — | IllegalArgumentException: Cannot create an element stack, with an amount, using a definition that cannot have an amount! |
| `ncconfig-underhaul.cfg` | `UnderhaulNCConfigReader` | ✅ | 90 | 0 | `db7531a070b5e0b47500c0dd#91` |   |
| `sfr-hellrage.json` | `OverhaulHellrageSFR6Reader` | ❌ | — | — | — | IllegalArgumentException: Invalid fuel name: MOX-241! |
| `sfr-ncpf-save.ncpf.json` | `NCPFReader (catch-all)` | ❌ | — | — | — | NullPointerException: Cannot invoke "net.ncplanner.plannerator.ncpf.NCPFElement.copyTo(java.util.function.Supplier)" because "this.definition.coolantRecipe" is null |
| `usfr-hellrage.json` | `UnderhaulHellrage2Reader` | ❌ | — | — | — | IllegalArgumentException: Invalid block name: ! |
| `usfr-legacy-ncpf.ncpf` | `LegacyNCPF11Reader` | ✅ | 601 | 1 | `354eaa5fe0bf990fcec84d39#605` |   |
| `usfr-ncpf-export.ncpf.json` | `NCPFReader (catch-all)` | ✅ | 5 | 1 | `9b6d3308bf3732c2bad71424#6` |   |
| `usfr-ncpf-save.ncpf.json` | `NCPFReader (catch-all)` | ✅ | 948 | 1 | `988ffaf95975044b42bc472b#952` |   |

## TypeScript

| fixture | 命中的 reader | 同时匹配（含 catch-all） | 读入 | 元素数 | 设计数 | 指纹 | 结果 |
|---|---|---|:--:|---:|---:|---|---|
| `historical/aapn.ncpf` | `LegacyNCPF11Reader` | NCPFReader, LegacyNCPF11Reader | ✅ | 622 | 0 | `4f6e725be2e5e7cf219facda#628` | **与 Java 一致** |
| `historical/alloy_heat_sinks.ncpf` | `LegacyNCPF11Reader` | NCPFReader, LegacyNCPF11Reader | ✅ | 44 | 0 | `5f8ec99c8649074fd5472f5f#47` | **与 Java 一致** |
| `historical/aop-v10.ncpf` | `LegacyNCPF10Reader` | NCPFReader, LegacyNCPF10Reader | ✅ | 4 | 0 | `8a385e5f86ec9d2c7a8fbbed#7` | **与 Java 一致** |
| `historical/asdf.ncpf` | `LegacyNCPF1Reader` | NCPFReader, LegacyNCPF1Reader | ✅ | 207 | 0 | `a62e96bbea95f70e43defd3f#209` | Java 读入失败，无 golden；TS 按修复后语义读入 |
| `historical/e2e-v1.ncpf` | `LegacyNCPF1Reader` | NCPFReader, LegacyNCPF1Reader | ✅ | 86 | 0 | `8db294d2efe38fcbcdcad3b4#87` | Java 读入失败，无 golden；TS 按修复后语义读入 |
| `historical/e2e-v2.ncpf` | `LegacyNCPF2Reader` | NCPFReader, LegacyNCPF2Reader | ✅ | 90 | 0 | `a639d88f8428f310ba1e069e#91` | Java 读入失败，无 golden；TS 按修复后语义读入 |
| `historical/e2e-v5.ncpf` | `LegacyNCPF5Reader` | NCPFReader, LegacyNCPF5Reader | ✅ | 90 | 0 | `a639d88f8428f310ba1e069e#91` | Java 读入失败，无 golden；TS 按修复后语义读入 |
| `historical/e2e.ncpf` | `LegacyNCPF10Reader` | NCPFReader, LegacyNCPF10Reader | ✅ | 94 | 0 | `284aa25e057b1b747cfcc821#97` | **与 Java 一致** |
| `historical/extreme_reactors.ncpf` | `LegacyNCPF10Reader` | NCPFReader, LegacyNCPF10Reader | ✅ | 2 | 0 | `4735de4b9cbb1069dfcce516#4` | **与 Java 一致** |
| `historical/fusion_test-v8.ncpf` | `LegacyNCPF8Reader` | NCPFReader, LegacyNCPF8Reader | ✅ | 17 | 0 | `ab682a26f925c5ee52ff0915#18` | Java 读入失败，无 golden；TS 按修复后语义读入 |
| `historical/fusion_test.ncpf` | `LegacyNCPF11Reader` | NCPFReader, LegacyNCPF11Reader | ✅ | 46 | 0 | `447359a8463600ba1e118b51#47` | Java 读入失败，无 golden；TS 按修复后语义读入 |
| `historical/ic2.ncpf` | `LegacyNCPF10Reader` | NCPFReader, LegacyNCPF10Reader | ✅ | 86 | 0 | `286e25309a694790bab78e12#89` | **与 Java 一致** |
| `historical/inert_matrix_fuels.ncpf` | `LegacyNCPF11Reader` | NCPFReader, LegacyNCPF11Reader | ✅ | 83 | 0 | `a3d6f86f6ac4425d8dfc5c61#85` | **与 Java 一致** |
| `historical/moar_fuels.ncpf` | `LegacyNCPF11Reader` | NCPFReader, LegacyNCPF11Reader | ✅ | 116 | 0 | `c9b714588b6042792b3e7970#119` | **与 Java 一致** |
| `historical/moar_heat_sinks.ncpf` | `LegacyNCPF11Reader` | NCPFReader, LegacyNCPF11Reader | ✅ | 246 | 0 | `b5a1a4a6c934db638a0e56ab#249` | **与 Java 一致** |
| `historical/nuclearcraft.ncpf` | `LegacyNCPF11Reader` | NCPFReader, LegacyNCPF11Reader | ✅ | 606 | 0 | `253c236ed8b381ff445751ab#610` | **与 Java 一致** |
| `historical/overhaul.json` | `OverhaulHellrageSFR5Reader` | NCPFReader, OverhaulHellrageSFR5Reader | ✅ | 560 | 1 | `6287a48fae33da294d704e06#561` | Java 读入失败，无 golden；TS 按修复后语义读入 |
| `historical/po3-v1.ncpf` | `LegacyNCPF1Reader` | NCPFReader, LegacyNCPF1Reader | ✅ | 86 | 0 | `8db294d2efe38fcbcdcad3b4#87` | Java 读入失败，无 golden；TS 按修复后语义读入 |
| `historical/po3-v2.ncpf` | `LegacyNCPF2Reader` | NCPFReader, LegacyNCPF2Reader | ✅ | 89 | 0 | `bfb6b6d142148ca65d6ce7ea#90` | Java 读入失败，无 golden；TS 按修复后语义读入 |
| `historical/po3-v5.ncpf` | `LegacyNCPF5Reader` | NCPFReader, LegacyNCPF5Reader | ✅ | 89 | 0 | `bfb6b6d142148ca65d6ce7ea#90` | Java 读入失败，无 golden；TS 按修复后语义读入 |
| `historical/po3.ncpf` | `LegacyNCPF10Reader` | NCPFReader, LegacyNCPF10Reader | ✅ | 91 | 0 | `98333b10e02b2001757219cb#93` | **与 Java 一致** |
| `historical/qmd.ncpf` | `LegacyNCPF11Reader` | NCPFReader, LegacyNCPF11Reader | ✅ | 94 | 0 | `0376325c8b5f02c02f0cb4b0#98` | **与 Java 一致** |
| `historical/quanta.ncpf` | `LegacyNCPF11Reader` | NCPFReader, LegacyNCPF11Reader | ✅ | 529 | 0 | `7da51c73ef53696e9771b403#534` | **与 Java 一致** |
| `historical/qwerty.ncpf` | `LegacyNCPF1Reader` | NCPFReader, LegacyNCPF1Reader | ✅ | 211 | 0 | `72e2c1737580b4c73b00c27d#213` | Java 读入失败，无 golden；TS 按修复后语义读入 |
| `historical/spicy_heat_sinks_stable.ncpf` | `LegacyNCPF11Reader` | NCPFReader, LegacyNCPF11Reader | ✅ | 86 | 0 | `efe4d4007fdf890119702d1f#89` | **与 Java 一致** |
| `historical/thorium_mixed_fuels.ncpf` | `LegacyNCPF11Reader` | NCPFReader, LegacyNCPF11Reader | ✅ | 83 | 0 | `c658119e76aefbdc395d1175#85` | **与 Java 一致** |
| `historical/trinity.ncpf` | `LegacyNCPF10Reader` | NCPFReader, LegacyNCPF10Reader | ✅ | 4 | 0 | `4bd652f02adf5cb724eb5102#7` | **与 Java 一致** |
| `historical/underhaul.json` | `UnderhaulHellrage2Reader` | NCPFReader, UnderhaulHellrage2Reader | ✅ | 0 | 1 | `e3b0c44298fc1c149afbf4c8#0` | **与 Java 一致** |
| `ncconfig-overhaul.cfg` | `OverhaulNCConfigReader` | NCPFReader, OverhaulNCConfigReader | ✅ | 777 | 0 | `493922b713ababbf2273a533#781` | Java 读入失败，无 golden；TS 按修复后语义读入 |
| `ncconfig-underhaul.cfg` | `UnderhaulNCConfigReader` | NCPFReader, UnderhaulNCConfigReader | ✅ | 90 | 0 | `db7531a070b5e0b47500c0dd#91` | **与 Java 一致** |
| `sfr-hellrage.json` | `OverhaulHellrageSFR6Reader` | NCPFReader, OverhaulHellrageSFR6Reader | ✅ | 560 | 1 | `6287a48fae33da294d704e06#561` | Java 读入失败，无 golden；TS 按修复后语义读入 |
| `sfr-ncpf-save.ncpf.json` | `NCPFReader` | NCPFReader | ✅ | 948 | 1 | `988ffaf95975044b42bc472b#952` | Java 读入失败，无 golden；TS 按修复后语义读入 |
| `usfr-hellrage.json` | `UnderhaulHellrage2Reader` | NCPFReader, UnderhaulHellrage2Reader | ✅ | 90 | 1 | `db7531a070b5e0b47500c0dd#91` | Java 读入失败，无 golden；TS 按修复后语义读入 |
| `usfr-legacy-ncpf.ncpf` | `LegacyNCPF11Reader` | NCPFReader, LegacyNCPF11Reader | ✅ | 601 | 1 | `354eaa5fe0bf990fcec84d39#605` | **与 Java 一致** |
| `usfr-ncpf-export.ncpf.json` | `NCPFReader` | NCPFReader | ✅ | 5 | 1 | `9b6d3308bf3732c2bad71424#6` | **与 Java 一致** |
| `usfr-ncpf-save.ncpf.json` | `NCPFReader` | NCPFReader | ✅ | 948 | 1 | `988ffaf95975044b42bc472b#952` | **与 Java 一致** |

## 汇总

| 项 | 数值 |
|---|---:|
| fixture 数 | 36 |
| Java 读入成功 | 21 |
| Java 读入失败 | 15 |
| TS 读入成功 | 36 |
| TS 读入失败 | 0 |
| TS 与 Java golden 结构+指纹一致 | 21 / 21 |

## 未覆盖的版本

| LegacyNCPF 版本 | 仓库历史里有样本吗 | reader |
|---|---|---|
| v1 | ✅ `historical/asdf.ncpf` | `LegacyNCPF1Reader` |
| v2 | ✅ `historical/e2e-v2.ncpf` | `LegacyNCPF2Reader` |
| v3 | ❌ 无 | — |
| v4 | ❌ 无 | — |
| v5 | ✅ `historical/e2e-v5.ncpf` | `LegacyNCPF5Reader` |
| v6 | ❌ 无 | — |
| v7 | ❌ 无 | — |
| v8 | ✅ `historical/fusion_test-v8.ncpf` | `LegacyNCPF8Reader` |
| v9 | ❌ 无 | — |
| v10 | ✅ `historical/aop-v10.ncpf` | `LegacyNCPF10Reader` |
| v11 | ✅ `historical/aapn.ncpf` | `LegacyNCPF11Reader` |

> 版本分布由 `tools/golden/historical-fixtures.ps1`（已在 java-exit-plan §P4 删除）对仓库 git 历史里每一条 `*.ncpf` 路径的每个 blob 探测得到：历史中存在的是 **1、2、5、8、10、11**；**3、4、6、7、9 从未被提交过**，因此这几个 reader 没有真实样本可验（`docs/rewrite-plan-r1-r5.md` §5 R2.3 已把"需要真实样本"写成前置条件）。脚本本身仍可从 tag `java-frozen-c79c557f` 取回：`git checkout java-frozen-c79c557f -- tools/golden`。
