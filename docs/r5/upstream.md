# R5.6 — 上游关系

> 计划：`docs/rewrite-plan-r1-r5.md` §8 R5.6（「与上游沟通（§2 D4）」）、§2 D4、§12 D4；
> 原始分析见 `docs/rewrite-plan.md` §8.3（三条路线）。
>
> **本文的证据边界**：只用**本仓库内**可得的事实 —— Java 树的 git 历史、`docs/r0/port-audit.md`、
> `docs/r0/findings.md`、`versions.txt`、`README.md`、`patrons.txt`，以及 `nbproject/` 与工作区状态。
> **没有查网**：凡是只有看上游今天的仓库/发布页才能回答的问题，一律进 §6「未验证」。

---

## 0. 一句话结论

D4 要求的「R1 之前花 1–2 天复查上游」**没有做**，仓库里也没有任何该复查的产物；
用仓库内证据能确定的是：**冻结点是 2026-06-12 的 `overhaul` 分支，而上游在那一天前后正好开始把
渲染层（DizzyEngine）与 NCPF 抽成独立库**——也就是说本项目是在上游「拆分前夜」分叉的，
分叉面恰好落在上游即将搬走的两个包上。
因此建议：**① 彻底分叉为主 + ② 只做「窄回推」（按库级能力，而不是按补丁）**，
成本是放弃跟进上游后续（含抽库后的 `nbproject` 引用），而**互操作风险很低**，因为 NCPF 是数据格式。

| 项 | 结论 |
|---|---|
| D4 的 1–2 天复查 | ❌ 未做（§1） |
| 冻结点 | `717d51bb`（2026-06-12），Java 源码最后变动是 `17a7e2ca`（同日）；**无 tag**（§2） |
| 分叉边界 | fork 改动 = 渲染层本地化入口 + 字号 + 两处物理 guard，**全部未提交**（§2.3） |
| 上游方向 | 同一个 commit 里已把 `NCPF` / `DizzyEngine` 当外部库（`nbproject` 引用不存在的 jar）（§3） |
| 建议 | ① 为主 + ② 窄回推；不选 ③（§4.5） |
| 可回推的东西 | 8 项，按「上游有没有用」排序（§5） |

---

## 1. 诚实的起点：D4 没有交付

计划的原文（`docs/rewrite-plan-r1-r5.md` §2 D4）：

> R0 期间**上游状态未复查**（首次分析时上游已在抽 `DizzyEngine`/`NCPF`，
> 并有 `nc-planner-twd` 多平台版上架 Google Play）。建议 R1 开始前花 **1–2 天**复查：
>
> - 若上游多平台版已是现代栈 —— 评估「基于它做中文化」是否比自研更划算（可能省掉 R1–R4）
> - 若是另一个 Java/Android 单体 —— 走彻底分叉，但**把 i18n 与字体能力回推给上游**（双赢）

`docs/rewrite-plan-r1-r5.md` §12 把它列为待决策项（「先花 1–2 天复查再定」，阻塞「可能影响整个 R1–R4」）。

**实际执行情况**：没有做，也没有留下任何文档。可复核：

```text
Name
----
r0
r1
r2
r3
i18n-audit-baseline.txt
refactoring-plan.md
rewrite-plan-r1-r5.md
rewrite-plan.md
```

（`Get-ChildItem docs` 的实测输出；`Get-ChildItem -Recurse docs -Filter "*upstream*"` 无结果；
R2/R3 的验收补记在 `docs/rewrite-plan-r1-r5.md` §8.1，里面也没有 D4。）

**这件事的后果要说清楚**：D4 本来是「可能影响整个 R1–R4」的决策。它在 R1–R3 全部交付之后仍然悬着，
所以现在再回头的成本已经和当初不一样了（§4.5 的机会成本）。**本文件不是那次复查**：
它只把「仓库内能确定的部分」写实，并把「必须看上游今天」的问题集中列进 §6。

---

## 2. 冻结时点：仓库里能证实的一切

### 2.1 git 历史（实测）

```text
$ git log --oneline -n 5
717d51bb Unbroke library downloading for live versions
17a7e2ca Updated libraries, prepared project for DizzyEngine & Separate NCPF lib
cb96ad4c Fixed coordinate issue when converting any multiblock to a design
4c6f9820 removed the "whatever <thing> gets turned into" from SFR tooltip, now uses recipe output
bd178a2e Updated default config to use legacy_recipe for multiblock & irradiator recipes
```

