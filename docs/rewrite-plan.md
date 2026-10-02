# 推倒重来：NC Plannerator 重写方案

> 前置文档：`docs/refactoring-plan.md`（渐进式重构方案，本文档为其替代方案）
> 分析基线：工作区当前状态（含未提交的本地化改动）
> 所有数字为本次实测，采集方法见 [附录](#附录a采集方法)
>
> ### 📌 R0 已执行
> 目标技术栈已定为 **TypeScript / Web**，R0 阶段已推进：
>
> | 文档 | 内容 |
> |---|---|
> | **`docs/r0/findings.md`** | **R0 发现报告** —— 12 项发现：两套物理引擎在 **42.3%** 的样本上分歧（中位差 **4.03×**、最大 **87.6×**）；`matches()` 不自反导致**保存的工程打不开**；编辑器物理在 **5.5%** 的随机堆上直接 NPE；两个 NCPF writer 保真度不同；**Overhaul `.cfg` 导入路径是死的** |
> | **`docs/r0/golden-datasets.md`** | 黄金数据集口径、结果与**堆型支持矩阵**（哪些堆型能跑、为什么不能） |
> | `docs/r0/port-audit.md` | 831 个文件逐个归类（移植/重写/丢弃） |
> | `docs/r0/compat-contract.md` | 格式兼容性契约定稿（含检测顺序、两个 NCPF writer 的保真度差异） |
> | `docs/r0/format-roundtrip.md` | NCPF 往返测试：38 个生产配置 **38/38 指纹一致** |
> | `docs/r0/fixtures.md` / `fixtures-underhaul.md` | 各格式 fixtures 与往返验证（Underhaul 对照 **3/6 端到端一致**） |
> | `docs/r0/fixtures-ncconfig.md` | NCConfig（`.cfg`）fixtures：Underhaul **可读**（90 元素）、Overhaul **暴露死路径** |
> | `docs/r0/fixture-coverage.md` | reader 覆盖表（合成 fixture）：8 个 / 4 个读入成功 |
> | `docs/r0/historical-fixtures.md` | **真实历史文件**覆盖表：从 git 历史提取 12 个（2020–2025），**9 个读入成功**；`LegacyNCPF10/11Reader` 首次被真实文件验证 |
> | `docs/r0/translation-migration.md` | 译文迁移与数据名/UI 文案拆分 |
> | `tools/README.md` | R0 工具用法（黄金数据集 / 元素导出 / 格式往返 / fixtures / 译文迁移 / 移植审计） |
>
> 本文档中 §1.4、§4.3、§5、§6 的 R0 部分已按实测结果更新。
> R0 尚未完成：**R0.1 冻结 tag**（需用户许可）、**真实历史文件/真实设计样本**、
> **MSR/Turbine/Fusion 的专用构造器**。

---

## 0. 一页结论

**「推倒重来」在这个项目上是站得住的，而且有一个决定性的技术论据：反应堆物理被实现了两遍，且没有任何东西保证两者一致。**

| | |
|---|---|
| 现有规模 | 831 文件 / 77,825 行 |
| 真正的领域资产 | **约 15,000–18,000 行**（NCPF 模型 + 物理内核 + 格式契约） |
| 需要重写的表现层 | 约 35,000 行（GUI 14.3k + 主题 5.1k + 渲染 2.9k + VR 2.8k + DSSL IDE 2.0k + 本地化 1.3k + Discord 6.9k） |
| 重写后预估规模 | **25,000–35,000 行**（内核移植 15–18k + 新 UI/i18n/工具 10–17k） |
| 物理移植风险控制 | **黄金数据集**：先用现有 Java 实现批量产出 (反应堆 → 统计量) 基准，新实现必须逐字段匹配 |
| 数据层风险 | **极低**：NCPF 配置本来就是 JSON（10 MB / 34 个文件），可 1:1 搬迁 |
| 多语言 | 从第一天就是一等公民；在 Web 栈上这是**已解决问题**（ICU MessageFormat / Fluent），而不是需要自己造的东西 |
| 臃肿 | 562 MB 的 jpackage 发行包（含完整 JRE + 4 平台 LWJGL natives + JDA）→ 静态站点 **5–15 MB** |

**需要你拍板的 4 件事**见 [§9](#9-需要你拍板的决策清单)。

---

## 1. 为什么应该推倒重来（实测论据）

### 1.1 【决定性】反应堆物理被实现了两遍

编辑器里有一套物理，生成器里另有一套：

```
multiblock/overhaul/fissionsfr/OverhaulSFR.java        98.2 KB   ← 编辑器用的物理
    └─ propogateNeutronFlux()  postFluxCalc()  calculateHeatsink()  validate()  doCalculationStep()

multiblock/generator/lite/overhaulSFR/LiteOverhaulSFR.java  44 KB  ← 生成器用的物理
    └─ propogateNeutronFlux()  postFluxCalc()  calculateStats()  calculateClusters()  buildClusters()
```

两者的桥接只有一处：

```java
// OverhaulSFR.java:1851
public LiteOverhaulSFR compile(){
    LiteOverhaulSFR sfr = new LiteOverhaulSFR(CompiledOverhaulSFRConfiguration.compile(getSpecificConfiguration()));
    sfr.importAndConvert(this);      // 把编辑器的方块网格搬进 lite 表示
    return sfr;
}
```

**实测：两份 `propogateNeutronFlux()` 归一化后只有 24.4% 的行相同** —— 它们是同一套物理的两个独立实现（连方法名的 `propogate` 拼写错误都一起复制了过去）。

后果：

- 用户在编辑器里看到的功率/热量/效率，和生成器优化时用的目标函数，**来自两套代码**。二者漂移时没有任何机制能发现。
- 编辑器那套（`OverhaulSFR` 98 KB、`OverhaulMSR` 110 KB）把物理、渲染、工具提示、编辑操作、贴图全揉在一个类里 —— **无法单独测试物理**。
- 想修物理公式，得改两处，且只有一处有测试价值。

> 这一条决定了渐进重构的性价比极低：要修它，必须把 GUI 模拟器反转成「薄壳 + 内核」，而 `OverhaulSFR`/`OverhaulMSR` 与渲染层的耦合已深到没有安全切口。**推倒重来反而是更低风险的选择。**

### 1.2 表现层与领域逻辑无法分离（耦合实测）

| 依赖 | 引用它的文件数 | 涉及行数 |
|---|---:|---:|
| `graphics`（渲染层） | **201** / 831 文件 | 43,083 |
| `planner.gui`（UI 框架） | **152** / 831 文件 | 24,373 |
| `multiblock` | 214 文件 | 37,383 |

**831 个文件里有 201 个（24%）直接依赖渲染层**，涉及 43k 行。`multiblock` 包里 158 个文件中有 29 个含 `render()/draw()`，只有 10 个含 `calculate()`——领域逻辑和绘制代码是同一批文件。

### 1.3 反射式模块系统 + 双构建 + 零测试

- **反射驱动的模块注册**：`@RegisterWith(module = OverhaulModule.class)` 出现 76 次，注册靠 `classgraph` + `reflections` + `javassist`（3 个反射库，共 ~1.9 MB jar）在运行时扫描 classpath。模块系统本身只有 1,449 行，却拖进了整个反射栈。
- **两套构建系统并存**：Ant/NetBeans（`build.xml` + `nbproject/`，声明 Java 1.8、引用不存在的 `../NCPF/dist/NCPF.jar`）与 Gradle（声明 `release 21`）。**`./gradlew compileJava` 当前直接失败**（Gradle 跑在 JDK 17 上）。
- **单元测试 = 0**（`test/` 目录里只有 23 个 `.pdn/.png` 贴图源文件）。
- **CI = 0**（`.github/` 只有 `FUNDING.yml`）。

重写能把这三件事一次性归零：模块注册改成显式导入（无反射）、单一构建、测试从第一天写。

### 1.4 已经存在的、必须被处理的技术债

| 问题 | 实测 |
|---|---|
| 物理双实现 | `propogateNeutronFlux` 两份，24.4% 相同 |
| 巨类 | `OverhaulMSR` 110 KB / `OverhaulSFR` 98 KB / `Bot.java` 100.8 KB |
| 复制粘贴 | `OverhaulSFR` ↔ `OverhaulMSR` 共享 **72.4%** 归一化行（≈1,130 行） |
| 重复行占全项目 | 9.6%（4,385 / 45,740 有效行） |
| 样板代码 | `convertToObject(NCPFObject)` ×103、`convertFromObject` ×102、`getFunctionName()` ×60 |
| 中文化覆盖率 | 完整翻译 **39.3%** / 未翻译 **39.8%** / 中英夹杂 **20.9%** |
| 17 MB 字体 | `NotoSansSC-VF.ttf` 单文件 16.95 MB（原 4 个字体合计 0.08 MB） |
| 双份 OBJ 加载器 | `graphics/legacyobj/.../OBJLoader` 与 `discord/play/model/OBJLoader` |
| **`matches()` 不自反**（R0 发现） | 实测 `x.matches(x) == false`（`NCPFSettingsElement.java:186-210` 的 `Set` 分支类型假设错误）→ 含 Overhaul SFR 的工程**保存后打不开**（`coolant_recipe` 写成 -1 → NPE）。见 `docs/r0/findings.md` §8 |
| 两个同名 `coolantRecipes` 字段（字段遮蔽） | `NCPFOverhaulSFRConfiguration`（`List<NCPFElement>`）与 `OverhaulSFRConfiguration`（`List<CoolantRecipe>`）各有一个；design 序列化按静态类型取到父类那个 |
| Hellrage 用显示名当标识符 | `HellrageWriter` 写剥离词缀后的显示名，reader 按 `legacyNames` 匹配 → `Invalid fuel name: MOX-241!` / `Invalid block name: !` |
| **`LegacyNCPF1Reader` 读不了真实 v1 文件**（R0 发现） | 真实 2020 v1 文件抛 `NullPointerException: "<local5>.settings" is null`。v10/v11 的真实文件全部正常，说明是旧版本处理没跟上配置结构改动。见 `docs/r0/findings.md` §12.2 |
| **Overhaul `.cfg` 导入路径是死的**（R0 发现） | `OverhaulNCConfigReader:129-131` 无条件给 `NCPFListElement`（`canHaveAmount()==false`）传数量 → 构建器抛 `IllegalArgumentException`；原本正确的 `getRecipeContainedAlternative()` **全代码库零调用**。见 `docs/r0/findings.md` §11 |
| **辐照器分支缺 null 检查**（R0 发现） | `OverhaulSFR.java:1024` 直接取 `getBlock(...).template.moderator.flux`，而姐妹分支（1004 行）有 `if(...!=null)` 保护 → **5.5%（277/5000）的随机布局让编辑器直接 NPE**。见 `docs/r0/findings.md` §10 |

---

## 2. 资产盘点：什么必须保住

### 2.1 分级

| 级别 | 内容 | 行数 | 处理方式 |
|---|---|---:|---|
| **S 级（不可丢）** | `src/configurations/*.ncpf.json`（34 个 / 10 MB）、`src/textures`（683 文件 / 10.6 MB）、`src/tutorials`、`src/shaders` | — | **原样搬迁**，NCPF 已是 JSON，零转换成本 |
| **S 级** | 1185 条中文译文（`SimplifiedChineseLocalizer`） | 1,258 | 抽成迁移输入，人工校订后成为新 `zh_CN` 语言包 |
| **A 级（逐行移植）** | `ncpf/` 格式与数据模型 | 2,992 | 移植；去掉反射注册，改显式 |
| **A 级** | `planner/ncpf`（配置模型 + 120 个模块类） | 5,399 | 语义移植；模块类转为声明式 schema，消除 205 个样板方法 |
| **A 级** | **物理内核**（`multiblock/overhaul/*` 与 `generator/lite` 中的物理部分，合并为**单一实现**） | ~5,000–6,000 | 移植 + 用黄金数据校验 |
| **A 级** | `multiblock/underhaul` | 822 | 移植 |
| **B 级（按需移植）** | `planner/file`（格式 IO / 兼容契约） | 8,166 | **只移植必须支持的格式**，见 §2.2 |
| **B 级** | `multiblock/editor` 的 action/symmetry/tool 逻辑（无 UI 部分） | ~1,200 | 移植 |
| **B 级** | `planner/MathUtil`、`StringUtil`、`ImageIO`、`FormattedText` 语义 | ~800 | 移植 |
| **C 级（丢弃）** | `planner/gui`(14,311)、`planner/theme`(5,107)、`graphics`(2,894)、`planner/vr`(2,773)、`planner/dssl`(2,024)、`discord`(6,907)、`planner/localization`(1,258) | 35,274 | 丢弃，用新栈重写等价功能 |

**合计约 15,000–18,000 行需要移植或重写内核，约 60,000 行丢弃/替换。**

> ⚠️ 诚实的说明：「丢弃 35k 行」**不等于省下 35k 行的工作量** —— GUI、主题、3D 视图这些功能用户仍然需要。省下的是「与旧架构搏斗」的成本，以及新栈下同等功能的代码量会显著更小（预计新 UI + i18n + 工具 10,000–17,000 行）。

### 2.2 兼容性契约（必须先决策）

现有 53 个文件 / 8,166 行在做格式读写，支持的历史格式：

| 格式族 | 读者 | 建议 |
|---|---|---|
| **NCPF JSON**（当前主格式） | `NCPFReader` / `JSONNCPFReader` / `NCPFFileReader` / `NCPFFileWriter` | ✅ **完整读写**，最高优先级 |
| LegacyNCPF v1–v11 | `LegacyNCPF1Reader` … `LegacyNCPF11Reader`（11 个，`v11` 单文件 1,363 行） | ⚠️ **只读，且只保证 v9/v10/v11**（老版本用户量决定） |
| Hellrage（SFR/MSR v1–v6） | 12 个 reader | ⚠️ **只读，只保证 v6** |
| Underhaul Hellrage v1–v2 | 2 个 reader | ⚠️ 只读 |
| NCConfig（`.cfg`） | `OverhaulNCConfigReader`(420) / `UnderhaulNCConfigReader`(102) | ⚠️ 只读 |
| config2（`settings.dat`） | `config2` 包 | ❌ **不要移植**，写一个一次性迁移工具，新项目设置用 JSON |
| 导出：Hellrage / BG string / ZenScript / PNG | `HellrageWriter`(257) / `BGStringWriter`(171) / `ZenScript` / `PNGWriter`(168) | ✅ 保留 Hellrage + PNG；BG/ZenScript 按需 |

**建议契约**：读 = NCPF JSON 全支持 + LegacyNCPF v9–v11 + Hellrage v6 + NCConfig；写 = NCPF JSON + Hellrage v6 + PNG。**这能把 8,166 行压到约 3,000 行。**

---

## 3. 技术栈决策

### 3.1 决策矩阵

| 维度（权重） | A. TypeScript / Web | B. Kotlin + Compose Desktop | C. Rust + egui |
|---|---|---|---|
| **多语言能力**（用户痛点 #1，权重最高） | ★★★★★ ICU MessageFormat / Fluent / i18next 开箱即用，复数·语序·RTL·懒加载语言包全是成熟方案 | ★★★★ ICU4J 可用，但 UI 层需自建语言切换与热重载 | ★★★ 需自建 |
| **臃肿**（用户痛点 #2） | ★★★★★ 静态站点 5–15 MB，无 JRE、无 natives | ★★★ jlink + Skiko natives，约 40–80 MB | ★★★★★ 单二进制 ~10 MB |
| **物理移植风险** | ★★☆ 需重写为 TS（用黄金数据兜底） | ★★★★★ 逻辑几乎可直译 | ★★☆ 需重写为 Rust，难度更高 |
| **重生成器性能**（搜索算法） | ★★★ Web Worker + TypedArray；不够可下沉 WASM | ★★★★★ JVM 原生 | ★★★★★ |
| **分发与跨平台** | ★★★★★ URL 即用，覆盖 Win/macOS/Linux/Android/iOS/平板 | ★★★ 需为每平台打包 | ★★★★ 需为每平台编译 |
| **贡献者池**（MC 模组社区 + 翻译者） | ★★★★★ 翻译者改 JSON 提 PR 即可，无需工具链 | ★★ 需 JDK + Gradle | ★★ 需 Rust 工具链 |
| **3D 反应堆视图** | ★★★★ three.js / WebGPU 完全够用（方块网格） | ★★★★ Compose 3D 需接 Skia/OpenGL | ★★★★ |
| **离线可用** | ★★★★ PWA + Service Worker | ★★★★★ 原生 | ★★★★★ |

### 3.2 推荐：**A. TypeScript / Web 优先**

理由，直接对应你的两个痛点：

1. **多语言在 Web 栈是已解决问题。** 你现在的痛点是「自己造了一个 71 KB 的字符串替换表且只能有一种语言」。在 Web 栈上，`Intl.MessageFormat` / `@formatjs` / `Fluent` 提供：命名参数、复数规则（中文 n=1 与英文 n=1 行为不同）、语序重排、日期/数字本地化、RTL、按需加载语言包、**新增语言零代码零编译**。这正是你缺的能力。
2. **臃肿问题消失。** 现在 562 MB 的发行包里装的是：完整 JRE（~200 MB）+ 4 平台 × LWJGL 全套 natives + 17 MB 字体 + JDA 4.5 MB + 一个 Discord 小游戏。Web 版是 5–15 MB 的静态资源，字体用 `unicode-range` 子集化按需加载（不再需要 17 MB 单文件）。
3. **数据层零风险。** NCPF 配置已经是 JSON。
4. **顺带覆盖移动端。** 上游的 TWD 版本已经上架 Google Play —— Web 版一份代码同时覆盖桌面与移动，不必维护两套。
5. **贡献者与翻译者门槛最低**，这是让多语言真正「活起来」的关键。

**代价与缓解**：物理要用 TS 重写 → 这就是下一节「黄金数据集」存在的原因。生成器性能 → 先 Web Worker，实测不够再把热点下沉 WASM（Rust/AssemblyScript），接口不变。

### 3.3 备选：**B. Kotlin + Compose Multiplatform Desktop**

如果你的首要目标是**最低的物理移植风险**、且可以接受放弃 Web/移动分发，选 B：

- 物理逻辑几乎可以逐行直译（Kotlin 与 Java 互操作），黄金数据集校验的压力大幅降低
- `jpackage` + `jlink` 可以把发行包从 562 MB 压到 40–80 MB（丢掉 JDA、丢掉非当前平台 natives）
- ICU4J 提供完整的 i18n
- 缺点：桌面独占；翻译者需要 JDK 才能本地验证（但纯 JSON 改动仍可通过 PR 完成）

**不要选 C（Rust）**：贡献者池对这个社区来说太小。

---

## 4. 目标架构

### 4.1 分层

```
┌──────────────────────────────────────────────────────────────┐
│  app/             UI（Web: Svelte/React + Canvas/WebGPU）      │
│    · 菜单 / 编辑器 / 生成器面板 / 3D 视图                       │
│    · 所有文案走 t('key') ，无裸字符串                           │
│    · 只依赖 kernel 的公开 API，不依赖任何渲染实现                │
└───────────────────────────┬──────────────────────────────────┘
                            │  纯数据（无 GPU 对象、无 UI 类型）
┌───────────────────────────▼──────────────────────────────────┐
│  kernel/          领域内核（纯函数，无 IO、无渲染、无全局状态）   │
│    · physics/     唯一一份物理实现  ← 编辑器与生成器共用         │
│    · model/       NCPF 数据模型（Element / Configuration / …）  │
│    · search/      生成器搜索（可跑在 Worker / WASM）            │
│    · editor/      action / symmetry / tool 的纯逻辑             │
└───────────────────────────┬──────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────┐
│  formats/         格式 IO（读优先）                            │
│    · ncpf/        NCPF JSON 读写（主格式）                     │
│    · legacy/      LegacyNCPF v9-v11 / Hellrage v6 / NCConfig    │
└──────────────────────────────────────────────────────────────┘

横切（不占层）：
  i18n/     LocaleManager · MessageBundle(ICU) · DataNameBundle
  assets/   纹理 / 配置 JSON / 语言包 / 字体子集
```

### 4.2 三条必须守住的不变量

1. **物理唯一实现。** `kernel/physics` 是唯一的物理代码；编辑器和生成器都调用它，只是调用方式不同（编辑器逐步计算给 UI 反馈，生成器批量高速计算）。**引入一项 CI 检查：任何 `physics` 之外的目录不得出现中子通量/热量/效率的计算。**
2. **身份与表现分离。** 元素的**身份**是 `type + definition 字符串`（与语言无关）；`displayName` 只是表现。所有逻辑、导入匹配、导出，一律用身份或英文 canonical；只有界面显示用本地化名。
3. **i18n 一等公民。** 核心包里禁止出现用户可见的字面量字符串（用 lint 规则强制）；语言包是数据，不是代码。

### 4.3 数据流（对比现状）

```
现状：  NCPF JSON(英文) ──► NCPFElement.getDisplayName() ──► 拼接字符串 ──► Renderer ──► 子串替换表 ──► 屏幕
                                                        └─► 同时被逻辑当标识符用（贴图路径/导入匹配/导出）

目标：  NCPF JSON(英文 canonical)
          ├─► identity(config/cfgType/type|definition) ──► 逻辑 / 导入匹配 / 导出   ← 永远英文
          └─► DataNameBundle(locale)  ──► 界面显示名                              ← 本地化
        UI 文案: t('tooltip.neutron_source', { name })  ← ICU，语序/复数由语言包决定
```

**身份键必须四段式**（R0 实测修正，见 `docs/r0/findings.md` §4）：

```
<config>/<cfgType>/<definition.type>|<definition.toString()>
```

仅用 `type|definition` 时，实测 660 个去重键中 **29 个对应互相冲突的显示名** —— 同一个
`legacy_item` 名称在不同配置下代表不同物品：

```
legacy_item|nuclearcraft:fuel_americium:2
    'HEA-242'          <- Underhaul SFR Configuration
    'LEA-242 Nitride'  <- Overhaul SFR Configuration
```

加 `config`/`cfgType` 命名空间后 → 732 个键，**显示名冲突降为 0**（剩余 108 个"碰撞"是同一元素
出现在多个元素列表中，显示名一致，可安全合并）。

---

## 5. 最关键的工程手法：黄金数据集

**这是把「移植物理」从信仰之跃变成可测任务的关键，必须在动第一行新代码之前完成。**

> ✅ **R0 已完成**：harness、5,000 例数据集、分歧集都已产出。实测结果见 §5.4，
> 完整报告见 `docs/r0/findings.md`，用法见 `tools/README.md`。

### 5.1 可行性（已确认的钩子，并已实测跑通）

| 开关 | 位置 | 作用 |
|---|---|---|
| `-Dplannerator.skipTextures=true` | `TextureModule.java:19` | 跳过 base64 贴图解码（配置 10 MB 几乎全是贴图）→ 配置可脱离 GL 加载 |
| `Main.isBot = true` | `Core.java:869,875,881` | `Core.warning/error/criticalError` 在解引用 `Core.gui` 之前 return |

配合 `MenuInit` 的启动顺序（模块注册走 classgraph 纯反射），**整个 bootstrap 在无显示环境下跑通**。

### 5.2 步骤

1. **写一个 Java 批处理 harness**（不碰 GUI）：加载 NCPF 配置 → 构造反应堆 → 调用现有 `calculate()` → 导出 JSONL。
   > 已实现：`tools/golden/`（`Bootstrap` / `GoldenGen` / `golden.ps1`）。
2. **覆盖面**：SFR / MSR / Turbine / Fusion / Distiller / Underhaul。
   > ⚠️ **R0 修正**：实测只有 **Overhaul SFR 与 Underhaul SFR** 同时具备
   > 「已注册 + 有配置 + 长方体网格 + 有第二引擎」四个条件。
   > MSR / Turbine 的通用填充造不出**可用**反应堆（统计恒 0），需要各自的专用构造器；
   > Fusion 不是 `CuboidalMultiblock`（环形几何）；Distiller 没有任何随附配置包含它的 settings。
   > 见 `docs/r0/golden-datasets.md` §4。已产出两个堆型各 5,000 例。
3. **同时产出「分歧集」**：同一反应堆分别跑 `OverhaulSFR.recalculate()` 与 `LiteOverhaulSFR.calculate()`，记录不一致的字段。
   > 已实现，每条记录的 `divergence` 字段。
4. **新实现必须逐字段匹配**：
   > ⚠️ **R0 修正**：验收标准**不能**是"与两套旧引擎都逐位相等"，因为**旧实现自身在两套引擎间就不一致**
   > （实测 5,000 例中 0 例完全一致）。正确做法：
   > - **以编辑器引擎为黄金值**（用户看到的是它），TS 实现必须匹配；
   > - 生成器引擎的差异单独记录为「已知不一致清单」，重写后**必须消失**（新实现只有一份物理）；
   > - 旧实现的 `NaN` / 负值原样记录，TS 侧另做规范化并单独对拍。
5. **黄金数据集入库**：5,000 例 / 解压 43.5 MB / gzip 4.39 MB → `datasets/golden/sfr-cases.jsonl.gz`。

### 5.3 附带收益

- 得到**现有实现的正确性基线**，能回答「编辑器显示的功率和生成器优化的功率到底一不一样」——
  **R0 已回答：不一样，42.3% 的样本分歧，中位差 4.03×。**
- 得到一个可复用的**回归测试套件**，此后任何物理改动都有安全网。
- 得到一个**性能基线**（每例耗时），用于验证新实现是否达标。

### 5.4 R0 实测结果（5,000 例 Overhaul SFR）

| 项 | 结果 |
|---|---:|
| 两套引擎**完全一致** | **0 例（0.00%）** |
| 仅 `shutdownFactor` 分歧 | 2,885（57.7%） |
| **核心物理分歧** | **2,115（42.3%）** |
| └ 其中双方输出都有量级意义（≥1） | 1,780 |
| └ **中位差距倍数** | **4.03×** |
| └ 差距 >2× | 1,444 / 1,780（81.1%） |
| └ 最大差距 | **87.6×** |

按字段：`shutdownFactor` 67.6%、`functionalBlocks`/`sparsityMult` 41.8%、
`totalFuelCells`/`totalHeat`/`netHeat` 41.5%、`totalOutput` 40.6%、`totalEfficiency` 40.4%。

另发现：编辑器 `shutdownFactor` 在零输出时为 **NaN**（`OverhaulSFR.java:945` 的 `1-(offOutput/totalOutput)`），
且实测 **13 例越界**（负值或 >1）。

**方法学局限**：样本是随机方块网格，分歧**比例**不能直接外推到真实手搭反应堆；但"同一份网格、
两套引擎给出中位 4× 差异"与样本是否现实无关。用真实用户 `.ncpf` 重跑是 R0.3 的收尾项。

---

## 6. 分阶段重写计划

> 📌 **执行细则见 `docs/rewrite-plan-r1-r5.md`**（R1–R5 的任务分解、验收标准、
> 关键路径、风险登记册、工程约定）。本节保留概要；两处冲突时以该文档为准。

> 工期为粗估（**人周**，1 名熟悉本项目的开发者）。`∥` 表示可并行。

### R0 — 冻结与提取（2–3 周）

> **R0 执行状态**：R0.2 / R0.3 / R0.5 / R0.6 / R0.7 **已完成**，报告见 `docs/r0/findings.md`，
> 工具用法见 `tools/README.md`。R0.1（git tag）待用户许可，R0.4（格式 fixtures）待做。

| # | 任务 | 产出 / 验收 | 状态 |
|---|---|---|---|
| R0.1 | 冻结当前 `overhaul` 分支，打 tag，发布一个「最终 Java 版」 | tag `java-final` | ⏳ 待许可 |
| R0.2 | 写批处理 harness（利用 `plannerator.skipTextures`） | 可对任意 `.ncpf` 批量输出统计 JSON | ✅ `tools/golden/` |
| R0.3 | **生成黄金数据集** + 编辑器/生成器分歧集 | ≥3 万例，入库 | ✅ **Overhaul SFR 5,000 例 + Underhaul SFR 5,000 例**（`datasets/golden/*.jsonl.gz`，共 6.38 MB）；**真实设计导入模式 `--from-ncpf` 已就绪**（待输入文件）；口径见 `docs/r0/golden-datasets.md` |
| R0.4 | 收集格式样本：各历史格式的真实文件各 ≥3 个，建立 `fixtures/` | 格式回归基准 | ✅ NCPF **38/38 往返一致**；合成 fixtures（Underhaul 对照 **3/6 端到端**）；NCConfig underhaul 可读 / overhaul 暴露死路径；**真实历史文件 12 个（2020–2025），9 个读入成功** |
| R0.5 | 抽取 1185 条译文 → `legacy-translations.json`，与 NCPF 元素身份键关联 → `zh_CN` 语言包草稿 | 迁移输入就绪 | ✅ `datasets/translations/` + `lang/*.draft.json` |
| R0.6 | 逐文件审计：产出「移植 / 重写 / 丢弃」精确清单 | `PORT-AUDIT.md` | ✅ `docs/r0/port-audit.md`（831 文件全部归类） |
| R0.7 | 兼容性契约定稿（§2.2 决策） | 书面契约 | ✅ `docs/r0/compat-contract.md` |

**里程碑 M0**：黄金数据集 + 格式样本 + 迁移输入三件套就绪。**没有 M0 不许动新代码。**
（当前 M0 差 R0.4 与其余堆型的黄金数据。）

### R1 — 新项目骨架 + 内核（4–6 周）

| # | 任务 | 验收 |
|---|---|---|
| R1.1 | 初始化新仓库：TS + Vite + Vitest；`kernel/` 内禁止 import UI | lint 规则生效 |
| R1.2 | i18n 基础设施（先于一切 UI）：`LocaleManager` / ICU `MessageBundle` / `DataNameBundle` / 语言包加载与切换 | 单元测试：复数、语序、回退链、缺 key 上报 |
| R1.3 | `kernel/model/`：NCPF 数据模型（移植 `ncpf/` + `planner/ncpf`），显式注册替代反射 | 34 个配置全部加载成功 |
| R1.4 | `formats/ncpf`：NCPF JSON 读写 | 读→写→再读语义等价（34/34） |
| R1.5 | **`kernel/physics/`：单一物理实现**（SFR 起步） | **黄金数据集 SFR 全通过** |
| R1.6 | physics 扩展到 MSR / Turbine / Fusion / Distiller / Underhaul | 黄金数据集全通过 |

**里程碑 M1**：`kernel` 能在 Node 端跑完全部物理，黄金数据集 100% 通过。**此时还没有一行 UI，但核心风险已消除。**

### R2 — 格式兼容层（2–3 周）∥

| # | 任务 | 验收 |
|---|---|---|
| R2.1 | NCPF 读写完善（含 addons、legacy_names、blocks） | 往返等价 + 与 Java 版互读 |
| R2.2 | LegacyNCPF v9/v10/v11 只读 | fixtures 全部读入且统计量与黄金集一致 |
| R2.3 | Hellrage v6 只读 + Hellrage 写出 | 同上；导出文件能被 Java 版读回 |
| R2.4 | NCConfig `.cfg` 只读 | fixtures 通过 |
| R2.5 | `config2` 一次性迁移工具（独立小 CLI） | 旧 `settings.dat` 可迁移 |
| R2.6 | PNG 导出 | 与 Java 版目视一致 |

### R3 — UI（6–10 周）

| # | 任务 | 验收 |
|---|---|---|
| R3.1 | 应用骨架、路由、布局、主题令牌（CSS 变量替代 5,107 行 theme 代码） | 主题可切换 |
| R3.2 | **语言切换 UI + 设置持久化** | 运行时切换，无需重启 |
| R3.3 | 菜单 / 对话框 / 文件选择 / 拖放 | — |
| R3.4 | 配置编辑器（等价 `MenuElementConfiguration`） | 能编辑元素属性与模块 |
| R3.5 | 方块网格编辑器（绘制 / 选择 / 工具 / 撤销重做 / 对称） | 等价现有编辑能力 |
| R3.6 | 2D 俯视视图 + 部件清单 | — |
| R3.7 | 3D 视图（方块网格 + 旋转/缩放/剖切/外壳） | 等价 `editor3dView` 能力 |
| R3.8 | 统计面板 / 工具提示（**全部走 ICU key，禁止拼接**） | `i18nAudit` 零裸字符串 |
| R3.9 | 自动更新 / 版本检查 | — |

### R4 — 生成器（3–5 周）

| # | 任务 | 验收 |
|---|---|---|
| R4.1 | 移植搜索算法（mutator / condition / variable / anim） | 与 Java 版在相同随机种子下产出同质结果 |
| R4.2 | 并行化（Web Worker 池 / 可选 WASM 热点） | 单核性能 ≥ Java 版 |
| R4.3 | 生成过程 UI（进度 / 中间结果 / 中断） | — |
| R4.4 | 自定义生成脚本（**是否保留 DSSL 见 §9**） | — |

### R5 — 迁移、打磨、发布（2–4 周）

| # | 任务 | 验收 |
|---|---|---|
| R5.1 | 中文语言包完整化 + 术语表 | 覆盖率 > 98% |
| R5.2 | 至少再一门语言（英文即为第二门，作为规范源） | 新增语言零代码 |
| R5.3 | PWA / 离线 | 断网可用 |
| R5.4 | 数据迁移指引（旧格式导入 → 新格式导出） | 用户文档 |
| R5.5 | 发布流水线（CI → 静态站点 + 可选桌面壳） | 一键发布 |
| R5.6 | 与上游沟通（见 §8.3） | — |

### 里程碑总览

| 里程碑 | 内容 | 累计粗估 | 达成标志 |
|---|---|---:|---|
| **M0** | 冻结与提取 | 2–3 周 | 黄金数据集就绪 |
| **M1** | 内核可用 | 6–9 周 | 物理 100% 通过黄金集，**核心风险消除** |
| **M2** | 格式兼容 | 8–12 周 | 旧文件能读，新文件能写 |
| **M3** | UI 可用 | 14–22 周 | 能完成「画堆 → 计算 → 导出」全流程 |
| **M4** | 生成器可用 | 17–27 周 | 功能对齐 Java 版 |
| **M5** | 可发布 | 19–31 周 | 中文完整，PWA 可用 |

**关键节点是 M1**：如果黄金数据集在 M1 全通过，项目的最大风险（物理移植）就消除了，后续只是工作量问题。如果 M1 卡住，说明技术栈选错（考虑切到 §3.3 的 Kotlin 方案），**此时沉没成本还很小**。

---

## 7. 多语言：这一次一次做对

| 要求 | 做法 | 现状对比 |
|---|---|---|
| 新增语言 = 新增一个文件 | 语言包是纯 JSON/FTL，运行时加载 | 现在要写 71 KB 的 Java 类并重新编译 |
| 运行时切换 + 持久化 | `LocaleManager` + settings | 现在硬编码 `static final`，无切换 |
| 语序可重排 | ICU MessageFormat 命名参数 | 现在是子串替换，`"A to B"` 无法处理 |
| 复数/量词 | ICU plural 规则 | 现在完全没有 |
| 零半翻译 | 缺 key **整条**回退到规范语言，并上报 | 现在是「能翻的翻一半，剩下的留英文」 |
| UI 文案与数据名分离 | `MessageBundle` vs `DataNameBundle`（身份键：`type+definition`） | 现在混在同一张表 |
| 逻辑不依赖显示名 | 身份 / 英文 canonical 与显示名彻底分开 | 现在 6 处把英文显示名当标识符 |
| 翻译可协作 | 语言包走 PR，CI 自动校验覆盖率/未使用 key/冲突 key | 现在无工具（只有一个孤儿 `.class`） |
| CJK 字体不臃肿 | 字体子集化 + `unicode-range` 按需加载 | 现在 16.95 MB 单文件全量加载 |
| 日语/韩语字形 | 字体回退链，按 locale 选主字体 | 现在缺字形直接显示 `?` |
| RTL 预留 | 布局用逻辑属性（`margin-inline-start` 等） | 现在写死左右 |

**术语表**（`lang/glossary.md`）是保证翻译质量的关键：`SFR`(固体燃料堆) / `MSR`(熔盐堆) / `Heatsink`(散热器) / `Moderator`(慢化剂) / `Flux`(通量) / `Casing`(外壳) / `Irradiator`(辐照器) 等必须先定死，否则多个贡献者会各行其是。

---

## 8. 风险、成本与替代方案

### 8.1 风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| **物理移植出错** | 🔴 高 | 黄金数据集（§5）；M1 是决策闸门 |
| **格式兼容性丢失**，老用户存档读不出 | 🔴 高 | 契约先行（§2.2）+ fixtures 回归 + 保留 Java 版作为「兼容性后端」备选 |
| **生成器性能不如 JVM** | 🟡 中 | 先 Worker，实测不够再下沉 WASM；R4.2 有明确验收 |
| **重写期间上游继续演进**（上游已在抽 NCPF / DizzyEngine） | 🟡 中 | R0.1 冻结基线；§8.3 主动沟通；NCPF 是数据格式，上游演进影响有限 |
| **19–31 周无用户可用版本** | 🟡 中 | Java 版保持可发布；每个里程碑产出可用中间态（M2 后可先做 CLI） |
| **3D 视图/编辑器体验回退** | 🟡 中 | R3.7 明确对标项；优先做「能用」再做「好看」 |
| **一个人做不完** | 🔴 高 | 见 §8.4 的范围裁剪建议 |

### 8.2 三个方案的诚实对比

| | 渐进重构（`refactoring-plan.md`） | **内核移植 + UI 重写**（推荐） | 全量重写 |
|---|---|---|---|
| 物理风险 | 低（不动物理） | **低**（黄金数据兜底） | 中→高 |
| 多语言能否做对 | ✅ 能，但要长期与旧架构共存 | ✅ 能，从零干净 | ✅ |
| 臃肿能否解决 | ⚠️ 部分（可拆模块，但渲染层与主题仍在） | ✅ 彻底 | ✅ 彻底 |
| 物理双实现能否消除 | ❌ 很难（无安全切口，见 §1.1） | ✅ 天然消除 | ✅ |
| 工期 | 6–10 周 | **19–31 周** | 30–45 周 |
| 中途可用 | ✅ 每阶段都可用 | ⚠️ M3 后才有 UI | ❌ |

**本文档推荐的其实就是「内核移植 + UI 重写」，而不是「全量从零编写」。** 区别很重要：

- **不是**把 78k 行全部从零再写一遍（那是 30–45 周且没必要）
- **而是**把 15–18k 行内核**带测试地移植**过去，UI 层从零用现代栈写，历史包袱不带走

### 8.3 与上游的关系（必须先想清楚）

上游状态：

- 最后提交：「Updated libraries, prepared project for **DizzyEngine & Separate NCPF lib**」——已经在把渲染层和 NCPF 抽成独立库
- 另有一个 `nc-planner-twd` 多平台版本，已上架 Google Play

三条路：

| 路线 | 说明 |
|---|---|
| **① 彻底分叉** | 你的重写版自成一体，与上游无关。NCPF 格式继续兼容（数据可互通），但不追代码。**最简单，推荐作为默认** |
| **② 贡献回上游** | 把 i18n 能力、字体回退链、字形图集做进 `DizzyEngine`，把物理内核抽出的设计回推。收益大但协调成本高，取决于上游意愿 |
| **③ 采用上游的 TWD 版** | 如果上游的多平台版已经解决了大部分问题，评估「基于它做中文化」是否比自研重写更划算。**建议 R0 阶段花 1–2 天评估** |

**建议**：R0 阶段先花 1–2 天评估路线 ③（读 `nc-planner-twd` 的技术栈与完成度）。如果它已经是一个现代栈的可用实现，那么「基于它做中文 + 补齐功能」的成本可能远低于自研重写；如果它是另一个 Java/Android 单体，则走路线 ①。

### 8.4 范围裁剪建议（如果只有 1 个人）

砍掉这些，工期可压到 **12–18 周**：

- ❌ VR（2,773 行，基本无人使用）
- ❌ DSSL 内嵌脚本 IDE（2,024 行 + 1 MB jar；无任何随附脚本或配置依赖它）
- ❌ Discord 机器人 + Smivilization 小游戏（6,907 行 + JDA 4.5 MB）
- ❌ 自定义主题系统（5,107 行）→ 改为 2–3 个内置主题 + CSS 变量
- ❌ LegacyNCPF v1–v8、Hellrage v1–v5（只保 v9–v11 / v6）
- ⏸ 3D 视图延到 M3 之后
- ⏸ Fusion / Distiller 延到 SFR / MSR 之后

---

## 9. 需要你拍板的决策清单

| # | 决策 | 选项 | 我的建议 |
|---|---|---|---|
| **D1** | 技术栈 | A. TypeScript/Web ／ B. Kotlin+Compose Desktop ／ C. 先评估上游 TWD | **先做 C（1–2 天），再定 A/B**；倾向 A |
| **D2** | 目标平台 | 纯 Web（PWA）／ Web + 桌面壳 ／ 桌面原生 | **Web + PWA**，桌面壳按需加 |
| **D3** | 兼容性契约 | 全格式兼容 ／ 只保主格式 + 近三代 | **只保 NCPF JSON 全 + LegacyNCPF v9–11 + Hellrage v6** |
| **D4** | 范围 | 全功能对齐 ／ 裁剪版（§8.4） | 若 1 人：**裁剪版**，先做 SFR/MSR 打通闭环 |
| **D5** | 是否保留 DSSL 脚本能力 | 保留（需移植解释器）／ 丢弃 ／ 换成现代脚本方案 | **丢弃**；如确有需求，用 JS 沙箱替代（Web 栈天然有） |
| **D6** | 是否保留 VR | 保留 ／ 丢弃 | **丢弃** |
| **D7** | 是否保留 Discord 机器人 | 保留（独立仓库）／ 丢弃 | **独立仓库**，不进主项目 |

---

## 附录A：采集方法

```powershell
# 物理双实现验证
#   提取 OverhaulSFR.java 与 LiteOverhaulSFR.java 的 propogateNeutronFlux() 方法体，
#   按「去空白 + 去注释」归一化后求交 → 24.4% 相同
#   桥接点：OverhaulSFR.java:1851-1853  compile() → LiteOverhaulSFR.importAndConvert(this)

# 耦合度
#   统计 import net.ncplanner.plannerator.<pkg>. 的文件数与行数
#   graphics: 201 文件 / 43,083 行    planner.gui: 152 文件 / 24,373 行

# 保留/移植/丢弃预算
#   按子包统计 *.java 文件数与行数（见 §2.1 表）

# 复制粘贴
#   归一化行哈希（去空白/注释/import，长度 ≥16）→ 9.6% 跨文件重复
#   OverhaulSFR ↔ OverhaulMSR 归一化行相似度 72.4%

# headless 可行性
#   Main.java:36 headless / Main.java:39 benchmark 启动参数
#   TextureModule.java:19  plannerator.skipTextures 旁路开关（配置加载无需 GL）
```

## 附录B：与渐进重构方案的取舍

`docs/refactoring-plan.md` 里的工作**不是白做的**，其中以下内容在重写方案里同样是前置条件：

- Phase 0 的黄金基线（NCPF 往返测试）→ 升级为本文档 §5 的黄金数据集
- Phase 0.6 的 `i18nAudit` 工具 → §7 的 CI 门禁
- Phase 0.5 的译文冻结 → R0.5 的迁移输入
- Phase 2 的「禁止字符串拼接」原则 → §4.2 不变量 3
- Phase 3 的「身份 vs 表现分离」设计 → §4.2 不变量 2

**如果暂时不确定要不要重写**：可以先只做 `refactoring-plan.md` 的 Phase 0（2–3 人日），它产出的黄金数据集、审计工具、译文冻结**是两条路线共用的地基**，不会浪费。

---

*文档生成于本次分析会话；代码位置以工作区当前状态为准。*
