# R3 状态报告 — Web 应用（界面层）

> 计划：`docs/rewrite-plan-r1-r5.md` §6（R3.1–R3.10）、§11.3（CI 门禁）。
> 本文件是 **R3 的唯一状态入口**：每项任务做了什么、证据在哪、什么没做。
> 所有"通过"都可以用文中的命令复现；没有实测支撑的项一律标 `未验证`。

---

## 0. 一句话结论

**R3 交付。** 应用是 `packages/app` 下的一个 Vite 单页应用：R3.1 骨架 + CSS 变量主题、
R3.2 语言切换与持久化、R3.3 菜单/文件读写、R3.4 配置编辑器、R3.5 方块网格编辑器、
R3.6 2D 视图 + 部件清单、R3.7 WebGL 3D 视图、R3.8 统计面板（全部文案走 i18n key）。
**没有引入任何运行时依赖**：没有 UI 框架、没有路由库、没有 i18n 库。

| 指标 | 数值 |
|---|---:|
| `packages/app` 测试 | **101 passed**（7 个文件） |
| 应用源码（不含测试） | 4,413 行 TS + 487 行 CSS |
| **主题 CSS（R3.1 要求 < 500 行）** | **487 行**（替代 Java 的 5,107 行 theme 代码） |
| 构建产物（不含数据集） | **1.57 MB**（门禁 15 MB） |
| 构建产物（含内联配置数据集） | 2.78 MB |

```powershell
pnpm install
pnpm verify          # typecheck + lint + 全量测试
pnpm build:app       # Vite 生产构建
pnpm size            # §11.3 构建体积门禁
pnpm i18n:audit      # §11.3 未翻译 key = 0
```

---

## 1. 任务清单

| # | 任务 | 状态 | 产物 / 证据 |
|---|---|---|---|
| R3.1 | 应用骨架、路由、布局；主题用 CSS 变量 | ✅ | `index.html` + `src/main.ts`（启动顺序显式：settings → 语言包 → 配置 → 外壳）、`src/ui/app.ts`（菜单/工具栏/三栏布局）、`src/styles/theme.css` **487 行** |
| R3.2 | 语言切换 UI + 持久化 | ✅ | `src/settings.ts`（JSON + `localStorage`，逐字段校验）、`src/i18n.ts`（`setLocale` 落盘 + 通知）、`ui/app.ts` 的 Settings 菜单；`test/bootstrap.test.ts`：运行时切换、刷新后保持、`<html lang>` 与 `document.title` 同步 |
| R3.3 | 菜单 / 对话框 / 文件选择 / 拖放（`.ncpf` / `.json` / `.cfg`） | ✅ | `ui/dom.ts`（`dialog` / `pickTextFile` / `downloadText` / `downloadBlob`）、`model/open.ts` → R2 的 `readAnyProjectText`（**`.cfg` 因此天然可用**，且 R2 让全部 36 个 fixture 都可读）、`bindDropTarget`；菜单 File/Edit/View/Settings/Help |
| R3.4 | 配置编辑器（等价 `MenuElementConfiguration`） | ✅ | `model/document.ts`（palette / `scalarOptions` / `applyGrid`）、`ui/app.ts` 的 `openElementEditor`（模块字段编辑）+ 配方/标量选择器 |
| R3.5 | 方块网格编辑器：绘制/擦除/选择/复制粘贴/撤销重做/对称 | ✅ | `model/grid.ts`（370 行）、`model/editor.ts`（350 行，快照历史 100 步）；`test/grid.test.ts` + `test/editor.test.ts`（12 项，含剪贴板计数） |
| R3.6 | 2D 俯视视图 + 部件清单 | ✅ | `ui/grid2d.ts`（canvas 绘制 + 选择框 + 悬停）、`partsCounts`；`test/partsList.test.ts`：**24 个黄金设计逐块计数与 Java 数据一致**，且外壳环不计入 |
| R3.7 | 3D 视图（旋转/缩放/剖切/外壳，WebGL） | ✅ | `ui/view3d.ts`（355 行，WebGL1，轨道拖拽 + 滚轮 + 剖切 + 仅外壳，`MAX_CUBES=60000`）；**无 GL 文本**，见 R3.9 |
| R3.8 | 统计面板 / 工具提示：全部走 ICU key | ✅ | `ui/app.ts` 的 `renderStats` 用 `stat.<字段>`、其它文案全走 key；`pnpm lint`（核心包裸字符串 0）+ `pnpm i18n:audit`（未翻译 key 0；另有 336 条 R1.2 迁移进来的"未使用"key 作为 burn-down 清单，见 §4） |
| R3.9 | 字体：按 locale 选主字体 + 回退链 + 字形图集 | ⚠️ 以另一种方式满足 | 见 §3.2：**GL 里没有文字**，所以"4,000 汉字下 GL 纹理数 O(1)"平凡成立；文本一律 DOM 文本 + CSS 回退链（`--font-ui` 含 `Noto Sans SC`），`unicode-range` 完全交给浏览器 |
| R3.10 | 自动更新 / 版本检查 | ⛔ 未做 | 计划该项验收为"—"；且**没有更新服务器**可查。见 §4 |
| — | **路由** | ⛔ 不做（决策） | 应用只有一条"路由"（外壳本身）。加路由库要为一个视图引入依赖，与 §6 的"用新栈重写、代码量小得多"冲突。见 §4 |