| 项 | 实测值 |
|---|---|
| HEAD | `717d51bb28e3465d9faaaf1ae158e99ee2008f8c`，2026-06-12，「Unbroke library downloading for live versions」 |
| Java 源码（`src/`）最后一次变动 | `17a7e2ca38a8a5b3d4dd631a8e025317078b19eb`，2026-06-12，「Updated libraries, prepared project for **DizzyEngine & Separate NCPF lib**」 |
| 提交总数 | `git rev-list --count HEAD` = **1090** |
| 分支 | `overhaul`（`origin/HEAD -> origin/overhaul`） |
| tag | **无**（`git tag` 空输出） |

关键点（逐条实测，别把两个提交混为一谈）：

- **HEAD（`717d51bb`）没有改 `src/`**：`git show --stat HEAD` 是 72 个文件的纯二进制变动，
  `0 insertions(+), 0 deletions(-)`，全在 `libraries/**`；
- **`17a7e2ca` 不只是换库**：它新增 `libraries/DizzyEngine/**`（92 个 jar，含 `joml-1.10.9`、
  LWJGL 3.3.3 全套，以及若干 `*-sources.jar` / `*-javadoc.jar`）之外，还改了
  `nbproject/**`（`project.properties` 大幅瘦身、`build-impl.xml` +36、`project.xml` +18）
  和**一个 Java 文件**：`src/net/ncplanner/plannerator/planner/module/Module.java`（87 行）；
- 那个 Java 改动是把模块自动注册从 `org.reflections.Reflections` 换成**一次 classgraph
  `ScanResult` 扫描**（`acceptPackages("net.ncplanner.plannerator")` +
  `getClassesWithAnnotation(RegisterWith.class)`）——**这正是「准备把 NCPF 拆出去」的代码动作**，
  因为注册表要能跨库扫描。

也就是说：**上游最后一个提交是纯库变动，倒数第二个是「换库 + 构建配置 + 模块注册改成 classgraph」**。
对本项目有一条直接后果：冻结基线里的模块注册**已经是 classgraph**（`docs/r0/findings.md` §1 的
bootstrap 也用 `Core.refreshModules()` → classgraph），所以 R1.3d 的「显式注册替代反射」
是在替换一份**上游刚刚重写过**的代码（`docs/rewrite-plan-r1-r5.md` §4.4 R1.3d）。

> 另需注意：`docs/r0/findings.md` §13 里 R0.1「冻结 tag / 最终 Java 版发布」的状态是
> **⏳ 待用户确认（涉及 git 写操作）**，而当时 `git tag` 为空 —— 所以当时的「冻结」只是
> **工作区状态 + 文档记录**，不是可引用的 tag。`datasets/golden/BASELINE.md` 也这么写：
> 引擎 = 「`java-final`（工作区冻结源码 + D1-B 的辐照器 null guard）」。
>
> **现已解决（`docs/java-exit-plan.md` §P4，2026-10）**：冻结 tag 已建立并推送 ——
> **`java-frozen-c79c557f`**（指向 P3 提交 `c79c557f`，是删除 Java 树之前最后一个
> 含完整 `src/**` + `libraries/**` + 构建链的提交）。上面便 `git show` 的这些路径
> 现在都在这个 tag 里，本节的命令前面加一句
> `git checkout java-frozen-c79c557f -- src libraries nbproject build.gradle build.xml tools/golden`
> 即可原样复现；直接在仓库根跑会报 `pathspec ... did not match`，因为 `src/**` 与
> `libraries/**` 已从工作区移除。原始 commit sha（`717d51bb` / `17a7e2ca`）不变，仍是
> 最精确的证据锚点（tag 只是给它们加了一个稳定的名字）。

### 2.2 上游曾经发布过什么（`versions.txt`）

`versions.txt` 共 107 行，全部指向**同一个上游仓库**
`github.com/ThizThizzyDizzy/nc-reactor-generator` 的 release 资源，从 `2.0` 一直到 **`5.0.5`**。
三代 jar 名可以读出上游的产品线演进：

| 版本段 | jar 名 | 行 |
|---|---|---|
| `2.0` … `3.5.1` | `NC-Reactor-Generator-<v>.jar` | 1–91 |
| `4.0` … `4.5` | `NC-Reactor-Plannerator-<v>.jar` | 92–101 |
| `5.0.0` … `5.0.5` | `NC-Plannerator-<v>.jar` | 102–107 |

`README.md` 第 6 行给出多平台版的位置：

```text
For the Multiplatform version, see https://github.com/ThizThizzyDizzy/nc-planner-twd
```

