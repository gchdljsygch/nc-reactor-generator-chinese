# R0.4 — NCPF 格式往返测试报告

> 由 `net.ncplanner.plannerator.tools.RoundTrip` 生成。
>
> 对象：`src/configurations/**/*.ncpf.json`（生产数据，38 个文件）。
> 流程：read → 写出 → 再 read → 比对结构指纹。

## ⚠️ 项目里有**两个** NCPF writer，保真度不同

| writer | 用在哪 | 行为 |
|---|---|---|
| `NCPFFileWriter`（`Core.java:611`） | **用户保存工程** | `project.convertToObject()` 后直接写，**不裁剪任何模块** |
| `NCPFWriter`（`FileWriter.NCPF`，`MenuMain:316-320`） | **导出单个多方块** | 写完后 `trimPlanneratorModules()`：**删掉所有非 `ncpf:` 前缀的模块**，即 `plannerator:display_name` / `plannerator:texture` / `plannerator:legacy_names` 全部丢失 |

所以本表分两列分别测。**生产保存路径（`NCPFFileWriter`）是必须完全保真的那一个**；
导出路径的丢失是设计如此，但 TS 侧必须显式实现两种语义，不能混用。

| 文件 | 大小 | 元素数 | 显示名 | 生产保存往返 | 导出往返* | 备注 |
|---|---:|---:|---:|:--:|:--:|---|
| `src/configurations/addons/alloy_heat_sinks.ncpf.json` | 328.7 KB | 983 | 0 | ✅ | n/a |  |
| `src/configurations/addons/alternative_ore_processing.ncpf.json` | 393.1 KB | 1018 | 0 | ✅ | n/a |  |
| `src/configurations/addons/binarys_extra_stuff.ncpf.json` | 282.6 KB | 952 | 0 | ✅ | n/a |  |
| `src/configurations/addons/crazy_ore_processing.ncpf.json` | 279.1 KB | 952 | 0 | ✅ | n/a |  |
| `src/configurations/addons/extreme_reactors.ncpf.json` | 1039.7 KB | 949 | 0 | ✅ | n/a |  |
| `src/configurations/addons/ic2.ncpf.json` | 286.1 KB | 953 | 0 | ✅ | n/a |  |
| `src/configurations/addons/inert_matrix_fuels.ncpf.json` | 319.8 KB | 985 | 0 | ✅ | n/a |  |
| `src/configurations/addons/moar_fuels.ncpf.json` | 1390.0 KB | 1478 | 0 | ✅ | n/a |  |
| `src/configurations/addons/moar_fuels_lite.ncpf.json` | 918.3 KB | 1254 | 0 | ✅ | n/a |  |
| `src/configurations/addons/moar_fuels_lite_mrf.ncpf.json` | 416.8 KB | 1010 | 0 | ✅ | n/a |  |
| `src/configurations/addons/moar_fuels_mrf.ncpf.json` | 545.7 KB | 1066 | 0 | ✅ | n/a |  |
| `src/configurations/addons/moar_fuels_ultra_lite.ncpf.json` | 565.0 KB | 1086 | 0 | ✅ | n/a |  |
| `src/configurations/addons/moar_fuels_ultra_lite_mrf.ncpf.json` | 320.2 KB | 968 | 0 | ✅ | n/a |  |
| `src/configurations/addons/moar_heat_sinks.ncpf.json` | 692.2 KB | 1197 | 0 | ✅ | n/a |  |
| `src/configurations/addons/moar_reactor_components.ncpf.json` | 313.1 KB | 982 | 0 | ✅ | n/a |  |
| `src/configurations/addons/moar_reactor_functionality.ncpf.json` | 449.4 KB | 1079 | 0 | ✅ | n/a |  |
| `src/configurations/addons/ncouto.ncpf.json` | 373.2 KB | 1030 | 0 | ✅ | n/a |  |
| `src/configurations/addons/nco_confectionery.ncpf.json` | 458.3 KB | 1065 | 0 | ✅ | n/a |  |
| `src/configurations/addons/new_turbine_parts.ncpf.json` | 452.0 KB | 1078 | 0 | ✅ | n/a |  |
| `src/configurations/addons/nuclear_additions.ncpf.json` | 1906.3 KB | 1156 | 0 | ✅ | n/a |  |
| `src/configurations/addons/nuclear_oil_refining.ncpf.json` | 291.1 KB | 962 | 0 | ✅ | n/a |  |
| `src/configurations/addons/nuclear_tree_factory.ncpf.json` | 292.8 KB | 967 | 0 | ✅ | n/a |  |
| `src/configurations/addons/qmd.ncpf.json` | 1024.8 KB | 891 | 0 | ✅ | n/a |  |
| `src/configurations/addons/spicy_heat_sinks_stable.ncpf.json` | 424.0 KB | 1047 | 0 | ✅ | n/a |  |
| `src/configurations/addons/spicy_heat_sinks_unstable.ncpf.json` | 518.7 KB | 1108 | 0 | ✅ | n/a |  |
| `src/configurations/addons/thorium_mixed_fuels.ncpf.json` | 407.6 KB | 1057 | 0 | ✅ | n/a |  |
| `src/configurations/addons/trinity.ncpf.json` | 280.8 KB | 956 | 0 | ✅ | n/a |  |
| `src/configurations/enigmatica_2_expert.ncpf.json` | 154.9 KB | 95 | 90 | ✅ | n/a |  |
| `src/configurations/enigmatica_2_expert_extended.ncpf.json` | 1159.9 KB | 908 | 854 | ✅ | n/a |  |
| `src/configurations/fusion_test.ncpf.json` | 52.8 KB | 46 | 0 | ✅ | n/a |  |
| `src/configurations/generators/overhaul_sfr/efficiency.ncpf.json` | 62.2 KB | 26 | 26 | ✅ | n/a |  |
| `src/configurations/generators/overhaul_sfr/output.ncpf.json` | 58.9 KB | 26 | 26 | ✅ | n/a |  |
| `src/configurations/generators/underhaul_sfr/efficiency.ncpf.json` | 59.8 KB | 26 | 26 | ✅ | n/a |  |
| `src/configurations/generators/underhaul_sfr/output.ncpf.json` | 56.5 KB | 26 | 26 | ✅ | n/a |  |
| `src/configurations/internal.ncpf.json` | 16.7 KB | 26 | 26 | ✅ | n/a |  |
| `src/configurations/nuclearcraft.ncpf.json` | 1232.2 KB | 948 | 948 | ✅ | n/a |  |
| `src/configurations/project_ozone_3.ncpf.json` | 153.3 KB | 93 | 90 | ✅ | n/a |  |
| `src/configurations/quanta.ncpf.json` | 1145.7 KB | 899 | 854 | ✅ | n/a |  |

## 汇总

| 项 | 数值 |
|---|---:|
| 文件数 | 38 |
| 语料总大小 | 18.7 MB |
| **生产保存往返一致（`NCPFFileWriter`）** | **38 / 38** |
| 生产保存往返不一致 | 0 |
| 导出往返结构一致（`NCPFWriter`，仅含有设计的文件） | 0 |
| 导出往返结构不一致 | 0 |
| 抛异常 | 0 |

\* **导出往返**列对配置类文件标 `n/a`：`NCPFWriter` 会先调 `makePartial()`，只保留被设计引用到的元素，再裁掉所有 `plannerator:*` 模块。配置文件里没有设计，所以元素会被全部剥离 —— 这是**设计如此**，不是缺陷。该列只有在文件本身含设计时才有判定意义。

## TS 实现的验收标准

1. 对同一批 `*.ncpf.json`，读入后的**结构指纹**与 Java 版一致；
2. 用「生产保存」语义写出的文件，能被冻结的 Java 版 `NCPFFileReader` 回读成**相同指纹**；
3. 用「导出」语义写出的文件，结构保留、`plannerator:*` 模块按规则裁剪。