---

## 2. 验收标准与判定

### 2.1 统计面板必须来自唯一内核（铁律 1）

`test/simulate.test.ts` 把 **24 个黄金 SFR 设计**从数据集读成编辑器网格再仿真，
断言统计量与冻结版 Java 引擎**逐字段一致**（`compareStats`），且 `warnings === []`。
这是"编辑器坐标系 / 调色板索引 / 配方编码 / 物理内核"四者对齐的最强证据——
任何一处错位，数字都不会对上。

### 2.2 语言与文案（R3.2 / R3.8）

- 运行时切换：`test/bootstrap.test.ts` 断言切到 `zh_CN` 后**菜单与面板同步变化**，
  且**元素数据名**也变（`燃料单元`）——这条同时钉住了四段式身份键
  `<config>/<cfgType>/<type>|<definition>`（本次修复了一个真实缺陷，见 §3.1）；
- 刷新后保持：`SettingsStore` 落盘，测试断言 store 的最终状态；
- 全 key：`pnpm i18n:audit` 静态扫描 `packages/app/src/**` 的 `t('…')` 字面量，
  与 `lang/*.json` 逐 locale 比对，**缺任何一条即失败**（`--json` 可看明细）。

### 2.3 应用真的能启动并渲染（不是"能编译"）

`test/bootstrap.test.ts` 自带一个最小 DOM 桩（`document` / `createElement` / `append` /
`classList` / `addEventListener` / `canvas.getContext() → null`），走完整启动链路：
SettingsStore → AppI18n → 内联的 `nuclearcraft.ncpf.json` → `PlannerApp`，
断言渲染出 5 个菜单、配置下拉（含 `Overhaul SFR Configuration`）、
>50 个调色板条目、部件清单/统计面板标题，且**渲染文本里不出现任何 `panel.` / `menu.` 前缀**
（缺 key 会原样返回 key，铁律 3）。

### 2.4 构建门禁（§11.3）

| 检查 | 落点 | 结果 |
|---|---|---|
| 应用可构建 | `pnpm build:app` | ✅ 79 modules，769 ms |
| 静态资源（不含数据集）< 15 MB | `pnpm size` | 1.57 MB |
| 未翻译 key = 0 | `pnpm i18n:audit` | ✅ |
| 核心包裸字符串 0 | `pnpm lint` | ✅ |

---

## 3. 关键证据

### 3.1 本次抓到的两个真实缺陷（都有回归测试）

1. **元素数据名从来不本地化**：`ui/app.ts` 与 `model/document.ts` 各自**手拼**四段式键，
   首段用的是配置自身名（`Overhaul SFR Configuration`）而不是项目名（`NuclearCraft`），
   且漏掉 `type|` 前缀 —— 与 `lang/zh_CN.elements.json` 的键格式不符，
   于是中文界面里所有方块名都退回英文规范名。
   修法：`ConfigurationView.projectName`（Java `Configuration.getName()`）+ 调用
   `@ncplanner/i18n` 的 `dataNameKey`（即 `@ncplanner/ncpf` 的 `elementIdentityKey`），
   不再有第二份实现。回归断言：切到中文后调色板出现 `燃料单元`。
2. **`countParts` 是 `model/grid.ts` 的 `partsCounts` 的逐行拷贝**（两处实现）。
   已删除 UI 侧的那一份，面板与 PNG 导出共用同一个函数。

### 3.2 R3.9 —— 为什么"另一种方式"是成立的，而不是绕过

Java 侧的问题是**把文字画进 GL**，于是需要字形图集，17 MB 单字体 + 一字符一纹理。
新栈的 3D 视图**只画无纹理的立方体**（`ui/view3d.ts` 里没有任何 `drawText`），
文字一律是 DOM 文本：

- GL 纹理数 = 立方体颜色属性 + 深度缓冲，**与字符数无关** → "4,000 汉字下 O(1)"平凡成立；
- 按 locale 的主字体 + 回退链由 CSS 变量 `--font-ui` 给出
  （`system-ui, -apple-system, "Segoe UI", "Noto Sans SC", sans-serif`），
  `unicode-range` 子集化由浏览器完成，**不需要下载 CJK 字体**（仓库里那份
  `src/fonts/NotoSansSC-VF.ttf` 是 Java 侧留下的，若内联进 Web 会直接吃掉构建体积门禁）。