**能确定**：本项目是上述仓库 `overhaul` 分支的 fork；上游存在一个**独立的** `nc-planner-twd` 仓库；
上游发布线到 **5.0.5** 为止（本仓库能看到的最新一项）。

### 2.3 fork 自己改了什么（**全部未提交**）

这是「分叉边界」最硬的一条证据。`git status --short` / `git diff --stat` 实测
（下面只列与 Java 树 / 本地化相关的条目；完整输出还包含本仓库新增且未跟踪的
`packages/`、`docs/`、`tools/`、`datasets/`、`lang/`、`build.gradle`、`vitest.config.ts` 等）：

```text
 M .gitignore
 M README.md
 M src/net/ncplanner/plannerator/graphics/Font.java
 M src/net/ncplanner/plannerator/graphics/FontCharacter.java
 M src/net/ncplanner/plannerator/graphics/Renderer.java
 M src/net/ncplanner/plannerator/multiblock/overhaul/fissionmsr/OverhaulMSR.java
 M src/net/ncplanner/plannerator/multiblock/overhaul/fissionsfr/OverhaulSFR.java
 M src/net/ncplanner/plannerator/planner/Core.java
 M src/net/ncplanner/plannerator/planner/Main.java
 M src/net/ncplanner/plannerator/planner/theme/Theme.java
?? src/fonts/NotoSansSC-VF.ttf
?? src/net/ncplanner/plannerator/planner/localization/
```

```text
 .gitignore                                         |  17 +++
 README.md                                          |  32 ++++-
 src/net/ncplanner/plannerator/graphics/Font.java   | 105 ++++++++++++++--
 .../plannerator/graphics/FontCharacter.java        | 136 ++++++++-------------
 .../ncplanner/plannerator/graphics/Renderer.java   |   9 +-
 .../overhaul/fissionmsr/OverhaulMSR.java           |  15 ++-
 .../overhaul/fissionsfr/OverhaulSFR.java           |   8 +-
 src/net/ncplanner/plannerator/planner/Core.java    |  25 ++--
 src/net/ncplanner/plannerator/planner/Main.java    |   6 +-
 .../ncplanner/plannerator/planner/theme/Theme.java |   4 +-
 10 files changed, 243 insertions(+), 114 deletions(-)
```

按内容分类（都是 `git diff` 实读）：

| 类别 | 文件 | 改了什么 |
|---|---|---|
| **本地化入口** | `Renderer.java` | `drawText` / `drawCenteredText` / `drawText(4 args)` / `drawItalicText` / `getStringWidth` 统一先 `Localization.localize(text)` |
| **本地化入口** | `Core.java` | 窗口标题本地化；`loadData` 由逐字节读改成 8 KB 块读 |
| **字体** | `Core.java`、`Font.java`、`FontCharacter.java`、`Theme.java`、`Main.java`、`Renderer.java` | 全部字号改用 `Font.loadFont("NotoSansSC-VF")`（`FONT_40 = FONT_20` 等），配 `src/fonts/NotoSansSC-VF.ttf` |
| **本地化数据** | `src/.../planner/localization/`（**未跟踪**） | `SimplifiedChineseLocalizer`（`docs/r0/port-audit.md` 计为 1,244 行的 `DROP`）等 |
| **物理（D1-B）** | `OverhaulSFR.java` | 辐照器分支补 null guard（注释自陈「R1 D1-B: same guard as the reflector branch above」，277/5000 例崩） |
| **物理（D1 追加）** | `OverhaulMSR.java` | 加热器配方 `instanceof NCPFLegacyRecipeElement` 三处（`docs/r1/d1-decision.md` §6） |

**结论**：fork 的 Java 侧改动 = **渲染层本地化入口 + 字体 + 两处物理 guard**，共 10 个已跟踪文件的修改
加一个未跟踪目录，**都没有提交**。`docs/refactoring-plan.md:16` 的判断与实测一致：

> 上游最后一个 commit 是「prepared project for DizzyEngine & Separate NCPF lib」，`nbproject` 已引用
> `../NCPF/dist/NCPF.jar`；而本 fork 直接改了 `Core`/`Renderer`/`Font`，并把所有字体换成单一 `NotoSansSC-VF`。

---

## 3. 「DizzyEngine / 独立 NCPF 库」对分叉边界意味着什么

### 3.1 上游已经在同一步里把两个包当外部模块

`nbproject/project.properties` 实测（`Select-String` 输出）：

