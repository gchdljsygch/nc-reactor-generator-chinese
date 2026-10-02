# R5.2 中文术语表（zh_CN glossary）

本表是 R5.1「中文语言包完整化」的配套术语表：**元素名（数据名）包**、**UI 文案包**和
模组核心名词的英文 → 中文对照，供后续翻译、评审与 R5.1 的 `elements-pack` 裁决表交叉核对。

## 口径与证据来源

| 代号 | 文件 | 说明 |
| --- | --- | --- |
| `elements` | `lang/zh_CN.elements.json` | R5.1 生成的元素名包，732 条，键为 `<config>/<cfgType>/<type>\|<def>` |
| `parts` | `lang/parts/zh_CN.names.part1..5.json` | 五份已完成的元素名分片，元素包的唯一取值来源 |
| `app` | `lang/zh_CN.app.json` | R3.8 应用界面文案（`meta.glossary` + 130 条 `messages`） |
| `messages` | `lang/zh_CN.messages.json` | R1.2f 从 Java 版迁移的 1101 条 UI 文案 |
| `legacy` | `datasets/translations/legacy-translations.json` | Java 版 1185 条 `{en, zh}` 词条，即 NuclearCraft 中文社区/官方的实际用语 |

**收录原则**：只收录中文写法能在上面任一文件中找到出处（并已在本表备注里写明）的词条；
没有任何仓库出处的自拟词条一律标注 **本项目新定**。本表不改动任何语言包文件。

---

## 1. 元素与材料（`elements` / `parts` / `legacy`）

