# NC Plannerator 中文版 —— 项目体检与重构计划

> **⚠️ 历史方案（Java 时代口径）**：本文的体检对象是冻结前的 Java 树。
> Java 树已在 `docs/java-exit-plan.md` **P4** 移除并归档至 tag `java-frozen-c79c557f`
> （含 838 个 `.java`、169 个 `.jar` 与 Java 构建链）。文中 `src/**`、`libraries/**`、
> `gradlew` / `build.gradle` 等路径**已不存在**；`src/configurations/**` 已迁到
> `datasets/configurations/**`（P1），`src/tutorials/**` → `datasets/tutorials/**`（P4）。
> 需要复现正文的实测时：`git checkout java-frozen-c79c557f -- src tools/golden`。

> 分析对象：`nc-reactor-generator-chinese`（fork of `ThizThizzyDizzy/nc-reactor-generator`，分支 `overhaul`）
> 分析基线：工作区当前状态（含未提交的本地化改动）
> 所有数字均为本次实测，采集方法见 [附录 B](#附录-b本次分析使用的命令)

---

## 0. TL;DR

| 结论 | 依据 |
|---|---|
| 现在的中文化方式**在原理上无法扩展到多语言** | 翻译发生在**渲染末端**（`Renderer` 里 5 处调用），用**英文字符串做 key + 子串替换**。全项目仅 12 处调用点。 |
| 覆盖率约 **60%**，且译文质量不可控 | 实测 1029 条 UI 文案：404 条完整翻译、**410 条完全没翻译**、215 条**中英夹杂**（如 `Standard editor only supports one cursor!` → `标准 editor only supports one cursor!`）。 |
| 项目确实臃肿，但臃肿点很集中 | 831 个 Java 文件 / 77,825 行；`OverhaulSFR` 与 `OverhaulMSR` 两个模拟器**共享 72% 的代码行**；`discord` 包 67 文件 / 6907 行（含一个完整小游戏）被打进桌面发布包。 |
| 最大隐性风险：**正在与上游分叉** | 上游最后一个 commit 是「prepared project for DizzyEngine & Separate NCPF lib」，`nbproject` 已引用 `../NCPF/dist/NCPF.jar`；而本 fork 直接改了 `Core`/`Renderer`/`Font`，并把所有字体换成单一 `NotoSansSC-VF`。 |
| 没有任何测试 | `git ls-files 'test/*.java'` = **0**；`test/` 目录里只有 23 个 `.pdn/.png` 贴图源文件。重构前必须先补安全网。 |
| Gradle 构建当前是坏的 | `./gradlew compileJava` 失败：`不支持发行版本 21`（Gradle 跑在 JDK 17 上，`build.gradle` 声明 `release = 21`）。直接用 `javac 25` 编译全部 831 个文件则**成功**。 |

**建议路线**：先补安全网 → 把翻译从「渲染末端子串替换」改成「稳定 ID + 资源目录 + 运行时语言切换」→ 数据名走**独立覆盖层**（保留英文 `legacy_names` 保证导入兼容）→ 最后做模块拆分瘦身并与上游对齐。

---

## 1. 体检数据（实测）

### 1.1 规模

| 指标 | 数值 |
|---|---|
| Java 文件 | 831 |
| Java 代码行 | 77,825 |
| Java 源码体积 | 3.57 MB |
| 追踪文件总数 | 1,769 |
| NCPF 配置 JSON | 34 个，最大 `nuclearcraft.ncpf.json` 1.23 MB |
| classpath jar | 80 个 |
| 本地构建产物 | `release/` 562.3 MB（未纳入 `.gitignore`）、`dist/` 98.8 MB |

### 1.2 包结构与体积分布

| 包 | 文件数 | 行数 | 备注 |
|---|---:|---:|---|
| `planner` | 522 | 45,643 | GUI / NCPF 实现 / 文件读写 / 教程 / VR 全在里面 |
| `multiblock` | 158 | 17,990 | 各类反应堆模拟器 |
| `discord` | 67 | 6,907 | Discord 机器人 + Smivilization 小游戏 |
| `ncpf` | 56 | 2,992 | NCPF 格式层（上游正打算抽成独立库） |
| `graphics` | 16 | 2,894 | 渲染层（上游正打算抽成 DizzyEngine） |
| `config2` | 12 | 1,399 | 设置文件读写 |

**Top 10 巨类（单文件 > 40 KB）：**

| KB | 文件 |
|---:|---|
| 110.0 | `multiblock/overhaul/fissionmsr/OverhaulMSR.java` |
| 100.8 | `discord/Bot.java` |
| 98.2 | `multiblock/overhaul/fissionsfr/OverhaulSFR.java` |
| 91.1 | `planner/file/reader/LegacyNCPF11Reader.java` |
| 75.6 | `graphics/Renderer.java` |
| **71.2** | **`planner/localization/SimplifiedChineseLocalizer.java`** |
| 68.6 | `planner/file/reader/OverhaulNCConfigReader.java` |
| 64.5 | `planner/gui/menu/MenuEdit.java` |
| 48.8 | `planner/file/reader/LegacyNCPF9Reader.java` |
| 48.0 | `planner/file/writer/LegacyNCPFWriter.java` |

### 1.3 代码重复实测

按「归一化后（去空白/去注释/去 import）相同且长度 ≥16 的行」统计：

- 有效代码行：45,740
- 出现在 >1 个文件中的行：4,385（**9.6%**）
- 重复最严重的模式：`convertToObject(NCPFObject)` ×103、`convertFromObject(NCPFObject)` ×102、`@RegisterWith(module = OverhaulModule.class)` ×76、`getFunctionName()` ×60、`getTooltip()` ×52

**多块模拟器两两相似度**（占较小文件的归一化行比例）：

| 相似度 | 文件对 |
|---:|---|
| **72.4%** | `OverhaulSFR` ↔ `OverhaulMSR`（≈1130 行重复） |
| 53.7% | `OverhaulSFR` ↔ `UnderhaulSFR` |
| 48.0% | `OverhaulSFR` ↔ `OverhaulFusionReactor` |
| 46.7% | `OverhaulFusionReactor` ↔ `OverhaulDistiller` |

`OverhaulSFR`(1564 行) 与 `OverhaulMSR`(1741 行) 是典型的「复制粘贴后各改各的」，两者合计 ≈3,300 行，其中 ≈1,130 行是同一份代码。

### 1.4 构建与测试现状

| 项 | 状态 |
|---|---|
| 构建系统 | **两套并存**：Ant/NetBeans（`build.xml` + `nbproject/`）与 Gradle（`build.gradle`） |
| Gradle 编译 | ❌ 失败：`release = 21` vs Gradle 使用的 JDK 17 |
| javac 25 直接编译 831 文件 | ✅ 成功（exit 0） |
| 单元测试 | **0 个**（`test/` 只有贴图源文件） |
| CI | `.github/` 只有 `FUNDING.yml`，无 workflow |
| 发布方式 | 手工 `jpackage`（`release/NC-Plannerator-Chinese/`，562 MB，含完整 JRE） |
| 版本声明不一致 | `build.gradle` 用 Java 21；`nbproject/project.properties` 用 1.8 且引用 `../NCPF/dist/NCPF.jar`、`../Dizzy-Engine/dist/DizzyEngine.jar`（**这两个 jar 在本仓库不存在**） |

### 1.5 现有中文化实现（3 个文件，2 KB 代码 + 71 KB 数据）

```
planner/localization/
├── TextLocalizer.java              6 行   interface { String localize(String) }
├── Localization.java              10 行   static final ACTIVE = new SimplifiedChineseLocalizer()
└── SimplifiedChineseLocalizer.java 1252 行 / 1185 条翻译对 / 71.2 KB
```

核心算法（`SimplifiedChineseLocalizer.localize`）：

```java
// 1. 按 key 长度降序排序（长 key 优先，避免短 key 抢先匹配）
entries.sort(Comparator.comparingInt(e -> e.getKey().length()).reversed());
// 2. 对整串文本，用每个 key 做「带词边界的子串替换」
String localized = text;
for (Map.Entry<String,String> e : entries) localized = replace(localized, e.getKey(), e.getValue());
// 3. 结果进无上限 ConcurrentHashMap 缓存
cache.put(text, localized);
```

调用点只有 **12 处**：

| 位置 | 作用 |
|---|---|
| `Renderer.drawText` / `drawCenteredText` / `drawText(4参)` / `drawItalicText` / `getStringWidth` | 渲染与测宽前替换（5 处） |
| `Core` 创建窗口标题 / `setWindowTitle` / `resetWindowTitle` | 窗口标题（3 处） |
| `Localization` / `TextLocalizer` / `SimplifiedChineseLocalizer` 自身 | 定义（3 处） |

### 1.6 覆盖率实测（本次自建探针）

提取 `planner/gui`、`planner/module`、`multiblock`、`discord` 四个包中的英文散文串（去重后 1,029 条），跑过 `SimplifiedChineseLocalizer`：

| 结果 | 条数 | 占比 |
|---|---:|---:|
| 完整翻译 | 404 | 39.3% |
| **完全未翻译** | **410** | **39.8%** |
| 中英夹杂 | 215 | 20.9% |

> 注：215 条「夹杂」中含合法的专有名词保留（`Esc`、`Ctrl`、`VR`、`3D`、`ThizThizzyDizzy`），但下面这些是**真正的破损**：

```
Standard editor only supports one cursor!   ==>  标准 editor only supports one cursor!
Failed to load NuclearCraft configuration!  ==>  失败 to load NuclearCraft configuration!
Error opening menu!                         ==>  错误 opening menu!
Label cannot be null!                       ==>  Label cannot be 空值!
Loaded File Formats                         ==>  Loaded 文件 Formats
Dropped File Loading Thread                 ==>  Dropped 文件 正在加载 线程
Cannot create grid layout with infinite rows and columns!
                                            ==>  Cannot create grid layout with infinite rows 和 columns!
X Mirror Symmetry                           ==>  X 轴镜像 对称
```

完整的逐条清单见 **`docs/i18n-audit-baseline.txt`**（本文件同时是 Phase 2 的 burn-down 工作清单）。

完全未翻译的 UI 文案举例（非日志）：

```
Highlights invalid blocks with a red outline
Shows the chosen recipe on blocks that have multiple recipes
Shows which cells are primed
Fill moderators to adjacent cells
Choose condition / Choose variable
Base calculations / Shutdown Factor / Partial Shutdown
All multiblocks must be calculated before they can be compared!
Image is not square!
Tried to load one file, found 
Moar Fuels / Nuclear Additions / NCO Confectionery  (附加组件名)
```

---

## 2. 根因诊断：为什么现在「难以多语言兼容」

不是「翻译得还不够多」，而是**架构不支持**。七条根因，每条都有代码位置。

### 根因 1：翻译发生在渲染末端，而非文本产生处

`Renderer` 是唯一的翻译入口，意味着：

- 任何**不走 Renderer** 的输出全部没有翻译：Discord 机器人回复、导出文件（`HellrageWriter`、`BGStringWriter`）、剪贴板内容、日志、控制台。
- `Core.setWindowTitle` 需要**手动**再调一次 `Localization.localize`——这是补丁式设计暴露出的信号。
- 新增一个显示渠道就要记得再打一个补丁，漏掉就是英文。

### 根因 2：用英文原文当 key + 子串替换

```java
replace(localized, "Add ", "添加 ");   // 换成 "Add Fuel Cell" 会变成 "添加 Fuel Cell"
replace(localized, "Power", "功率");
```

由此必然产生 §1.6 的「中英夹杂」。具体机制：

- **无法处理语序**：`"X to Y"`（`recipe.getDisplayName()` 里就有 `inputDisplayName+" to "+outputDisplayName`）在中文里需要「Y 由 X 生成」这类重排，子串替换做不到。
- **无法处理复数/量词**：`"1 block"` / `"3 blocks"` 是同一个 key 的两种形式。
- **同名不同义无法区分**：`Water` 作为冷却液和作为流体元素只能共用一个译文。
- **链式污染**：替换结果会再次参与后续替换。译文里保留的英文（`DSSL 编辑器`、`按 Ctrl+Shift+R 关闭`）可能被后续规则二次命中。
- **词边界规则是启发式的**：`isWordCharacter` 只认 `[A-Za-z0-9_]`，中文、标点、全角字符的边界行为都靠猜。

### 根因 3：语言被硬编码，没有 Locale 概念

```java
private static final TextLocalizer ACTIVE = new SimplifiedChineseLocalizer();
```

- 没有 `Locale`、没有语言协商（`Locale.getDefault()` / 启动参数 / 环境变量）、没有回退链、没有语言切换、没有持久化。
- `settings.dat` 里没有 language 字段（见 `Core.java:342-379` 的保存清单）。
- 想加日语/繁体，只能再写一个 71 KB 的 Java 类并改一行代码重新编译。**这就是「无法多语言兼容」最直接的原因。**

### 根因 4：UI 文案和数据名称混在同一张表里

1185 条翻译中，「Casing / Moderator / Water / Lithium / Solid Fission Controller」这类**数据名**和「是否保存？/ 加载配置失败！」这类**UI 文案**用同一种方式处理。

但数据名的**权威来源是 JSON**（`src/configurations/*.ncpf.json` 里的 `plannerator:display_name.display_name`），实测 `nuclearcraft.ncpf.json` 里仍是英文：

```json
{"name":"nuclearcraft:solid_fission_controller","type":"legacy_block",
 "modules":{"plannerator:display_name":{"display_name":"Solid Fission Controller"}, ...}}
```

也就是说：**JSON 数据是英文的，靠 Java 里的子串表在渲染时「盖」成中文**。这带来两个后果：

1. 同一张表要同时承担「格式/配置数据的本地化」和「UI 文案的本地化」，两种需求的生命周期、评审流程、贡献者完全不同。
2. 用户在配置编辑器（`MenuElementConfiguration`）里改名时，改的是英文原文，界面上却显示中文——所见非所改。

### 根因 5：业务逻辑依赖英文显示名（最危险的一条）

代码把「英文显示名」当成了**标识符**用：

| 位置 | 代码 | 一旦「正确翻译」数据名会怎样 |
|---|---|---|
| `planner/gui/menu/MenuInit.java:238` | `!b.getDisplayName().contains("Standard")` | 判断失效 |
| `MenuInit.java:240` | `TextureManager.getImage("overhaul/"+b.getDisplayName().toLowerCase().replace(" coolant heater","").replace("liquid ",""))` | **贴图路径拼不出来，方块失去贴图** |
| `multiblock/overhaul/fissionsfr/Block.java:292` | 解析导入文件时按 `fuel.getDisplayName()` 前缀匹配 | 燃料导入失败 |
| `multiblock/overhaul/fissionmsr/Block.java:311` | 同上 | 同上 |
| `multiblock/overhaul/fusion/Block.java:96` | `template.getDisplayName().contains("ium")` | 聚变分类失效 |
| `planner/file/writer/HellrageWriter.java:63,112,126,140,154` | `StringUtil.superRemove(b.getDisplayName(), "Reactor Cell","Fuel Cell", ...)` | **导出文件损坏** |

目前之所以「还能跑」，只是因为翻译恰好被限制在渲染层，数据层仍是英文——**这是一个靠「不彻底」维持的巧合**。任何想「正经做多语言」的人第一步就会踩中它。

> 好消息：`NCPFElement.getLegacyNames()` 已经把 `definition.getLegacyNames()` 和 `LegacyNamesModule.legacyNames` 都收集起来，且 `NCPFElementReference:34`、`DefinedNCPFObject:153` 的匹配逻辑用的是 `legacyNames` 而不是 `displayName`。**这意味着「显示名本地化 + 英文 legacy_names 保底」的正确方案在现有数据结构上可行。**

### 根因 6：测量与绘制各自翻译一次，布局会漂移

```java
// Renderer.java
public float getStringWidth(String text, float height){
    return font.getStringWidth(Localization.localize(text), height);   // 翻译
}
public void drawText(float left,float top,float right,float bottom,String text){
    text = Localization.localize(text);                                // 又翻译
    float width = font.getStringWidth(text, bottom-top);               // 用译文测宽
    while(width>right-left&&!text.isEmpty()){ text = text.substring(0,text.length()-1); ... }  // O(n²) 截断
}
```

更严重的是 `drawFormattedText`：

```java
if(font.getStringWidth(text.toString(), bottom-top) > right-left){ ... }  // 整串翻译后测宽
...
drawText(left, top, right, bottom, text.text);                            // 分片各自翻译后绘制
```

`FormattedText` 由若干片段拼接（例如 `"Add " + name`、`name + " to " + output`）。**整串翻译**与**分片翻译**的词边界不同，得到的译文和宽度就不同 → 文字溢出、负数间距、截断位置错乱。这是「加长 key 才勉强对齐」这类经验的来源。

### 根因 7：没有覆盖率门禁，也没有回退与告警

- `build/` 里躺着一个孤儿产物 `LocalizationCoverageAudit.class`——**源码已不在工作区**。说明曾经做过覆盖率审计，但没有沉淀成可复现的工具。
- 运行时 `localize()` 遇到未命中直接**静默返回英文**，不记录、不汇总。所以 §1.6 的 410 条未翻译是「看不见」的。
- 缓存 `ConcurrentHashMap` 无上限、无淘汰。带数字/文件名/路径的动态字符串会持续堆积。

---

## 3. 重构目标与硬性约束

### 目标

1. **多语言可插拔**：新增语言 = 新增一个资源文件，**不改一行 Java、不重新编译**。
2. **运行时切换**：应用内切换语言并持久化到 `settings.dat`（重启后保持），无需重启。
3. **零中英夹杂**：缺失翻译时整条回退到英文原文，**绝不半翻译**。
4. **数据名与 UI 文案分离**：数据名走 ID 覆盖层，且**不破坏** `legacy_names` 导入兼容与导出格式。
5. **可度量**：覆盖率成为 CI 门禁（未翻译条数、未使用 key 数、冲突 key 数）。
6. **可回归**：导入/导出/配置/计算路径有 golden test。
7. **瘦身**：删掉桌面发行版里用不到的东西；消除 SFR/MSR 级别的复制粘贴。

### 硬性约束（不可破坏）

- ✅ 现有 `.ncpf` / `.config2` / Hellrage / BG 格式文件的**读写兼容**。
- ✅ `NCPFElement` 的导入匹配必须继续基于英文 `legacy_names`。
- ✅ 中文字形的渲染质量与性能不能倒退（当前 `NotoSansSC-VF` 方案是有效的，但见 §4.5）。
- ✅ 上游合并可行性：**优先把 i18n 能力做进将要独立出去的 `DizzyEngine` / `NCPF` 库，而不是继续 patch fork 的业务代码**。

---

## 4. 目标架构

### 4.1 分层

```
┌─────────────────────────────────────────────────────────┐
│ 业务代码 (multiblock / planner / discord)                │
│   Messages.tr("menu.file.save")            ← UI 文案     │
│   Messages.elementName(ncpfElement)        ← 数据名      │
│   Messages.canonical(ncpfElement)          ← 英文标识    │
└───────────────────────┬─────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────┐
│ i18n 运行时 (新包 planner/i18n)                          │
│   LocaleManager  ── 当前语言 / 回退链 / 持久化 / 监听     │
│   MessageBundle  ── key → 模板, 支持 {0} 占位与复数      │
│   DataNameBundle ── 元素身份 → 显示名覆盖                │
│   MissingKeyReporter ── 未命中汇总 / 开发模式告警         │
└───────────────────────┬─────────────────────────────────┘
                        │  读取
┌───────────────────────▼─────────────────────────────────┐
│ 资源 (src/lang/)                                         │
│   en_US.json   ← 规范源(canonical)，由代码提取生成        │
│   zh_CN.json   ← 现有 1185 条迁移而来的 UI 文案           │
│   zh_CN.data.json ← 方块/燃料/配方显示名覆盖              │
│   ja_JP.json   ← 第三方贡献者只需新增此文件               │
└─────────────────────────────────────────────────────────┘
```

**关键改变**：`Renderer` 不再调用 `Localization`。渲染层保持无状态、无语言概念。翻译发生在**文本构造处**。

### 4.2 消息 API

```java
// 新包 net.ncplanner.plannerator.planner.i18n
public final class Messages {
    public static String tr(String key, Object... args);       // "menu.file.save" → "保存到文件"
    public static String trOr(String key, String fallback, Object... args);
    public static String plural(String key, long n, Object... args); // 无复数变化的语言自动退化
    public static String elementName(NCPFElement e);           // 数据名本地化
    public static String canonicalName(NCPFElement e);         // 永远返回英文，供逻辑/IO 使用
}
```

使用对比：

```java
// 改造前
tip += "\n" + fuel.getDisplayName();
dialog.addButton("Add " + name, action);

// 改造后
tip += "\n" + Messages.elementName(fuel);
dialog.addButton(Messages.tr("menu.add", Messages.elementName(name)), action);

// 译文资源 (zh_CN.json)
// "menu.add": "添加 {0}"
```

### 4.3 资源格式

```jsonc
// src/lang/zh_CN.json
{
  "meta": { "locale": "zh_CN", "name": "简体中文", "version": "1.0.0",
            "authors": ["..."], "base": "en_US" },
  "messages": {
    "menu.file.save":        "保存到文件",
    "menu.add":              "添加 {0}",
    "error.cfg.load.failed": "加载配置失败！",
    "layout.split.needs.two": "分隔布局必须恰好包含两个组件！"
  },
  "elements": {
    // key = <definition.type>|<definition.toString()>  ← 稳定身份，见 §4.4
    "legacy_block|nuclearcraft:solid_fission_controller": "固体裂变控制器",
    "legacy_block|nuclearcraft:cooler:0":                 "水冷散热器"
  }
}
```

约定：

- UTF-8，无 BOM；`en_US.json` 是**规范源**，其他语言缺 key 时回退到它，再缺则回退到 key 本身（**并上报**，绝不部分替换）。
- key 用点分层级，建议前缀：`menu.` / `dialog.` / `tooltip.` / `stat.` / `progress.` / `error.` / `overlay.` / `theme.` / `config.`。
- 禁止把句子拆成片段做 key（`"Add "` + `"Delete "` 这种做法**明确禁止**）；带参数的句子整体做 key。
- 资源可放在 classpath 内（内置语言）或 `lang/` 目录（用户可放第三方语言包，运行时热加载）。

### 4.4 数据名覆盖层（重点）

**身份键**：`NCPFElement.definition.type` + `NCPFElement.definition.toString()`。
实测 `NCPFLegacyBlockElement.toString()` 输出 `name:metadata + blockstate + nbt`，天然稳定且与语言无关。命名空间配 `Configuration.getName()`（如 `INTERNAL` / `default`）避免跨配置冲突。

**流程**：

```
NCPFElement.getDisplayName()
  └─ 1) canonical = names.displayName (JSON 里的英文，永远不动)
     2) localized = DataNameBundle.lookup(configId, definition) 
     3) localized != null ? localized : canonical
```

**导入/导出路径全部改用英文**：

- `NCPFElement.getLegacyNames()` 增加英文 canonical（现在只有 `getDisplayName()`，要改成两者都加），保证导入匹配不受语言影响。
- `MenuInit.java:238/240` 的贴图探测、`HellrageWriter` 的名词剥离、`Block.java` 的燃料匹配 → 统一改成基于 `definition` 身份或英文 canonical，**彻底断掉「英文显示名当标识符」的依赖**。
- 导出文件写英文 canonical；界面显示本地化名。

### 4.5 字体与排版

当前实现（fork 的 `Font.java` / `FontCharacter.java` 改动）是**能显示中文的**，而且顺手修了一个原有 bug（`BufferUtils.createByteBuffer(bitmapSize*bitmapSize*4)` → 单通道）。但有四个问题要收口：

1. **四种字体被压成一种**：`FONT_20 = FONT_40 = FONT_10 = FONT_MONO_20 = Font.loadFont("NotoSansSC-VF")`。标题字号、小字号、等宽字号全部消失——UI 里原本按不同字号设计的布局会出问题。
2. **字形纹理无回收**：每个新 CJK 字符 → `createGlyphTexture` 生成一张独立纹理 + `glGenerateMipmap` + 2 个 VAO（正体/斜体），`characters` HashMap 永不淘汰。常用中文 3000+ 字即 3000+ 纹理 / 6000+ VAO。
3. **回退链缺失**：`stbtt_FindGlyphIndex(info, c)==0` 时直接退到 `'?'`，没有「主字体 → 回退字体」链。日文假名、韩文、俄文、emoji 都只能显示 `?`。
4. **ASCII 图集只烘焙 255 字符**，且 `stbtt_BakeFontBitmap` 的 `charBuffer` 上限 255——中文全走动态路径，性能路径完全没有走热。

**目标**：字体栈（`Font` 持有一组 fallback 字体）+ 字形图集（把动态字形打包进一张/多张 LRU 图集纹理，而不是一字符一纹理）+ 恢复 4 种字号/字重 + 按 locale 配置主字体。

### 4.6 模块拆分（瘦身）

对齐上游方向，把单体拆成 Gradle 多模块：

```
nc-plannerator/
├── ncpf/          ← 格式与数据模型（上游已计划独立；本仓库 56 文件 / 2992 行）
├── dizzy-engine/  ← 渲染/窗口/字体/OBJ（本仓库 graphics 16 文件 / 2894 行 + graphics/legacyobj）
├── core/          ← multiblock + planner 业务（不含 GUI 文案硬编码）
├── desktop/       ← GUI + jpackage 打包
├── discord/       ← 可选模块，不进桌面发行版（67 文件 / 6907 行 / JDA 4.47 MB）
├── import-legacy/ ← LegacyNCPF9/10/11 Reader/Writer + OverhaulNCConfigReader（约 4.4 万行中的大块）
└── tools/         ← 覆盖率审计、资源提取、NCPF golden 生成
```

收益：桌面发行版不再携带 JDA 与整个 Smivilization 小游戏；`import-legacy` 可按需加载；`ncpf` / `dizzy-engine` 独立后可与上游同步而不是长期分叉。

---

## 5. 分阶段计划

> 工期为粗估（**人日**），按「1 名熟悉本项目的开发者」计。标注 `∥` 的可并行。

### Phase 0 — 地基与安全网（2–3 人日）

| # | 任务 | 产出 / 验收 |
|---|---|---|
| 0.1 | 修 Gradle 构建：加 `java.toolchain { languageVersion = JavaLanguageVersion.of(21) }` 或把 `release` 降到 17，二选一并统一 `nbproject` | `./gradlew build` 成功 |
| 0.2 | 决定单一构建系统（建议 Gradle），`nbproject`/`build.xml` 标记为 legacy 或删除 | 只有一套构建入口 |
| 0.3 | 引入 JUnit 5 + `test` sourceSet（`build.gradle` 已指向 `test/`，但那里是贴图目录 → 改成 `src/test/java`） | `./gradlew test` 可跑 |
| 0.4 | 建立 golden 基线：对 34 个 NCPF JSON 做「读 → 写 → 再读」往返测试，断言语义等价 | 34/34 通过 |
| 0.5 | 冻结当前 1185 条翻译对为 `legacy-translations.json`（迁移输入） | 文件入库 |
| 0.6 | 把 `LocalizationCoverageAudit` 从 `build/` 的孤儿 class 复活为 Gradle 任务 | `./gradlew i18nAudit` 输出 §1.6 三分类报告 |
| 0.7 | 仓库卫生：`.gitignore` 加 `/release/`；移除 `libraries/DizzyEngine` 下的 `*-sources.jar`/`*-javadoc.jar`（共 ~50 个 jar） | 仓库体积下降 |
| 0.8 | 加 GitHub Actions：`build` + `test` + `i18nAudit` | PR 上出现检查 |

**为什么先做这个**：没有 0.4 的往返测试，Phase 3 改数据名一定会静默破坏文件兼容；没有 0.6，Phase 2 的「删表」是盲删。

### Phase 1 — i18n 基础设施（4–6 人日）

| # | 任务 | 产出 / 验收 |
|---|---|---|
| 1.1 | 新建 `planner/i18n` 包：`Locale`、`LocaleManager`（当前语言 / 回退链 / 监听器）、`MessageBundle`（`{0}` 占位符）、`DataNameBundle`、`MissingKeyReporter` | 单元测试覆盖回退链与占位符 |
| 1.2 | 资源加载：classpath `lang/*.json` + 外部 `lang/` 目录；`en_US.json` 为规范源 | 缺 key → 回退英文 + 上报 |
| 1.3 | 持久化：`Core` 保存/加载 `language` 到 `settings.dat` | 重启后语言保持 |
| 1.4 | 应用内语言切换 UI（放 `SettingsMenu` 子菜单，复用主题选择器的写法） | 切换即时生效，无需重启 |
| 1.5 | **从 `Renderer` 摘除 `Localization`**（5 处）；保留一个 `Messages.legacyFreeText()` 过渡钩子，让未迁移的旧串在过渡期仍可翻译 | `Renderer` 无 i18n 依赖 |
| 1.6 | 语言代码/名称元数据、`RTL` 预留字段 | — |

**验收**：把 `en_US` 选为主语言 → 界面 100% 英文（而非现在的中英夹杂）；选一个只翻译了 10 条的语言包 → 那 10 条中文，其余整条英文，**没有任何半翻译**。

### Phase 2 — UI 文案迁移（8–12 人日，可拆分并行 ∥）

按「用户可见频率 × 改动风险」排序分批，每批：抽 key → 写入 `en_US.json` + `zh_CN.json` → 删掉 `SimplifiedChineseLocalizer` 中对应条目 → 跑 `i18nAudit` 看burn-down。

| 批次 | 范围 | 文件数 | 说明 |
|---|---|---:|---|
| 2.1 | `planner/gui/menu/**`（菜单/对话框/标题） | 126 | 收益最大，也是当前夹杂最多的区域 |
| 2.2 | `planner/gui/menu/component/**`（组件/布局/编辑器） | — | 与 2.1 合并做 |
| 2.3 | `multiblock/**` 的 tooltip 与统计文案 | 158 | **必须同时消掉字符串拼接**（见 2.6） |
| 2.4 | `planner/module/**` 的 `getDisplayName()` / 覆盖层说明 | 10 | |
| 2.5 | `planner/tutorial/**` | — | 教程文本量大，可放最后 |
| 2.6 | **禁止字符串拼接**：把 `tip += "\n" + x` 改成 `FormattedText` 片段构造 + 整句 key（例如 `"tooltip.neutron_source": "中子源：{0}"`） | — | 这是根因 2/6 的根治手段 |
| 2.7 | `discord/**` | 67 | 若 Phase 5 决定把 discord 拆出去，这步随之移出 |

**验收**：`SimplifiedChineseLocalizer.java` 被删除；`i18nAudit` 报告「API 之外零未翻译散文串」（日志/异常消息不计）。

> 建议做法：写一个**一次性迁移脚本**（`tools/`），扫描 Java 里的字符串字面量、与 `legacy-translations.json` 求交集，自动生成 `zh_CN.json` 草稿并标出待人工确认项。这能把 1185 条的手工搬运压到几百条真正需要判断的。

### Phase 3 — 数据名覆盖层（6–8 人日）

| # | 任务 | 验收 |
|---|---|---|
| 3.1 | `NCPFElement.getDisplayName()` 改为查 `DataNameBundle`（身份键见 §4.4） | 界面显示中文，JSON 保持英文 |
| 3.2 | 新增 `NCPFElement.getCanonicalName()`（永远英文）；`getLegacyNames()` 同时包含英文 canonical | 导入匹配不受语言影响 |
| 3.3 | **断掉「英文显示名当标识符」的 6 处依赖**（§2 根因 5 表格）；`MenuInit` 贴图探测改用配置内显式字段或身份键 | 6 处全部改为身份/canonical |
| 3.4 | 导出路径（`HellrageWriter` / `BGStringWriter` / clipboard）改用 canonical | 导出文件与语言无关，回归测试通过 |
| 3.5 | 生成 `zh_CN.data.json`：从 34 个 JSON 提取全部元素的身份键 + 英文名，与现有 1185 条翻译对做匹配，产出待校订清单 | 覆盖率报告 |
| 3.6 | 配置编辑器（`MenuElementConfiguration`）区分「编辑英文原名」与「查看本地化名」 | 所见即所改，不再混淆 |

**验收**：切到英文后导出的 `.ncpf` / Hellrage 文件与改造前**逐字节等价**（除时间戳）；切到中文后界面方块名/燃料名全中文且贴图正确。

### Phase 4 — 字体与排版（4–6 人日）

| # | 任务 | 验收 |
|---|---|---|
| 4.1 | 恢复 4 种字体/字号（20/40/10/mono），各自配置主字体 + 回退 | 小字号/等宽/标题字号恢复 |
| 4.2 | 字体回退链：主字体缺字形 → 依次尝试回退字体 → 最后 `?` | 日文假名/西里尔字母可显示 |
| 4.3 | 字形图集：动态字形包进 LRU 图集纹理（替代一字符一纹理），VAO 复用 | 4000 个不同汉字下 GL 纹理数 O(1) 量级 |
| 4.4 | 消除 `FormattedText` 整串/分片测宽不一致：**一次布局、缓存结果**，绘制阶段不做测量 | 长句不再溢出/截断错位 |
| 4.5 | 修 `while(width>right-left) substring(...)` 的 O(n²) 截断 | 用二分或按字形宽度累加 |

### Phase 5 — 瘦身与模块化（15–25 人日，可与 Phase 2–4 并行 ∥）

| # | 任务 | 预估 | 收益 |
|---|---|---:|---|
| 5.1 | 抽 `ncpf/` 为独立模块，与上游 `../NCPF` 对齐 | 3–5 d | 停止在外层 fork 中改 NCPF |
| 5.2 | 抽 `graphics/` + `legacyobj/` 为 `dizzy-engine` 模块 | 3–4 d | 同上；字体/渲染改动进库而非进业务 |
| 5.3 | `discord/` 拆为可选模块，桌面发行版不打包（JDA 4.47 MB + 6907 行） | 2–3 d | 发行包变小、编译变快 |
| 5.4 | `import-legacy` 模块：`LegacyNCPF9/10/11Reader`、`LegacyNCPFWriter`、`OverhaulNCConfigReader`（≈250 KB 源码） | 3–4 d | 按需加载，主路径更快 |
| 5.5 | **合并 `OverhaulSFR` / `OverhaulMSR`**：抽 `AbstractCuboidalSimulator` + 每类型策略；先删 ~1,130 行重复 | 5–8 d | 两个 100 KB 巨类降为骨架 + 策略 |
| 5.6 | 用声明式字段描述符替换模块样板：消除 103 个 `convertToObject` / 102 个 `convertFromObject` 的重复 | 4–6 d | NCPF 模块从 120 个手写类降到少量描述符 |
| 5.7 | 删掉重复的第二个 OBJ 加载器（`discord/play/model/OBJLoader` vs `graphics/legacyobj/.../OBJLoader`） | 0.5 d | — |
| 5.8 | 依赖治理：`libraries/` 169 个追踪文件 → Gradle 依赖 + 校验和；移除 sources/javadoc jar | 1–2 d | 仓库体积与噪音 |

### Phase 6 — 上游对齐与流程（持续）

| # | 任务 |
|---|---|
| 6.1 | i18n 能力（LocaleManager / 资源加载 / 字体回退链 / 字形图集）**优先向上游 `DizzyEngine` 提 PR**，本地只保留 `zh_CN.json` 与 `zh_CN.data.json` |
| 6.2 | 建立 rebase 纪律：业务代码改动尽量小且可回推；fork 专属改动集中在 `lang/` 与少量配置 |
| 6.3 | CI：`build` + `test` + `i18nAudit`（未翻译/未使用/冲突 key 三类门禁） |
| 6.4 | 翻译贡献流程：语言包走 PR，只改 JSON；`i18nAudit` 自动校验 |
| 6.5 | 发布：Gradle + `jpackage` 自动化，产物不再手工堆积在 `release/` |

### 里程碑总览

| 里程碑 | 包含 | 粗估 | 达成标志 |
|---|---|---:|---|
| **M1 可构建可测试** | Phase 0 | 2–3 d | CI 绿，34 个 NCPF golden 通过 |
| **M2 多语言框架可用** | Phase 1 | 4–6 d | 应用内切换语言，半翻译归零 |
| **M3 中文 UI 完整** | Phase 2 | 8–12 d | `SimplifiedChineseLocalizer` 删除，覆盖率 >95% |
| **M4 数据名本地化** | Phase 3 | 6–8 d | 方块/燃料/配方中文，导入导出兼容 |
| **M5 排版达标** | Phase 4 | 4–6 d | 4 字号恢复，字形资源 O(1)，无溢出 |
| **M6 瘦身完成** | Phase 5 | 15–25 d | 多模块，发行包不含 discord，SFR/MSR 去重 |

---

## 6. 关键改造点清单（代码级）

| 文件 | 现状 | 改法 |
|---|---|---|
| `planner/localization/*`（3 文件） | 子串替换表 | **删除**，替换为 `planner/i18n/*` |
| `graphics/Renderer.java:987,1009,1018,1027,1645` | 5 处 `Localization.localize` | 全部摘除 |
| `planner/Core.java:164,673,676` | 窗口标题翻译 | 改由调用方传已本地化文本 |
| `planner/Core.java:342-379` | `settings.dat` 保存清单 | 增加 `language` |
| `planner/gui/menu/MenuInit.java:238,240` | `getDisplayName().contains("Standard")` / 拼贴图路径 | 改用身份键或显式配置字段 |
| `multiblock/overhaul/fissionsfr/Block.java:292`<br>`multiblock/overhaul/fissionmsr/Block.java:311` | 按 `getDisplayName()` 解析燃料 | 改用 canonical / `legacyNames` |
| `multiblock/overhaul/fusion/Block.java:96` | `getDisplayName().contains("ium")` | 改用模块/配置字段 |
| `planner/file/writer/HellrageWriter.java:63,112,126,140,154,161,240` | 从显示名剥离英文词 | 改用 canonical |
| `ncpf/NCPFElement.java:54-58,70-76` | `getDisplayName()` / `getLegacyNames()` | 加本地化覆盖层 + `getCanonicalName()` |
| `graphics/Font.java` / `FontCharacter.java` | 一字符一纹理、单字体 | 字体回退链 + 字形图集 LRU |
| `planner/Core.java:228-232` | 四种字体全指向 `FONT_20` | 恢复 4 种字号/字重 |
| `graphics/Renderer.java:1044+` | `drawFormattedText` 整串/分片测宽不一致 | 一次布局 + 缓存 |
| `build.gradle` | `release 21` vs 环境 JDK 17 | toolchain 或降 release |
| `.gitignore` | 缺 `/release/` | 补上 |

---

## 7. 风险与回滚

| 风险 | 影响 | 缓解 |
|---|---|---|
| **上游持续分叉** | 大量 merge 冲突，长期无法跟进 | Phase 6.1：i18n 能力推到 `DizzyEngine`/`NCPF`；fork 专属改动收敛到 `lang/` |
| **数据名本地化破坏导入/导出** | 用户存档读不出、导出文件废掉 | Phase 0.4 golden 往返测试；Phase 3.2 保证 `legacy_names` 含英文 canonical；3.4 导出用 canonical |
| **字形纹理/VAO 泄漏** | 长时间运行爆显存 | Phase 4.3 LRU 图集；`characters` 改为有界缓存；加 GL 对象计数日志 |
| **删除子串表导致大面积英文** | 体验短期倒退 | Phase 1.5 保留过渡钩子；Phase 2 按批次推进，每批跑 `i18nAudit` 看 burn-down，**表删空后再删类** |
| **翻译质量参差** | 术语不一致 | 术语表（`lang/glossary.md`）+ code review；`zh_CN.data.json` 由熟悉模组的人校订 |
| **模块拆分破坏反射/注解扫描** | `@RegisterWith` 依赖 classgraph/reflections 扫描 | 拆分时同步更新扫描范围配置；加「模块注册数」断言测试 |
| **无测试导致回归** | 重构即引入 bug | Phase 0 是**前置条件**，不跳过 |
| **工期超预期** | — | Phase 2/3/5 可独立交付；M2 完成后已达成「多语言可插拔」的核心目标 |

**回滚策略**：每个 Phase 独立分支 + PR；Phase 1 保留 `Localization` 旧类直到 Phase 2 结束；Phase 3 的 `getDisplayName()` 覆盖层用开关（`settings.dat: localizeDataNames`）可一键关回英文行为。

---

## 8. 立即可做的 6 件事（本周，成本 < 2 人日）

1. **修 Gradle**（`java.toolchain` 或降 `release`）——现在 `./gradlew compileJava` 直接失败，这是最廉价的一步。
2. **`.gitignore` 加 `/release/`**——本地 562 MB 产物目前处于「一个 `git add -A` 就进仓库」的状态。
3. **给 `SimplifiedChineseLocalizer` 加运行期报告模式**（`-Dncplanner.i18n.report=path`）：把每次 `localize()` 未命中的原文 dump 出来。这能在不做任何架构改动的情况下，把「哪些界面文案还没翻译」变成一份可执行的清单。
4. **给缓存加上限**（如 8192 条 LRU）——当前 `ConcurrentHashMap` 无界，动态字符串会持续堆积。
5. **加一个「key 冲突」单元测试**：断言不存在「A 是 B 的子串且译文冲突」的条目对。这能在现有架构下立刻消掉一批夹杂 bug。
6. **移除 `libraries/DizzyEngine` 下的 `*-sources.jar` / `*-javadoc.jar`**（约 50 个 jar，对构建无用）。

---

## 9. 度量看板（建议纳入 CI）

| 指标 | 当前 | 目标 |
|---|---:|---:|
| UI 文案覆盖率（完整翻译） | 39.3% | > 95% |
| 中英夹杂条数 | 215 | **0** |
| 完全未翻译散文串 | 410 | < 20（仅日志/异常） |
| 支持语言数 | 1（硬编码） | ≥ 2（新增零代码） |
| 语言切换是否需要重启 | 不支持切换 | 否 |
| 数据名与 UI 文案是否同一体系 | 是（混在一张表） | 否（双层） |
| 「英文显示名当标识符」的代码点 | 6 | **0** |
| Java 单元测试数 | 0 | > 60 |
| 归一化重复行占比 | 9.6% | < 6% |
| SFR↔MSR 代码相似度 | 72.4% | < 30% |
| 桌面发行版是否含 JDA | 是 | 否 |
| `./gradlew build` | ❌ 失败 | ✅ 通过 |

---

## 附录 A：实测证据

### A.1 覆盖率探针源码（本次自建，位于临时目录，未污染仓库）

`SimplifiedChineseLocalizer` 是包私有类，探针放在同包下直接实例化；输入为从 4 个 UI 包提取的去重散文串（1,029 条），输出分三类：未变更 / 含残留拉丁字母 / 完全翻译。

### A.2 多块模拟器相似度

按「归一化（去空白、去 `//` 注释、去单独 `{`/`}`）后完全相同的行」求交，百分比以较小文件的行数为分母。

### A.3 关键源码位置复核

- `Renderer.java:986-1034` —— 5 处 `Localization.localize` 的上下文
- `SimplifiedChineseLocalizer.java:1204` —— 按 key 长度降序排序
- `SimplifiedChineseLocalizer.java:1212-1251` —— `localize` / `replace` / `hasWordBoundaries` / `isWordCharacter`
- `MenuInit.java:236-263` —— 用英文显示名拼贴图路径
- `HellrageWriter.java:63,112,126,140,154` —— 用英文显示名剥离词缀
- `src/configurations/nuclearcraft.ncpf.json` —— `plannerator:display_name` 与 `plannerator:legacy_names` 的实际结构

---

## 附录 B：本次分析使用的命令

```powershell
# 规模
Get-ChildItem src -Recurse -Filter *.java -File | Measure-Object Length -Sum
(Get-ChildItem src -Recurse -Filter *.java | Get-Content | Measure-Object -Line).Lines

# 最大文件 / 包分布
Get-ChildItem src -Recurse -Filter *.java -File | Sort-Object Length -Descending | Select -First 40

# 重复代码（归一化行哈希）
#   → 9.6% 的行出现在 >1 文件；SFR/MSR 相似度 72.4%

# 构建基线
.\gradlew.bat compileJava --offline            # ❌ release 21 not supported (JDK 17)
javac -encoding UTF-8 -d <out> -cp <80 jars> @<831 sources>   # ✅ exit 0

# 覆盖率探针
javac -encoding UTF-8 -d out <localization/*.java> <Probe2.java>
java -cp out ...Probe2 samples.txt report.txt
```

---

*文档生成于本次分析会话；所有代码位置以工作区当前状态为准（含未提交的本地化改动）。*