```text
43: javac.classpath=\
47:     ${libs.DizzyEngine.classpath}:\
48:     ${reference.DizzyEngine.jar}:\
49:     ${reference.NCPF.jar}
58: javac.source=1.8
59: javac.target=1.8
90: project.DizzyEngine=../Dizzy-Engine
91: project.NCPF=../NCPF
92: reference.DizzyEngine.jar=${project.DizzyEngine}/dist/DizzyEngine.jar
93: reference.NCPF.jar=${project.NCPF}/dist/NCPF.jar
```

而这两个 jar **在本仓库不存在**：

```text
Test-Path ../NCPF/dist/NCPF.jar          -> False
Test-Path ../Dizzy-Engine/dist/DizzyEngine.jar -> False
```

即：上游在冻结点已经**声明**了「NCPF 与渲染层是仓库外的东西」，
只是这两个 `dist/*.jar` 还没有在本地路径上出现。`libraries/DizzyEngine/` 里预置了 92 个依赖 jar，
说明它下一步就是把那两个模块拆出去（`docs/rewrite-plan.md` §8.3 的原话：
「已经在把渲染层和 NCPF 抽成独立库」）。

代码层面还有一条同向证据（§2.1）：同一个提交把 `Module.java` 的自动注册换成
**classgraph 全包扫描**（`acceptPackages("net.ncplanner.plannerator")`），
这是「注册表要能跨库扫描」的前置动作，而不是功能变化。

### 3.2 三条分叉线

| 线 | 上游的状态（冻结点） | fork 的状态 | 冲突面 |
|---|---|---|---|
| **源码边界** | 准备把 `ncpf/`（56 文件 / 2,992 行）与 `graphics/`（16 文件 / 2,894 行）移出主仓库（`docs/refactoring-plan.md:45-46`） | 直接改了 `graphics/Font.java`、`FontCharacter.java`、`Renderer.java`（+ `Core`） | **最大**：改动落在即将搬走的包里 |
| **本地化边界** | **没有本地化机制**：`git grep -l "Localization" HEAD -- src` 无结果，`git ls-tree -r HEAD -- src/.../planner/localization/` 为空 | 整个 `planner/localization/` 包（3 文件，其中 `SimplifiedChineseLocalizer.java` 72.9 KB）是**新增且未跟踪**；翻译在渲染末端做**子串替换**（`Renderer` 5 处调用） | 大：任何渲染层重构都会打断它，且这个模型本身不可扩展（`docs/r0/findings.md` §5、§6） |
| **物理边界** | 源码里没有 D1-B 的辐照器 guard（5.5% 随机布局崩） | 已补 guard，且黄金数据建立在补过 guard 的基线上 | 小：两处独立 bug fix，与上游重构无耦合 |

### 3.3 对「回推能不能成功」的直接含义

因为 fork 的三个改动面**恰好落在上游即将搬走/重构的两个包上**，把 fork 的**补丁**整体回推是
最差的做法（上游一拆库就全部冲突）。可行的回推单位是**库级能力**：图表/文本本地化能力进
DizzyEngine，元素身份与 `matches()` 修复进 NCPF，物理 fix 作为两个独立 bug report。
这正是 `docs/refactoring-plan.md:517`（Phase 6 的 6.1 项）已经写下的建议：

> i18n 能力（LocaleManager / 资源加载 / 字体回退链 / 字形图集）**优先向上游 `DizzyEngine` 提 PR**，
> 本地只保留 `zh_CN.json` 与 `zh_CN.data.json`。

### 3.4 赞助者名单这件事（fork 会丢掉的东西）

`patrons.txt` 共 8 行（`tomdodd4598`、`Thalzamar`、`Not-So-Null`、`Overlord`、`jacobandgeckos`、
`ZathrusWriter`、`marf`、`Mstk`）。它不是死数据——上游的致谢界面**运行时**从上游仓库拉它：

```text
src/.../planner/gui/menu/MenuCredits.java:47:
  public static final String patronsLink =
    "https://raw.githubusercontent.com/ThizThizzyDizzy/nc-reactor-generator/overhaul/patrons.txt";
```

而 `MenuCredits.java` 在 `docs/r0/port-audit.md` 里被归为 **`DROP`（544 行）**，
新应用里没有任何 patron/credits 引用（`packages/app/src` 搜 `patron|credits` 无命中；
只有 `lang/*.messages.json` 里 R1.2 迁移进来的两条**未被使用**的 key
`error.unable.to.download.patrons.list.this.list.may.be.outdated` / `menu.press.escape.to.exit.credits`，
见 `docs/r3/README.md` §4 第 5 条 的 336 条 unused 清单）。