| English | 中文 | 备注/依据 |
| --- | --- | --- |
| Copper | 铜 | `legacy` `Copper => 铜`；`elements` 同名（`legacy_fluid\|copper`，键级权威覆盖见 §7 待确认 1） |
| Iron | 铁 | `legacy` `Iron => 铁`；`elements` 同名 |
| Gold | 金 | `legacy` `Gold => 金`；`elements` 同名 |
| Tin | 锡 | `legacy` `Tin => 锡`；`elements` 同名 |
| Magnesium | 镁 | `legacy` `Magnesium => 镁`；`elements` 同名 |
| Lapis | 青金石 | `legacy` `Lapis => 青金石`；`elements` 同名 |
| Redstone | 红石 | `legacy` `Redstone => 红石`；`elements` 同名 |
| Quartz | 石英 | `legacy` `Quartz => 石英`；`elements` 同名 |
| Diamond | 钻石 | `legacy` `Diamond => 钻石`；`elements` 同名 |
| Emerald | 绿宝石 | `legacy` `Emerald => 绿宝石`；`elements` 同名 |
| Glowstone | 萤石 | `legacy` `Glowstone => 萤石`；`elements` 的 `legacy_fluid\|glowstone`（权威）；`parts` 5 个分片一致。R5.1 裁决：不采用「荧石」（仓库 0 次） |
| Ender | 末影 | `legacy` 与 `elements` 的 `legacy_fluid\|ender`。注意与 Enderium 是两个概念 |
| Cryotheum | 极寒之凛冰 | `legacy` `Cryotheum => 极寒之凛冰`；`elements` 的 `legacy_fluid\|cryotheum`（权威）。R5.1 裁决：分片的「极寒之凛」统一为「极寒之凛冰」 |
| Fluorite | 氟石 | `parts`（氟石散热器、氟石冷却剂加热器 ×3、NaK-氟石混合物）。R5.1 裁决：**不采用** `legacy` 的单条 `Fluorite => 萤石`，因为「萤石」已被 Glowstone 占用 |
| Enderium | 末影合金 | `legacy` `Enderium => 末影合金`。R5.1 裁决：分片的「末影金属」统一为「末影合金」 |
| Slime | 史莱姆 | `legacy` `Slime => 史莱姆`；`parts` part2/part4 一致 |
| NaK | 钠钾合金 | `legacy` `NaK => 钠钾合金`、`Hot NaK => 高温钠钾合金`；`parts` 的 32 条 NaK 条目一致。「共晶」另由 `Eutectic => 共晶` 承担 |
| Graphite | 石墨 | `legacy` `Graphite => 石墨`；`elements` 的 `oredict\|blockFissionModerator` |
| Thorium | 钍 | `legacy` `Thorium => 钍`；`parts`（钍粉末、钍锭） |
| Uranium | 铀 | `legacy` `Uranium => 铀`；`parts`（铀-235） |
| Protactinium | 镤 | `legacy` `Protactinium => 镤`；`parts`（镤-233粉末） |
| Polonium | 钋 | `legacy` `Polonium => 钋`；`parts`（钋粉末） |
| Bismuth | 铋 | `legacy` `Bismuth => 铋`；`parts`（铋粉末） |
| Lead | 铅 | `legacy` `Lead => 铅`；`parts`（铅-钢反射器、铅散热器） |
| Silver | 银 | `legacy` `Silver => 银`；`parts`（银散热器） |
| Boron | 硼 | `legacy` `Boron => 硼`；`parts`（硼-银中子屏蔽） |
| Lithium | 锂 | `legacy` `Lithium => 锂`；`parts`（锂散热器） |
| Manganese | 锰 | `legacy` `Manganese => 锰`；`parts`（锰散热器） |
| Arsenic | 砷 | `legacy` `Arsenic => 砷`；`parts`（砷散热器） |
| Aluminum | 铝 | `legacy` `Aluminum => 铝`；`parts`（铝散热器、铝发电线圈） |
| Beryllium | 铍 | `legacy` `Beryllium => 铍`；`parts`（铍块、铍慢化剂） |
| Radium | 镭 | `legacy` `Radium => 镭` |
| Plutonium / Americium / Curium / Berkelium / Californium | 钚 / 镅 / 锔 / 锫 / 锎 | `legacy` 逐个精确对应（`parts` 中仅以 HEP/HECm/HECf 等代号出现） |
| Villiaumite | 氟化钠矿 | `legacy` `Villiaumite => 氟化钠矿`；`parts` 一致 |
| Carobbiite | 卡洛比石 | `parts`（卡洛比石散热器、卡洛比石冷却剂加热器 ×3、NaK-卡洛比石混合物，共 5 条）。`legacy` 另有单条 `Carobbiite => 卡罗比石`，两者不一致，见 §7 待确认 2 |
| Oxide | 氧化物 | `legacy` `Oxide => 氧化物`；`parts`（贫化 HEA-242 氧化物） |
| Nitride | 氮化物 | `legacy` `Nitride => 氮化物`；`parts`（TBU 氮化物） |
| Fluoride | 氟化物 | `legacy` `Fluoride => 氟化物`；`parts`（LEU-233 氟化物） |
| Zirconium Alloy | 锆合金 | `legacy` `Zirconium Alloy => 锆合金`（另见 `Zirconium => 锆`） |
| Depleted | 贫化 | `legacy` `Depleted => 贫化`；`parts` 全部「贫化 X」条目 |
| Enriched | 富集 | `parts`（富集镤钍粉末）。注：`legacy` 的 `Enriched => 浓缩` 是单词条，两分片都未采用，见 §7 待确认 3 |
| Alloy | 合金 | `legacy` `Alloy => 合金`；`parts`（极致合金、末影合金） |
| Steel | 钢 | `parts`（钢转子叶片）；与 `legacy` 的合金译法一致 |
| Extreme Alloy | 极致合金 | `parts`（极致合金转子叶片） |
| SiC | 碳化硅 | `legacy` `SiC => 碳化硅`。注：`parts` 的复合材料名 SiC-SiC CMC 保持 Latin 不展开（R5.1 裁决） |
| TBU / HEA / HEB / HECf / HECm / HEN / HEP / HEU / LEA / LEB / LECf / LECm / LEN / LEP / LEU / MNI / MOX / MZA / MF4 | 原样保留 Latin | `parts` 全部保留代号（`legacy` 亦如此，例如 `TBU` 无中文词条）。这是核燃料代号，不译 |
| Cf-252 / Po-Be / Ra-Be | 原样保留 Latin | `parts`（Cf-252 中子源、Po-Be 中子源、Ra-Be 中子源） |

