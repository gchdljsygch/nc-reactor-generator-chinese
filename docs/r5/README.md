# R5 状态报告 — 中文化、第三语言、离线与发布

> 计划：`docs/rewrite-plan-r1-r5.md` §8（R5.1–R5.6）、§11.3（CI 门禁）。
> 本文件是 **R5 的唯一状态入口**：每项任务做了什么、证据在哪、什么没做。
> 所有"通过"都可以用文中的命令复现；没有实测支撑的项一律标 `未验证`。
> 各子任务的完整细节在 `docs/r5/` 下的专题文档里，本文件是索引 + 判定。

---

## 0. 一句话结论

**R5 交付。** 中文元素名从 R0 迁移的 26 条补到 **732/732 = 100%**；
**第三种语言（`ja_JP`）以`零行 TypeScript` 的方式加进来**（只新增一个 JSON 文件
+ 一行 `loadPack()`），这正是 §8 要证明的那件事；PWA 离线可用、发布流水线就绪。
**没有任何新增运行时依赖**，`pnpm-lock.yaml` 的 SHA256 在整轮中未变。

| 指标 | 数值 |
|---|---:|
| `lang/zh_CN.elements.json` | **732 条**（原 26 条 → 覆盖 **100.00%**） |
| 元素覆盖（独立复算） | **732 / 732 = 100.0000%**，未覆盖 `[]` |
| 新增语言 `ja_JP` | **1 个 JSON**，改动 TS **1 行 import + 1 行 `loadPack()`** |
| `ja_JP` 已翻译 key | **67 / 148 = 45.3%**（其余保留英文，**如实报告，不假装 100%**） |
| 全仓库测试 | **554 passed / 2 skipped** |
| 离线：构建门禁 | **18/18** 通过 |
| 新增运行时依赖 | **0** |

```powershell
pnpm install
pnpm verify:full      # no-java + typecheck + lint + 全量测试 + i18n + 元素包 + 语言包 + 构建 + 体积 + 仓库体积 + PWA
```

> **Java 退出已完成（`docs/java-exit-plan.md` P0–P5，2026-10）**：本文件写于 Java 树仍在
> 仓库里的时点，文中的 Java 侧证据命令（`golden.ps1` / `format-golden.ps1` 等）现在需要先
> 取回冻结树：`git checkout java-frozen-c79c557f -- src tools/golden libraries nbproject build.gradle build.xml`。
> R5 的交付物（语言包、PWA、发布流水线）**全部与新仓库形态兼容**，`pnpm verify:full` 仍然全绿；
> 新增的两道门禁是 `pnpm check:no-java` 与 `pnpm size:repo`（§P5）。

---

## 1. 任务清单

| # | 任务 | 状态 | 产物 / 证据 |
|---|---|---|---|
| R5.1 | 中文元素名补全（覆盖率 > 98%） | ✅ **100.00%** | `lang/zh_CN.elements.json`（732 条）+ `tools/ts/elements-pack.mjs`；`pnpm i18n:elements` / `:check`；术语裁决 15 条见 `docs/r5/glossary.md` |
| R5.2 | 术语表 + 第三语言（证明"零代码新增语言"） | ✅ | `docs/r5/glossary.md`（6 张表，218 行）+ `lang/ja_JP.app.json`（148 keys）+ `tools/ts/make-locale.mjs` |
| R5.3 | PWA / 离线 | ✅（未在真实浏览器验证） | `packages/app/public/{sw.js,manifest.webmanifest,icons/**}`、`packages/app/src/pwa.ts`、`tools/ts/pwa-build-check.mjs`（18 断言）、`docs/r5/offline.md` |
| R5.4 | 数据迁移指引 | ✅ | `docs/r5/migration.md`（31.9 KB）；`tools/ts/migrate-settings.mjs` 实跑命令与输出已粘入 |
| R5.5 | 发布流水线（CI → 静态站点 + 可选桌面壳） | ⚠️ 静态站点就绪，**桌面壳未做** | `.github/workflows/release.yml`（Pages）+ `docs/r5/release.md`；Tauri 明确记为未做 |
| R5.6 | 上游关系 | ✅ | `docs/r5/upstream.md`（30.0 KB）；结论：**彻底分叉为主 + 窄回推（8 项）** |

---

## 2. 验收标准与判定

### 2.1 R5.1：元素名覆盖率

计划要求 **> 98%**，实际 **100.00%**。之所以能到 100%：

```text
$ node tools/ts/elements-pack.mjs --report
  覆盖率
    身份键：732 / 732 = 100.00%
    数据集行：948 / 948 = 100.00%
    缺失键：0，冲突已裁决：15
elements-pack --report OK（未写文件）
```