**含义**：分叉后「致谢/赞助者名单」这个功能不会存在，向上游回推时也**不要**把它当卖点；
反过来，上游若在意这条运行时拉取的链路，它自己会维护。**未验证**：上游对这个界面的处置意愿。

---

## 4. 三条路线：证据、建议与成本

### 4.1 路线 ① 彻底分叉（上游不追代码，只保数据互通）

**证据（仓库内）**：

- 事实上**已经在执行**：Java 树冻结在 HEAD + 未提交的 fork 补丁（§2.3），新实现是
  `packages/**` 的 TS（`docs/r3/README.md`），两者之间的契约是 NCPF 格式与黄金数据集；
- 互操作有硬证据：R2 的 36/36 fixture 读入、21/21 与冻结 Java 金样本结构+指纹全等
  （`docs/r2/fixture-coverage.md`），R1.4 的 38/38 往返指纹一致（`docs/r1/r1.4-ncpf-io.md` §5.2）；
- 计划自己也把①写成「**最简单，推荐作为默认**」（`docs/rewrite-plan.md` §8.3）。

**成本**：

- 不再跟进上游 5.0.5 之后的任何演进（含 DizzyEngine / NCPF 抽库完成后的一切 API 变化）；
- `nbproject/project.properties` 的 `${reference.NCPF.jar}` / `${reference.DizzyEngine.jar}`
  会长期指向不存在的文件（**现在已经是这样**），也就是说「用 NetBeans 打开就能编译」这条路已经断了
  —— `docs/refactoring-plan.md:93` 也把这条记为不一致（`build.gradle` 用 Java 21、
  `nbproject` 用 1.8 且引用两个不存在的 jar）；
- 风险等级沿用计划 §10 的 **R-6「上游继续演进」🟡 中**，缓解手段正是 D4 —— 而 D4 没做。

**数据风险**：低。NCPF 是**数据格式**，上游继续演进的是代码结构；只要格式没变，
老文件互通不受影响（`docs/rewrite-plan.md:465` 的风险表原话：「NCPF 是数据格式，上游演进影响有限」）。

### 4.2 路线 ② 回推能力（双赢路径）

**证据**：计划把它写成「收益大但协调成本高，取决于上游意愿」；`docs/refactoring-plan.md:286`、`:517` 给出
更具体的形式（i18n 进 DizzyEngine、fork 只留语言包）。可选的回推内容见 §5。

**成本**：

- 协调成本（上游是否接受 PR、是否已有别的实现、CLA/许可证要求）；
- **但仓库内已有一个便宜的中间形态**：先把可回推的修复做成本仓库内的**独立补丁 + 证据**
  （`docs/r0/findings.md` 的 §8/§10/§11 与 `docs/r1/d1-decision.md` 已经是这种证据），
  要不要提上去是后续动作，不影响现在的进度；
- 不要去回推 fork 的**裁剪决策**（丢 VR / 丢 DSSL / 丢 Discord / 换主题），那些是产品选择而非缺陷，
  提上去只会引发范围争论（依据：计划 §9.3 把它们写成裁剪项，`docs/r0/port-audit.md` §2 把它们写成 `DROP`）。

### 4.3 路线 ③ 采用上游的 TWD 多平台版

**仓库内能确定的**只有：它存在、是独立仓库、据 `docs/rewrite-plan.md` §8.3 与 §3.2 第 4 点
「已上架 Google Play」。**它的技术栈、完成度、是否支持多语言、能否导入 NCPF 老文件，
本仓库一个字都没有** —— 这正是 D4 那 1–2 天要回答的问题，也是 §6 的第一条未验证项。

**成本（现在再评估的机会成本）**：

- R1–R3 已经交付并且有可复现的验收：M1 闸门通过（四堆型黄金数据全过）、R2 36/36 读入 + 21/21 金样本全等、
  R3 应用可构建（1.57 MB，`docs/r3/README.md` §0）；
- 计划自己的总工期是 **19–31 周**（`docs/rewrite-plan-r1-r5.md` §0），R1–R3 是其中最大的一块；
- 因此选③的正确时机是 **R0 结束时**，不是现在。现在选③等于把已完成的 R1–R3 当沉没成本，
  再去承担一个本仓库**无法评估**的上游实现的风险。

### 4.4 三条路线对照