## 2. 机器、方块与部件（`elements` / `parts` / `legacy`）

| English | 中文 | 备注/依据 |
| --- | --- | --- |
| Reactor | 反应堆 | `legacy`/`messages` 大量出现（`reactor` → 反应堆）；`parts`（反应堆外壳、反应堆玻璃） |
| Reactor Casing | 反应堆外壳 | `parts` |
| Reactor Glass | 反应堆玻璃 | `parts` |
| Reactor Cell | 燃料单元 | R5.1 裁决：元素包该键沿用 `elements` 已发布值「燃料单元」；`parts` 的「反应堆单元」在 `legacy`、`messages` 中均出现 0 次 |
| Fuel Cell | 燃料单元 | `legacy` `Fuel Cell => 燃料单元`；`app` `stat.totalFuelCells`/`stat.cells`；`elements`（`legacy_block\|nuclearcraft:solid_fission_cell`） |
| Fuel Vessel | 燃料容器 | `parts`；`elements`（`legacy_block\|nuclearcraft:salt_fission_vessel`） |
| Casing | 外壳 | `app` `meta.glossary`；`legacy` `Casing => 外壳`；`elements` |
| Transparent Casing | 透明外壳 | `parts` |
| Conductor | 导体 | `legacy` `Conductor => 导体`；`elements`（MSR/SFR `fission_conductor`） |
| Active Cooler | 主动冷却器 | `legacy` `Active Cooler Recipe => 主动冷却器配方`；`elements`（`nuclearcraft:active_cooler`） |
| Cooler | 冷却器 | `legacy` `Cooler => 冷却器`；`parts`（水冷却器、红石冷却器…） |
| Heat Sink | 散热器 | `legacy` `Heat Sink => 散热器`；`app` `meta.glossary`（Heatsink）；`parts`（铝散热器…） |
| Coolant Heater | 冷却剂加热器 | `legacy` `Coolant Heater => 冷却剂加热器`；`parts` 统一为「冷却剂」后一致 |
| Coolant Cooler | 冷却剂冷却器 | `legacy` `Coolant Cooler => 冷却剂冷却器` |
| Vent (Input/Output) | 排气口（输入/输出） | `legacy` `Vent => 排气口`；`parts` |
| Port (Input/Output) | 端口（输入/输出） | `legacy` `Port => 端口`；`parts`（燃料容器端口（输入）…） |
| Moderator | 慢化剂 | `legacy` `Moderator => 慢化剂`；`app` `meta.glossary`；`parts`（石墨慢化剂、铍慢化剂、重水慢化剂） |
| Reflector | 反射器 | `legacy` `Reflector => 反射器`；`parts`（铍-碳反射器、铅-钢反射器） |
| Neutron Shield | 中子屏蔽 | `legacy` `Opening Neutron Shields => 正在开启中子屏蔽器`；`messages` `progress.opening.neutron.shields`；`parts`（硼-银中子屏蔽） |
| Neutron Irradiator | 中子辐照器 | `legacy` `Irradiator flux: => 辐照器通量：`；`app` `meta.glossary`（Irradiator）；`parts` |
| Fission Controller | 裂变控制器 | `legacy` `Fission => 裂变`；`parts`；`messages`（熔盐裂变反应堆） |
| Solid Fission Controller | 固体裂变控制器 | `parts` + `legacy` `Solid => 固体`、`Overhaul SFR => 改版固体燃料堆`。R5.1 裁决：不采用「固态」（仓库 0 次） |
| Molten Salt Fission Controller | 熔盐裂变控制器 | `parts`；`legacy` `Convert SFR <> MSR => 固体燃料堆 ↔ 熔盐堆` |
| Fission Monitor / Source Manager / Shield Manager / Computer Port | 裂变监视器 / 裂变源管理器 / 裂变屏蔽管理器 / 裂变电脑端口 | `parts`（四个分片一致） |
| Turbine | 涡轮机 | `legacy` `Turbine => 涡轮机`；`parts`（涡轮机外壳、涡轮机控制器、涡轮机电脑端口、涡轮机红石端口、涡轮机玻璃） |
| Turbine Controller | 涡轮机控制器 | `parts` |
| Fluid Inlet / Fluid Outlet | 流体输入口 / 流体输出口 | `parts` |
| Rotor Blade | 转子叶片 | `legacy` `Turbine Rotor Blade => 涡轮转子叶片`、`Blade => 叶片`；`parts` |
| Rotor Stator | 转子定子 | `legacy` `Stator => 定子`；`parts` |
| Rotor Shaft | 转子传动轴 | `parts` |
| Rotor Bearing | 转子轴承 | `legacy` `Bearing => 轴承`；`parts` |
| Dynamo Coil | 发电线圈 | `legacy` `Turbine Dynamo Coil => 涡轮发电线圈`、`Coil => 线圈`；`parts`（镁发电线圈…） |
| Dynamo Coil Connector | 发电线圈连接器 | `parts` |
| SiC-SiC CMC Rotor Blade | SiC-SiC CMC 转子叶片 | `parts`。R5.1 裁决：缩略语链保持 Latin，只译「转子叶片」 |
| Electrolyzer | 电解槽 | **本项目新定**：`legacy`/`messages`/`app` 均无此词（「电解」出现 0 次） |
| Centrifuge | 离心机 | **本项目新定**：仓库无此词（「离心」出现 0 次） |
| Radiator | 辐射散热器 | **本项目新定**：仓库无此词（「辐射」出现 0 次）。注意与 Heat Sink=散热器 区分 |