**未验证**：不同浏览器/系统下的实际字形覆盖（需要真机目视）。

### 3.3 2D / 3D 视图与 PNG 导出

- 2D：`ui/grid2d.ts` 每层一张 canvas，`x→z`、`y→行`，外壳画成环（格式里外壳是隐式的，
  不画出来用户分不清内部格与外壳格）。
- 3D：`ui/view3d.ts` WebGL1，`MAX_CUBES` 上限 + 剖切 + 仅外壳；无 WebGL 时降级为一行提示。
- PNG（R2.12）：`model/imageExport.ts` 是**纯布局**（移植 `PNGWriter:36-90` +
  `:130-156` 的绘制循环），`ui/imageExport.ts` 只负责画；`test/imageExport.test.ts`
  用可替换的字体度量把 `multisPerRow` / 行列 / 包围盒 / 部件过滤全部钉住。

---

## 4. 未完成项与已知限制（诚实清单）

1. **R3.10 自动更新 / 版本检查未做。** 计划的验收栏是"—"（没有可判定的验收），
   且本仓库没有发布渠道或更新服务可查；`settings.version` 只用于设置文档自身的版本。
2. **路由是一个明确的不做（决策）**：应用只有一条路由。计划 §6 的意图是"用新栈重写、
   代码量小得多"，引入路由库与这条意图相反。
3. **R3.9 的"目视一致"类验收无法在 CI 判定**：2D/3D/PNG 的实际像素需要人在浏览器里看。
   CI 能判的是布局算术（已钉住）与构建体积。
4. **`lang/zh_CN.elements.json` 只有 26 条 draft**：因此中文界面里绝大多数方块名仍是英文
   规范名。这不是 R3 的缺陷（键与查找路径已由测试钉住），而是 R5.1 的待办：
   把 948 个元素的名称补全。`pnpm i18n:audit` 已能报出"UI 用了但 pack 没有"的 key。
5. **`pnpm i18n:audit` 的"未使用"清单还有 336 条**（`--json` 可看全量）：绝大多数是 R1.2
   从 Java 翻译表迁移进来的旧 GUI 文案（`progress.*` / `tooltip.*` / `menu.*`），
   新界面不需要它们；`action.ok` / `app.ready` / `app.untitled` 三条是预留。
   本次顺手补上了 4 条**该用却没用**的 key（`message.copied` / `message.pasted` /
   `dialog.resize.size` / `error.dropUnsupported`），这类"定义了但没接线"的 key 正是这张表的用途。
6. **没有做浏览器端自动化测试**（无 headless browser 依赖）。替代证据是 §2.3 的 DOM 桩启动测试；
   **未验证**：真实浏览器里的 CSS 布局、WebGL 上下文、文件下载与拖放。

---

## 5. 手工验收步骤（需要浏览器）

`pnpm build:app` 后打开 `packages/app/dist/index.html`（或 `pnpm --filter @ncplanner/app exec vite`），
按下面五步走一遍，即可覆盖 CI 判不了的部分：

1. **启动**：页面出现菜单栏 + 三栏布局；主题为深色；浏览器标签标题为 "NC Plannerator"。
2. **打开 → 编辑 → 保存**（R3.3）：
   `datasets/fixtures/historical/usfr-legacy-ncpf.ncpf` 拖进窗口 → 选中 `Underhaul SFR` →
   `File ▸ Save` → 用 `format-golden.ps1 -Probe` 回读写出文件，指纹应与原文件一致。
   （该脚本已在 `docs/java-exit-plan.md` §P4 归档；要跑先
   `git checkout java-frozen-c79c557f -- src tools/golden libraries nbproject build.gradle build.xml`。
   TS 侧的等价口径是 `pnpm test packages/formats` 的 R2.2/R2.5 用例。）
3. **语言与持久化**（R3.2）：Settings ▸ 简体中文 → 菜单/面板/元素名立即变中文，
   `<html lang="zh-CN">`；刷新后仍是中文。
4. **编辑器**（R3.5）：绘制/擦除/取色/选择/填充、Ctrl+Z/Ctrl+Y、镜像勾选、
   `Edit ▸ Resize`（会提示裁掉多少方块）。
5. **视图与导出**（R3.6/R3.7/R2.12）：2D 切层、3D 拖拽旋转 + 滚轮缩放 + 剖切 + 仅外壳；
   `File ▸ Export image (PNG)` 下载的图应包含配置名/版本、统计行、部件清单和逐层方块网格。