| | ① 彻底分叉 | ② 回推能力 | ③ 采用 TWD |
|---|---|---|---|
| 仓库内证据强度 | 强（已在执行 + 全套验收） | 中（修复点与证据俱全；意愿未知） | **无**（只有 URL 与「已上架」） |
| 立即成本 | 0（现状） | 协调时间（不定） | 高（重做/改写 R1–R4 的风险） |
| 长期成本 | 不跟进上游演进；NetBeans/Gradle 构建链已断 | 依赖上游意愿 | 依赖上游项目生命期 |
| 数据互通 | 保持（NCPF 是数据格式） | 保持 | **未知** |
| 计划的态度 | 「最简单，推荐作为默认」 | 「双赢」，需协调 | 「R0 阶段花 1–2 天评估」 |

### 4.5 建议

**① 彻底分叉为主 + ② 做「窄回推」，不做 ③。** 理由按证据强度排序：

1. ① 是现状，且它的验收已经写死在仓库里（R2 覆盖表、R1.4 指纹、四堆型黄金数据），
   换路线的唯一收益是「可能省掉 R1–R4」，而这件事本仓库无法证伪或证实（§6）；
2. ③ 的评估窗口已经过去：现在选它，是在 R1–R3 交付**之后**去赌一个未知实现；
3. ② 的价值集中且**与 fork 的补丁无关**（§3.3）：上游正在丢掉的恰好是
   「数据格式的导入健壮性」（5 个 bug）与「文本/图表本地化能力」；
4. 窄回推还有一个**本地就能拿到的收益**：把这些修复整理成带证据的独立补丁，
   本身就让「将来想合并上游或想被上游合并」这件事保持可行（`docs/refactoring-plan.md:561`）。

**成本一句话**：接受「不再跟进上游后续演进」，并接受 fork 的 Java 树永远停在
`717d51bb + 未提交补丁`；换来的是一条已经验收过的 TS 主线。

---

## 5. 「回推给上游」清单

排序依据：**它是否修复了上游自己也受害的缺陷** > **它是否是上游正在重构的那个包的能力** >
**它是否只是本项目的基础设施**。每条都给「证据」与「怎么贡献」。