## 3. 流体与工质（`elements` / `legacy`）

| English | 中文 | 备注/依据 |
| --- | --- | --- |
| Water | 水 | `legacy` `Water => 水`；`elements`（`legacy_fluid\|water` 等，权威） |
| Preheated Water | 预热水 | `parts` |
| Steam | 蒸汽 | `legacy` 与 `elements`（`[steam*1]->[low_quality_steam*2]`，权威） |
| High Pressure Steam | 高压蒸汽 | `elements`（两条键，权威）；`parts` |
| Low Pressure Steam | 低压蒸汽 | `parts` |
| Low Quality Steam | 低质蒸汽 | `parts` |
| Exhaust Steam | 乏汽 | `parts` |
| Liquid Helium | 液态氦 | `parts`（Liquid Helium / Liquid Helium Cooler）。R5.1 裁决：分片的「液氦」统一为「液态氦」 |
| Liquid Nitrogen | 液态氮 | `parts`（Liquid Nitrogen Coolant Heater ×3）。R5.1 裁决：分片的「液氮」统一为「液态氮」 |
| Coolant | 冷却剂 | `legacy` `Coolant => 冷却剂`、`COOLANT => 冷却剂`；`messages` 10 处「冷却剂」。**`app` 的 `meta.glossary` 写的是「冷却液」**，两包目前不一致（见 §7 待确认 4） |
| Molten X（熔融金属/熔融萤石等） | 熔融 X | `legacy` `Molten => 熔融`；`parts` 用「熔融 X」。但 `elements` 已发布的 13 条 underhaul 流体是短名（铜/铁/红石…，权威），见 §7 待确认 1 |

## 4. 物理量与统计（`app` / `messages` / `legacy`）