数据集 948 行里只有 **501 个不同的 display**，五份分片恰好覆盖全部 501 个
（0 个 extra、0 个缺失）；948 行折叠成 **732 个唯一身份键**（216 行是完全重复行）。
所以不存在"无 display / 无译文"的残留，**无需编造条目**。

**独立复算**（不经脚本，用两种键口径交叉校验）：`732/732 = 100.0000%`，未覆盖 `[]`，
孤儿键 `0` —— 与脚本自报一致。原 26 条权威值与
`lang/zh_CN.elements.draft.json`（trim 后）**逐条比对 26/26 相同**。

**术语裁决 15 条**（完整理由见 `docs/r5/glossary.md`），其中最具代表性的一条：

| 显示名 | 采用 | 弃用 | 理由 |
|---|---|---|---|
| `Fluorite` | 氟石 | 萤石 | 「萤石」已被 `Glowstone` 占用（权威包 + 5 分片一致），否则两种物质同名 |
| `Coolant` | 冷却剂 | 冷却液 | legacy（12 处）与 `messages`（10 处）一致用「冷却剂」 |
| `Reactor Cell` | 燃料单元 | 反应堆单元 | 已发布包该键为「燃料单元」，数据集别名正是 `Fuel Cell`；「反应堆单元」在全部 lang 中出现 **0 次** |
| `Protactinium-Enriched Thorium Dust` | 富集镤钍粉末 | 富镤钍粉末 | 「富集」是核燃料语境 `enriched` 的固定动词，与包内 `Depleted => 贫化` 对仗 |

脚本每次运行都会断言**被否决写法在成品中 0 残留**（`survivingForbidden = 0`）。

### 2.2 R5.2：新增一种语言 = **零代码**

这是 §8 里最容易被做成口号的一条，所以用可执行的证据来钉：

```text
$ node tools/ts/make-locale.mjs
wrote lang\ja_JP.app.json
  keys 148 · translated 67 · English kept 81 · coverage 45.3%

$ node tools/ts/make-locale.mjs --check
make-locale --check OK: lang\ja_JP.app.json matches (148 keys, 67 translated, 45.3%)
```

**为加入这门语言改动的 TypeScript 总量**（`packages/app/src/main.ts`）：

```ts
import jaApp from '../../../lang/ja_JP.app.json';   // +1 行
...
    loadPack(jaApp),                                 // +1 行
```

**没有任何别的地方改动**：`AppI18n`、`LocaleManager`、`MessageBundle`、
语言菜单（`this.i18n.options()`）全部自动发现新 locale —— 语言菜单里已经出现
「日本語」，无需注册表、无需 union type、无需 switch。

**诚实的部分**：148 个 key 里 67 个（45.3%）是**真的翻译**，其余 81 个保留
canonical 英文以保证 key 集合完整（§11.3 的门禁要求 key **存在**，不要求文笔）。
`meta.untranslated` 与 `meta.coverage` 把这个数字写进文件本身——
**一个假的 100% 比一个诚实的 45.3% 更糟**。

### 2.3 i18n 门禁

```text
$ node tools/ts/i18n-audit-app.mjs
  en_US: 429 keys
  zh_CN: 1530 keys
i18n audit passed
```

R4 新增的 18 个生成器 key 在 `en_US` 与 `zh_CN` **同时**补齐；`ja_JP` 由生成器产出，
自动满足"每门语言定义相同 key 集"。

### 2.4 R5.3：离线可用

选择**手写 `public/sw.js`**（方案 a）而非构建期重写（方案 b）：`dist/sw.js` 与源码
**逐字节相同**，没有构建顺序耦合；哈希文件名靠 `activate` 时**自发现**
（fetch 构建后的 `index.html`、读其中的 `<script src>` / `<link href>`），
所以没有任何硬编码，且**访问一次后即离线可用**。

```text
$ pnpm pwa:check
  18/18 checks passed
pwa-build-check passed
```

门禁包含两条**负向对照**（篡改 `sw.js`、去掉 `theme-color` → exit 1），
以及"`dist/sw.js` 是 `public/sw.js` 的逐字节副本"。

**子任务期间发现并修复两个真 bug**（已写入 `docs/r5/offline.md` §4.6，各有回归测试）：

1. `sw.js` 在 async 回调里调 `event.waitUntil()` → 触发规范的 `InvalidStateError`
   （事件已不在派发中），后台刷新会被静默杀掉。改为**同步**调用。
2. `import.meta.env.PROD` 必须是**字面成员表达式**：Vite 会把裸 `import.meta.env`
   替换成 `undefined`，于是 `const env = import.meta.env; env.PROD` 会是一条
   **永远不会成立的注册分支**，而本地测试抓不到。现在构建门禁断言产物里
   **没有** `import.meta.env` 残留。