| # | 内容 | 为什么上游会要 | 证据（仓库内） | 怎么贡献 |
|---|---|---|---|---|
| 1 | **`NCPFSettingsElement.matches()` 不自反**（`NCPFSettingsElement.java:186-210` 的 `Set` 分支按 `NCPFElementDefinition` 比较，实际是 `HashSet<NCPFElementStack>`） | 上游用户**保存含 Overhaul SFR 的工程后再打开必然 NPE**（配方索引写成 `-1` → `coolantRecipe` 为 null） | `docs/r0/findings.md` §8（含自反性实测 `x.matches(x) == false`）、传导路径 §8.4、对照实验 §8.5 | 提到 **NCPF** 库：issue + 最小 patch（按 `NCPFElementStack` 比较，或对不含数量的栈退化到 `definition.matches`）；本例随附一个能复现的 `.ncpf.json`（`datasets/fixtures/sfr-ncpf-save.ncpf.json`） |
| 2 | **辐照器分支 NPE**（`OverhaulSFR.java:1024` 漏了 1004 行同款 `if(b.template.moderator!=null)`） | 5.5%（277/5000）的随机 Overhaul SFR 布局让编辑器**直接崩**；补丁就是补齐姐妹分支 | `docs/r0/findings.md` §10、`docs/r1/d1-decision.md` §3（修复后 `editor crashed 0`，且 4,723 条既有用例逐字段不变） | 独立 PR（一行 guard）；顺带提交「4,723 条不变 / 277 条从崩到有值」的对照数字 |
| 3 | **MSR 加热器配方 `ClassCastException`**（配置里 32 个加热器配方声明为 `legacy_fluid`，而 `HeaterRecipe.getRecipeDefinition()` 无条件强转 `NCPFLegacyRecipeElement`） | 上游 MSR 数据在当前配置下**不可能算出来**（任何含激活加热器的用例都抛） | `docs/r1/d1-decision.md` §6（含配置复核命令与 3 处 `instanceof` 修法） | 两条路：改 `OverhaulMSR.calcStats` 的 3 处，或修配置生成器让加热器配方用 `legacy_recipe`；建议后者（根因是配置与模型不一致） |
| 4 | **Overhaul `.cfg` 导入死路径**（`OverhaulNCConfigReader:129-131` 把 `NCPFListElement` 交给只能收标量的构造器；本该用的 `getRecipeContainedAlternative()` 全代码库零调用） | **任何** NuclearCraft 2.x 的 overhaul `nuclearcraft.cfg` 都导不进来，且没有测试会发现 | `docs/r0/findings.md` §11（含 `canHaveAmount()` 与异常原文）、`docs/r0/compat-contract.md` §2.2 的告警框 | 提到**上游主仓库**：接上那行死代码（`OverhaulSFRConfigurationBuilder:188`、`OverhaulMSRConfigurationBuilder:194`、`MenuElementConfiguration:98` 三处同模式） |
| 5 | **Hellrage 写出用「剥离词缀的显示名」当标识符**（`HellrageWriter.java:63,112,126,140,154`）→ 读回时 `NonRecoveryHandler.recoverFallbackName` 匹配 `legacyNames` 失败 | 上游**自己写出的文件自己读不回**（实测 `Invalid fuel name: MOX-241!` / `Invalid block name: !`），真实 2020 存档同样中招 | `docs/r0/findings.md` §8.6、§12.3；`docs/r2/README.md` §3.2 第 5 条（TS 侧每条差异都用反向探针复现了 Java 的报错） | PR：写出走 `legacyNames` / 元素身份。**这条对上游自己的本地化也是前置条件**（一旦数据名被本地化，导出必坏） |
| 6 | **i18n 能力（不是 fork 的翻译表）**：稳定 ID + 命名空间 + 缺 key 整条回退 + 运行时切换 + 数据名身份键四段式 `<config>/<cfgType>/<type>\|<definition>` | 上游**完全没有本地化机制**（`git grep -l "Localization" HEAD -- src` 无结果），文案是硬编码英文；fork 现有的「渲染末端子串替换」是**坏模型**，不要回推它 | 四段式键的实测依据：`docs/r0/findings.md` §4（两段式 660 键里 29 个显示名冲突，四段式 0 冲突）；子串替换的失败样例：`docs/r0/findings.md` §5；落点建议：`docs/refactoring-plan.md:517` | 提到 **DizzyEngine**：LocaleManager / 资源加载 / 字体回退链 / 字形图集；**fork 只留 `lang/zh_CN*.json`**（这一条与 `docs/rewrite-plan-r1-r5.md` §2 D4 的「回推 i18n 与字体能力」一致） |
| 7 | **验收资产**：黄金数据集生成器、38/38 指纹往返、36 fixture 覆盖表、`--from-ncpf` 真实设计导入 | 上游**一个测试都没有**：`git ls-files 'test/*.java'` = 0，`test/` 里只有 23 个贴图源文件 | `docs/refactoring-plan.md:17`（TL;DR 表） | 提 `tools/golden/**`（Java harness，**不绑定 TS**）作为「可复现的基线生成器」；这是最容易让上游接受的一项，因为它对上游自己的重构也直接有用 |
| 8 | **（不建议回推）fork 的裁剪决策**：丢 VR / DSSL / Discord+Smivilization / 自定义主题、换 CSS 变量 | 这些是产品选择而非缺陷；上游可能仍要这些功能 | 计划 §9.3、`docs/r0/port-audit.md` §2（`DROP` 354 文件 / 35,274 行） | 不提。若要提，只提「这些包占了发行包体积」的**度量**，不提删除决定 |

**贡献顺序建议**：先 1、2、3（三个纯 bug，证据最硬、争议最小），再 4、5（导入路径），
然后 6、7（能力与基础设施）。8 永远不提。

---

## 6. 未验证（只有看上游今天才能回答的）

**以下每一条，本文件都没有答案**，因为任务约束是「只用本仓库证据、不查网」；
它们正是 D4 那 1–2 天复查应该产出的内容：

1. **上游今天是什么状态**：`overhaul` 分支在 `717d51bb`（2026-06-12）之后又发生了什么；
   `DizzyEngine` 与独立 `NCPF` 库是否已经抽出、是否发布、API 是否稳定。
2. **`nc-planner-twd` 的技术栈与完成度**：是否已是现代栈、是否支持多语言、
   能否导入 NCPF / LegacyNCPF / Hellrage 老文件、是否已有中文。
   这是路线③**唯一**的决策依据，本仓库只知道它的 URL（`README.md:6`）与「已上架 Google Play」
   （`docs/rewrite-plan.md` §3.2 第 4 点、§8.3）。