| English | 中文 | 备注/依据 |
| --- | --- | --- |
| Heat | 热量 | `legacy` `Heat => 热量`；`app` `stat.totalHeat = 总热量`、`stat.netHeat = 净热量`。**「热力」在仓库中出现 0 次** |
| Flux | 通量 | `app` `meta.glossary`（Flux）；`legacy` `Propogating Neutron Flux => 正在传播中子通量` |
| Neutron | 中子 | `legacy` `Neutron => 中子`；`messages`（中子屏蔽器） |
| Efficiency | 效率 | `legacy` `Efficiency => 效率`；`app` `stat.efficiency = 效率` |
| Power | 功率 | `legacy` `Power => 功率`；`app` `stat.power = 功率` |
| Irradiation | 辐照 | `app` `stat.totalIrradiation = 总辐照`；`legacy` `Total Irradiation: => 总辐照量：` |
| Cooling | 冷却 | `app` `stat.totalCooling = 总冷却`、`stat.cooling = 冷却` |
| Sparsity | 稀疏 | `app` `stat.sparsityMult = 稀疏惩罚倍率` |
| Shutdown | 停机 | `app` `stat.shutdownFactor = 停机系数`、`stat.offOutput = 停机输出` |
| Ideality | 理想 | `app` `stat.idealityMultiplier = 理想倍率`（`legacy` 作「理想膨胀率」） |
| Throughput | 通过 | `app` `stat.throughputEfficiency = 通过效率` |
| Bearing Diameter | 轴承直径 | `app` `stat.bearingDiameter` |
| Blade Count | 叶片数 | `app` `stat.bladeCount` |
| Heat Multiplier | 热量倍率 | `app` `stat.totalHeatMult` / `stat.heatMult` |
| Total Output | 总输出 | `app` `stat.totalOutput` / `stat.totalTotalOutput` |
| Raw / Safe / Unsafe Output | 原始输出 / 安全输出 / 超限输出 | `app` `stat.rawOutput` / `stat.safeOutput` / `stat.unsafeOutput` |
| Fluid / Rotor / Coil Efficiency | 流体效率 / 转子效率 / 线圈效率 | `app` `stat.totalFluidEfficiency` / `stat.rotorEfficiency` / `stat.coilEfficiency`（线圈亦见 `legacy` `Coil Efficiency: => 线圈效率：`） |
| Functional Blocks | 有效方块 | `app` `stat.functionalBlocks` |
| Missing Casings | 缺失外壳 | `app` `stat.missingCasings` |

## 5. 界面文案（`app`）

| English | 中文 | 备注/依据 |
| --- | --- | --- |
| Configuration | 配置 | `app` `panel.configuration`；`messages`（配置不完整） |
| Design | 设计 | `app` `panel.design`、`app.design = 设计 {0}` |
| Palette | 方块 | `app` `panel.palette = 方块`（侧栏「方块面板」） |
| Recipe | 配方 | `app` `panel.recipe`；`legacy` `Coolant Recipe => 冷却剂配方` |
| Stats | 统计 | `app` `panel.stats` |
| Parts list | 部件清单 | `app` `panel.parts` |
| Element config | 元素配置 | `app` `panel.elementConfig` |
| Reactor options | 反应堆选项 | `app` `panel.scalars` |
| Layers | 层 | `app` `panel.layers` |
| Symmetry | 对称 | `app` `panel.symmetry`、`symmetry.x/y/z = X/Y/Z 轴镜像` |
| Undo / Redo | 撤销 / 重做 | `app` `menu.edit.undo` / `menu.edit.redo` |
| Copy / Cut / Paste | 复制 / 剪切 / 粘贴 | `app` `menu.edit.copy/cut/paste` |
| Draw / Erase / Pick / Select / Fill | 绘制 / 擦除 / 取色（吸取方块） / 选择 / 填充选区 | `app` `tool.*` |
| Save / Save As / Open / Export | 保存 / 另存为… / 打开… / 导出设计… | `app` `menu.file.*` |
| Settings / Language / Theme | 设置 / 语言 / 主题 | `app` `menu.settings.*`、`settings.*` |
| Help / About | 帮助 / 关于 | `app` `menu.help.*` |
| OK / Cancel / Close / Apply / Create / Delete | 确定 / 取消 / 关闭 / 应用 / 创建 / 删除 | `app` `action.*` |
| Resize | 调整尺寸… | `app` `menu.edit.resize`、`dialog.resize.title = 调整多方块尺寸` |
| Unsaved changes | 有未保存的改动 | `app` `app.unsaved`、`dialog.unsaved.title` |
| Exported / Saved / Opened | 已导出 / 已保存 / 已打开 | `app` `message.exported/saved/opened` |
| Warnings | 警告 | `app` `message.warnings = 读取设计时有 {0} 条警告` |

## 6. 堆型与核心名词（`app` / `messages` / `legacy`）