`--base=./` 是必须的：项目型 Pages 站点位于 `/<repo>/`，根绝对路径的
`/assets/` 与 `/sw.js` 会 404；相对路径同时让 SW 的作用域自然落在部署根目录，
无需 `Service-Worker-Allowed` 头。

### 2.5 R5.4：迁移指引

`docs/r5/migration.md`（31.9 KB）里的命令与输出都是**实跑**的：

```text
$ node --experimental-transform-types tools/ts/migrate-settings.mjs settings.dat $env:TEMP\out.json --language=zh_CN
note: settings.dat: the legacy file has no "language" key (the fork hardcoded its localizer), so the new document uses "zh_CN"
note: settings.dat: "imageExportCasingParts" is written by Core.java:363 but never read by MenuInit; the stored value is kept and the legacy app always started from true
note: settings.dat: cursor.xOff=0, cursor.yOff=0; MenuInit.java:219-220 read them with the legacy default 1
migrated settings.dat -> C:\Users\q1470\AppData\Local\Temp\out.json (language zh_CN, 3 notes)
```

**一条重要的新发现**（已写入 §4.4）：迁移产物与 `packages/app/src/settings.ts` 的
`AppSettings` **形状不同**。用应用真实的 `normalizeSettings` 处理迁移产物，
**只有 `language` 带得过来**：`"theme": "Light"` 被拒后回落 `dark`，
`modules/overlays/ui/export/cursor/pins/extras` **全部丢弃**。文档给出了完整的
逐键对照与影响。

### 2.6 R5.5：发布流水线

`.github/workflows/release.yml`：构建 → 跑门禁 → 部署到 GitHub Pages 静态站点。
需要手动做的**一次性仓库设置**已在工作流注释里写明：
`Settings ▸ Pages ▸ Source = "GitHub Actions"`。

**桌面壳（Tauri）明确未做**，`docs/r5/release.md` 里直说了，没有假装。

### 2.7 R5.6：上游关系

`docs/r5/upstream.md`（30.0 KB），基于仓库内可查证的证据：

- 冻结点 `HEAD = 717d51bb`（2026-06-12，纯 jar 变动，72 files 0/0）；
- Java 源码最后变动 `17a7e2ca`（同日）——**它不只是换库**：新增
  `libraries/DizzyEngine/**`（92 jar）、改 `nbproject/**`、并把
  `planner/module/Module.java`（87 行）从 `org.reflections` 换成一次 classgraph 扫描；
- 分支 `overhaul`、1090 commits、**无 tag**；fork 的 Java 改动**全部未提交**；
- **上游 HEAD 完全没有本地化机制**（`git grep -l "Localization" HEAD -- src` 与
  `git ls-tree HEAD -- …/localization/` 都是空输出）。

结论：**① 彻底分叉为主 + ② 窄回推（8 项，按上游价值排序）**，
**不选 ③（基于 nc-planner-twd）**——其评估窗口已过，且仓库内对 TWD 一无所知。

---

## 3. 交付的其它文档

| 文件 | 内容 |
|---|---|
| `docs/r5/glossary.md` | 术语表（218 行，6 组 `English \| 中文 \| 备注/依据`），含"待确认"清单 |
| `docs/r5/offline.md` | 离线方案、SW 设计取舍、两个 bug 的完整分析、18 条门禁清单 |
| `docs/r5/release.md` | 发布流程、Pages 设置、**桌面壳未做**的说明 |
| `docs/r5/migration.md` | 迁移指引（含实跑命令、逐键对照、9 条未验证） |
| `docs/r5/upstream.md` | 上游关系与三种路线评估 |

---

## 4. 未验证（明确清单）

### 4.1 R5.1 / 术语

1. **13 条 underhaul 熔融流体的短名 + `blockFissionModerator`**。已发布包是
   「铜/铁/红石/…」「石墨」，而数据集 canonical display 是 `Molten Copper`
   `Moderator`，分片是「熔融铜」「慢化剂」。按"已发布包权威"保留了短名，
   **无法验证模组 UI 实际显示哪一层**。这 14 条每次运行都会打印。
   （根因是 R0 迁移的子串机制：`legacy_fluid|copper = 铜` 来自该元素的 legacy
   别名短名，不是它自己的 display。改法：手改包后重跑 `--check`。）
2. **`Carobbiite`**：分片 5 条一致「卡洛比石」，legacy 单条「卡罗比石」。
   两写法都是音译，分片内部无分歧故未改动，**需模组熟悉者定夺**。