3. **上游 5.0.5 之后是否还有发布**：`versions.txt` 是快照，**不能**当作「上游停在 5.0.5」的证据。
4. **上游是否已经修了 §5 里的 5 个 bug**：本仓库的 5 个 bug 全部基于冻结版实测
   （`docs/r0/findings.md`、`docs/r1/d1-decision.md`），上游之后是否修过无从判断。
5. **上游是否愿意接受回推，以及贡献流程**：LICENSE 之外的要求（CLA、代码风格、是否接受 PR）、
   上游对「i18n 进 DizzyEngine」的态度。`docs/refactoring-plan.md:517` 只是本项目的**建议**。
6. **`patrons.txt` 的运行时拉取链路在上游是否还在用**：本仓库只能证明
   `MenuCredits.java:47` 曾经这么做，以及本 fork 把它 `DROP` 了。
7. **上游的构建链现状**：`nbproject` 引用 `../NCPF/dist/NCPF.jar` 与 `../Dizzy-Engine/dist/DizzyEngine.jar`
   在**本仓库**不存在（实测 `Test-Path` 为 `False`），但上游那两个 sibling 目录**可能**存在
   —— 本仓库无法判断 `nbproject` 在上游是否是可用的。
8. **路线③的成本估算**：本文件给出的「R1–R3 已交付」是仓库内事实，
   但「基于 TWD 做中文化要多少时间」无法从本仓库推算。

---

## 7. 本文用到的命令（可复现）

```powershell
# 冻结点 / Java 树历史
git log --oneline -n 5
git log -1 --format="%H %ad %s" --date=short -- src
git log -1 --format="%H %ad %s" --date=short
git rev-list --count HEAD
git tag                     # java-frozen-c79c557f（2026-10，java-exit-plan §P4 建立并推送）
git branch -a               # * overhaul / remotes/origin/overhaul

# ⚠️ 下面这些读的是 Java 树，工作区里已经没有了（§P3/P4）。
#    先取回冻结树，否则会报 "pathspec ... did not match any file(s) known to git"：
git checkout java-frozen-c79c557f -- src libraries nbproject build.gradle build.xml tools/golden
git show --stat --oneline HEAD
git show --stat --oneline 17a7e2ca
git show 17a7e2ca -- src/net/ncplanner/plannerator/planner/module/Module.java
git show --stat 17a7e2ca -- src nbproject build.gradle build.xml

# fork 的未提交改动（分叉边界）—— 需在上面的 checkout 之后跑
git status --short
git diff --stat
git diff -- src/net/ncplanner/plannerator/multiblock/overhaul/fissionsfr/OverhaulSFR.java

# 上游已把两个包当外部模块
Select-String -Path nbproject/project.properties -Pattern "NCPF|Dizzy|javac.source|javac.target"
Test-Path ../NCPF/dist/NCPF.jar
Test-Path ../Dizzy-Engine/dist/DizzyEngine.jar
(Get-ChildItem libraries/DizzyEngine -File | Measure-Object).Count   # 92

# 上游没有本地化机制（都是空输出）
git ls-tree -r --name-only HEAD -- src/net/ncplanner/plannerator/planner/localization/
git grep -l "Localization" HEAD -- src

# D4 的产物（不存在）
Get-ChildItem docs
Get-ChildItem -Recurse docs -Filter "*upstream*"

# 赞助者名单的运行时来源
Select-String -Path (Get-ChildItem -Recurse src -Filter *.java | Select-Object -ExpandProperty FullName) -Pattern "patrons"
```

---

## 8. 未验证 / 已知限制（本文自身的）

1. **本文不是 D4 复查**（§1），只是「用仓库证据能确定的部分」；D4 的原问题（要不要改用上游 TWD 版）
   **仍然未决**，见 §6。
2. **所有「上游会/不会接受」的判断都是本项目一侧的推断**，没有上游的任何回复作为依据。
3. **`versions.txt` 的时效性未知**：它只能证明到 `5.0.5` 为止存在过的发布，不能证明上游现状。
4. **`docs/refactoring-plan.md` 的引用是二手**：本文在 §2.3、§3.3、§4.5、§5 引用了它的结论，
   但那些结论本身是同一批作者在同一仓库里基于同一份源码写下的；本文对它们做了独立复核的地方
   （`nbproject` 引用、两个 jar 不存在、`libraries/DizzyEngine` 的 92 个文件、`git diff` 的分类）
   已单独标注为实测。
5. **没有评估许可证/署名层面的回推障碍**：本仓库根有 `LICENSE.md`，但「fork 的改动以什么条款回推、
   署名怎么写」本文没有查（属于 §6 第 5 条）。