| English | 中文 | 备注/依据 |
| --- | --- | --- |
| SFR | 固体燃料反应堆 | `app` `meta.glossary` `SFR = 固体燃料反应堆`；`legacy` `Overhaul SFR => 改版固体燃料堆` |
| MSR | 熔盐堆 | `app` `meta.glossary`；`legacy` `Convert SFR <> MSR => 固体燃料堆 ↔ 熔盐堆` |
| Overhaul | 改版 | `legacy` `Overhaul => 改版`；`messages`「改版熔盐堆是核工艺：改版中的熔盐裂变反应堆」 |
| Underhaul | 旧版 | `legacy` `Underhaul => 旧版`；`messages`「旧版固体燃料堆」 |
| Multiblock | 多方块结构 | `app` `meta.glossary`；`legacy`/`messages` 共 41/20 处 |
| Fuel | 燃料 | `legacy` `Fuel => 燃料`；`app` `stat.totalFuelCells` |
| Cell | 单元 | `legacy` `Cell => 单元`；`app` `stat.cells = 燃料单元` |
| Vessel | 容器 | `legacy` `Vessel => 容器`；`parts`（燃料容器） |
| Irradiator | 辐照器 | `app` `meta.glossary`；`legacy` `Irradiator flux: => 辐照器通量：` |
| Heatsink | 散热器 | `app` `meta.glossary`；`legacy` `Heatsink => 散热器` |
| Cooler | 冷却器 | `legacy` `Cooler => 冷却器`；`messages` `progress.calculating.coolers = 正在计算冷却器` |
| Moderator | 慢化剂 | `app` `meta.glossary`；`legacy` `Moderator => 慢化剂` |
| Neutron Shield | 中子屏蔽器 | `legacy` `Opening Neutron Shields => 正在开启中子屏蔽器`；`messages` `progress.opening.neutron.shields` |
| Electrolyzer / Centrifuge | 电解槽 / 离心机 | **本项目新定**（仓库无先例），见 §2 |

---

## 7. 待确认（未验证 / 需要人工决定）

1. **13 条 underhaul 熔融流体的短名**：`elements` 已发布值是「铜/铁/红石/石英/金/钻石/绿宝石/铜/锡/镁/极寒之凛冰/青金石/萤石/末影」，
   而 `parts`（和数据集里的 canonical display「Molten Copper」等）是「熔融铜/熔融铁/…」。
   R5.1 按任务约定「已发布的 26 条在键级权威」保留了短名；这 14 条（含 `oredict|blockFissionModerator = 石墨`）
   在 `elements-pack` 的「键冲突」报告里每次都会打印。**未验证**：模组内 UI 实际显示的是哪一层名字（`ElementDump`
   的 `display` 是「Molten Copper」，据此短名很可能是 legacy 子串机制的产物）。改法：直接手改 `lang/zh_CN.elements.json`
   对应键的值后重跑 `node tools/ts/elements-pack.mjs --check`（包即覆盖表，人工改动会被保留）。
2. **Carobbiite**：`parts` 5 条一致写「卡洛比石」，`legacy` 单条写「卡罗比石」。分片内部无分歧，故 R5.1 未改动。
   两个写法都是音译，需模组熟悉者定夺。
3. **Enriched 的译法**：`legacy` 只有 `Enriched => 浓缩`；`parts` 用的是「富集」（富集镤钍粉末）。R5.1 采「富集」，
   因为核燃料语境下「贫化/富集」是对仗的固定搭配。**未验证**：Java 版 UI 里的其它 enriched 物品实际用词。
4. **Coolant 在 `app` 与 `elements` 里不一致**：`app` `meta.glossary.Coolant = 冷却液`，
   而 `legacy`（12 处）、`messages`（10 处）和 `elements`（96 条）都用「冷却剂」。
   `lang/zh_CN.app.json` 不在 R5.1 的改动范围内，故本表按「冷却剂」记录，并把 `app` 的这条列为待统一项。
5. **术语一致性提示**：`elements-pack --check` 会打印「同组译文在公共后缀之外仍有多种写法」的诊断。
   当前跑出来是 0 组；该诊断是启发式的，只作提示，不影响退出码。