3. **`Enriched` 的通用译法**：legacy 只有 `Enriched => 浓缩`，分片用「富集」，
   采「富集」。**Java 版其它 enriched 物品的实际用词未验证**。
4. **`app` 层与元素包术语不一致**：`lang/zh_CN.app.json` 的
   `meta.glossary.Coolant = 冷却液`，而 elements / legacy / messages 全用「冷却剂」。
   已记录在 `docs/r5/glossary.md` 待确认清单。

### 4.2 R5.2

5. **`ja_JP` 的 81 个未翻译 key** 是**有意为之**的：它们是"key 存在但内容仍为英文"。
   这**不是**一份可发布的日文语言包，而是"零代码新增语言"这个**机制**的证明。
   日文的实际质量**未经验证**（也没有日语母语者审阅）。
6. **复数形式**：`meta.pluralKeys` 里登记了 2 条复数 key，但
   **`loadPack()` 是否真的用得上它们未验证**——日文无复数区分，
   而仓库的复数测试只覆盖 `en_US` / `zh_CN`。

### 4.3 R5.3（离线）

7. **真实浏览器里的 install / activate / fetch 行为**、
   **"访问一次后离线可用"在真机上是否成立**、**iOS Safari 的差异**、
   **Actions 是否真的绿、Pages 站点是否真的在线** —— **全部未验证**。
   仓库没有浏览器端自动化测试；18 条门禁只检查**构建产物**。
8. **`ci.yml` 尚未包含 `pnpm pwa:check`**。一行改动，属该文件的工作范围。

### 4.4 R5.4（迁移）

9. **所有界面操作**（打开/保存/导出/设置导入/语言切换/PNG/拖放）**未实测** ——
   仓库无浏览器自动化测试，只对**命令与库函数**给了实测。
10. **LegacyNCPF v3/4/6/7/9 无样本**，九个老 reader 全是 `count: 0`，
    设计解码路径**从未被数据跑过**。
11. **Hellrage MSR v1–v6 与 SFR v1–v4 未移植**；Underhaul Hellrage v1 无 fixture。
12. **导出不合并 addon 元素**（`write.ts:150-154`）。
13. **文件里已有的 `coolant_recipe: -1` 无法恢复**。
14. **Hellrage 写出对用户不可达**：实现存在，但**没有从 `formats/index.ts` 导出**，
    也没有 UI 入口。
15. **overhaul `.cfg` 只有 777 元素一个数字**，无逐字段对照。
16. **PNG 目视一致无法 CI 判定**。

### 4.5 R5.6（上游）

17. **上游今天的状态**（DizzyEngine / 独立 NCPF 是否已抽出或发布）；
    **`nc-planner-twd` 的技术栈与完成度**（路线 ③ 的唯一依据）；
    **上游 5.0.5 之后是否还有发布**；**上游是否已修那 5 个 bug**；
    **上游是否接受回推与贡献流程**；**patrons 运行时拉取链路是否仍在用**；
    **上游 sibling 目录是否存在**（本仓库无法判断 `nbproject` 在上游是否可用）；
    **基于 TWD 做中文化的成本**。
18. `docs/r5/upstream.md` **不是 D4 复查本体**（计划里的 1–2 天上游复查**没有做**，
    仓库里也没有产物）；文中"上游会/不会接受"均为**本项目一侧的推断**；
    **未评估许可证/署名层面的回推障碍**。

---

## 5. 文件清单

| 文件 | 作用 |
|---|---|
| `lang/zh_CN.elements.json` | 732 条元素名（R5.1） |
| `lang/ja_JP.app.json` | 第三语言（R5.2），由 `make-locale.mjs` 生成 |
| `tools/ts/elements-pack.mjs` | 元素包生成 + 冲突裁决 + `--check` |
| `tools/ts/make-locale.mjs` | 语言包生成 + `--check` |
| `tools/ts/make-icons.mjs` | 零依赖确定性 PNG 图标生成 |
| `tools/ts/pwa-build-check.mjs` | 18 条 PWA 构建门禁 |
| `packages/app/public/sw.js` | 手写 Service Worker（逐字节进产物） |
| `packages/app/public/manifest.webmanifest` + `icons/**` | PWA 清单与图标 |
| `packages/app/src/pwa.ts` | 缓存路由契约 + 永不抛错的 `installOfflineSupport()` |
| `packages/app/test/pwa.test.ts` | 36 项无浏览器测试 |
| `.github/workflows/release.yml` | Pages 静态部署 |
| `docs/r5/{glossary,offline,release,migration,upstream}.md` | R5 五份专题文档 |
| `package.json` | 新增 `i18n:elements(:check)`、`i18n:locale(:check)`、`icons`、`pwa:check`；`verify:full` 串起全部门禁 |
