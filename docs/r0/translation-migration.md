# R0.5 — 译文迁移与数据名/UI 文案拆分报告

> 由 `tools/i18n/classify-translations.ps1` 自动生成。
> **该脚本已在 java-exit-plan §P2 删除**（产物 `datasets/translations/**`、`lang/*.json` 已入库）；
> 需要原文时从 git 历史取：`git show 02f01a5a:tools/i18n/classify-translations.ps1`。

## 1. 提取结果

| 项 | 数值 |
|---|---:|
| 从 `SimplifiedChineseLocalizer` 提取的翻译对 | 1185 |
| NCPF 元素（含全局元素与方块配方） | 948 |
| 元素的英文名（去重，含 legacy_names） | 1379 |

## 2. 拆分结果

| 归类 | 翻译对数 | 说明 |
|---|---:|---|
| **数据名**（命中 NCPF 元素英文名） | 31 | 展开为 26 个元素键 |
| **UI 文案** | 1154 | 保留英文原文作为临时 key |

## 3. 数据名覆盖率

现有译文表能覆盖的 NCPF 元素：**26 / 948（2.7%）**。

未被覆盖的元素（共 922 个，前 40 个）：

```
Turbine Controller  [Overhaul Turbine Configuration]
Turbine Computer Port  [Overhaul Turbine Configuration]
Turbine Redstone Port  [Overhaul Turbine Configuration]
Turbine Casing  [Overhaul Turbine Configuration]
Turbine Glass  [Overhaul Turbine Configuration]
Fluid Inlet  [Overhaul Turbine Configuration]
Fluid Outlet  [Overhaul Turbine Configuration]
Steel Rotor Blade  [Overhaul Turbine Configuration]
Extreme Alloy Rotor Blade  [Overhaul Turbine Configuration]
SiC-SiC CMC Rotor Blade  [Overhaul Turbine Configuration]
Rotor Stator  [Overhaul Turbine Configuration]
Magnesium Dynamo Coil  [Overhaul Turbine Configuration]
Beryllium Dynamo Coil  [Overhaul Turbine Configuration]
Aluminum Dynamo Coil  [Overhaul Turbine Configuration]
Gold Dynamo Coil  [Overhaul Turbine Configuration]
Copper Dynamo Coil  [Overhaul Turbine Configuration]
Silver Dynamo Coil  [Overhaul Turbine Configuration]
Dynamo Coil Connector  [Overhaul Turbine Configuration]
Rotor Bearing  [Overhaul Turbine Configuration]
Rotor Shaft  [Overhaul Turbine Configuration]
Low Pressure Steam  [Overhaul Turbine Configuration]
Exhaust Steam  [Overhaul Turbine Configuration]
Low Quality Steam  [Overhaul Turbine Configuration]
Molten Salt Fission Controller  [Overhaul MSR Configuration]
Fission Monitor  [Overhaul MSR Configuration]
Fission Source Manager  [Overhaul MSR Configuration]
Fission Shield Manager  [Overhaul MSR Configuration]
Fission Computer Port  [Overhaul MSR Configuration]
Reactor Casing  [Overhaul MSR Configuration]
Reactor Glass  [Overhaul MSR Configuration]
Ra-Be Neutron Source  [Overhaul MSR Configuration]
Po-Be Neutron Source  [Overhaul MSR Configuration]
Cf-252 Neutron Source  [Overhaul MSR Configuration]
Standard Coolant Heater  [Overhaul MSR Configuration]
Standard Coolant Heater Port (Input)  [Overhaul MSR Configuration]
Standard Coolant Heater Port (Output)  [Overhaul MSR Configuration]
Iron Coolant Heater  [Overhaul MSR Configuration]
Iron Coolant Heater Port (Input)  [Overhaul MSR Configuration]
Iron Coolant Heater Port (Output)  [Overhaul MSR Configuration]
Redstone Coolant Heater  [Overhaul MSR Configuration]
```

> 这些元素在界面上目前显示英文。重写时 DataNameBundle 缺少条目会整条回退到英文（这是设计目标），
> 但补全它们是中文语言包的主要工作量。

## 4. 身份键（identity key）唯一性 —— 对重写方案 §4.4 的修正

重写方案原本建议用 `definition.type + "|" + definition.toString()` 作为数据名的键。实测**这个键不够**：

| 键的形式 | 去重后键数 | 显示名冲突的键数 | 结论 |
|---|---:|---:|---|
| `type|definition` | 660 | **29** | ❌ 不可用 |
| `config/cfgType/type|definition` | 732 | **0** | ✅ 可用 |

`type|definition` 冲突示例（同名 legacy_item、元数据不同、跨配置）：

```
identity: legacy_item|nuclearcraft:fuel_americium:2
    'HEA-242'   <- Underhaul SFR Configuration
    'LEA-242 Nitride'   <- Overhaul SFR Configuration
identity: legacy_item|nuclearcraft:fuel_americium:3
    'HEA-242 Oxide'   <- Underhaul SFR Configuration
    'LEA-242-Zirconium Alloy'   <- Overhaul SFR Configuration
identity: legacy_item|nuclearcraft:fuel_berkelium:2
    'HEB-248'   <- Underhaul SFR Configuration
    'LEB-248 Nitride'   <- Overhaul SFR Configuration
identity: legacy_item|nuclearcraft:fuel_berkelium:3
    'HEB-248 Oxide'   <- Underhaul SFR Configuration
    'LEB-248-Zirconium Alloy'   <- Overhaul SFR Configuration
identity: legacy_item|nuclearcraft:fuel_californium:2
    'HECf-249'   <- Underhaul SFR Configuration
    'LECf-249 Nitride'   <- Overhaul SFR Configuration
identity: legacy_item|nuclearcraft:fuel_californium:3
    'HECf-249 Oxide'   <- Underhaul SFR Configuration
    'LECf-249-Zirconium Alloy'   <- Overhaul SFR Configuration
```

即：**同一个 `legacy_item` 名称在不同配置下代表不同物品**。加配置命名空间后显示名冲突降为 0，
剩下的 108 个重键只是同一元素出现在多个元素列表中，显示名一致，可以安全合并。

## 5. 遗留翻译表自身的缺陷（实测）

`SimplifiedChineseLocalizer.add()` 使用 `LinkedHashMap.put`，因此**同一个英文 key 出现两次时，先出现的那条被静默覆盖**。

实测 1185 条中有 **57 个重复 key**，其中 **2 个的译文互相冲突**（即真的丢了一条翻译）：

| 英文 key | 两个译文 | 实际生效 |
|---|---|---|
| ` AND ` | `且` / `和` | 只有后者（`和`） |
| `Active` | `已启用` / `运行中` | 只有后者（`运行中`） |

其余 55 个重复项的译文相同，无影响。

## 6. 产物

| 文件 | 内容 |
|---|---|
| `datasets/translations/legacy-translations.json` | 1185 条原始 `{en, zh}` 对（迁移输入） |
| `datasets/translations/legacy-translations.tsv` | 同上，便于人工校订 |
| lang/zh_CN.messages.draft.json | 1101 条 UI 文案草稿 |
| lang/zh_CN.elements.draft.json | 26 条数据名草稿（身份键） |

