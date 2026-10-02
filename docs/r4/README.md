# R4 状态报告 — 生成器框架（搜索）

> 计划：`docs/rewrite-plan-r1-r5.md` §7（R4.1–R4.5）、§11.2（铁律）、§11.3（CI 门禁）。
> 本文件是 **R4 的唯一状态入口**：每项任务做了什么、证据在哪、什么没做。
> 所有"通过"都可以用文中的命令复现；没有实测支撑的项一律标 `未验证`。

---

## 0. 一句话结论

**R4 交付，并且是这一轮里"最不可能做对"的一轮。** 冻结版的生成器在 Java 里是
**第二套物理引擎**（`LiteOverhaulSFR` 982 行 vs `OverhaulSFR`），R0 实测两者在
**33.9% 的随机网格上给出不同答案**。本次移植**没有**复制那套引擎：生成器只持有
"整数索引网格"，每一次 `calculate()` 都调用**编辑器用的同一个 `OverhaulSfrReactor.recalculate()`**。
搜索框架（阶段机 / 优先级 / 转换 / mutator / 条件 / 表达式）则逐行移植，
因为**它决定用户拿到的反应堆长什么样**。

| 指标 | 数值 |
|---|---:|
| `packages/generator` 源码 | **4,872 行 TS / 23 个文件** |
| `packages/generator` 测试 | **23 passed**（3 个文件，663 行） |
| R4.4 界面测试 | **20 passed**（`packages/app/test/generatorPanel.test.ts`，444 行） |
| 全仓库测试 | **554 passed / 2 skipped**（36 个文件） |
| 实测搜索速度 | **≈1,836 次迭代/秒**（9×9×9 Overhaul SFR，20,000 次，单线程） |
| 四份出厂预设 | **4/4 可加载、可运行、可改进** |
| 新增运行时依赖 | **0** |

```powershell
pnpm install
pnpm verify          # typecheck + lint + 全量测试（含 R4 的 23 项）
pnpm build:app       # Vite 生产构建：111 modules，含生成器
pnpm size            # §11.3 构建体积门禁
pnpm i18n:audit      # §11.3 未翻译 key = 0
```

---

## 1. 任务清单

| # | 任务 | 状态 | 产物 / 证据 |
|---|---|---|---|
| R4.1 | 移植搜索框架（`multiblock/generator/lite/**`，76 文件 / 5,091 行） | ✅ | `packages/generator/src/**`：`generator.ts`（`LiteGenerator`/`GeneratorStage`/`Priority`/`StageTransition`）、`condition.ts`、`expression.ts`、`setting.ts`、`variable.ts`、`mutator.ts`、`mutators/{sfr,usfr}.ts`、`symmetry.ts`、`variable`/`random.ts`；**显式注册表取代 Java 的 classpath 扫描**（§4.4d） |
| R4.2 | Web Worker 线程池 | ⚠️ 契约完备，**未接线到 UI** | `driver.ts` 的 `WorkerTransport` / `createInlineTransport` / `GeneratorPool` + `worker.ts`（可 `new Worker()` 的独立入口）；`test/pool.test.ts` **6 项全绿**（每 lane 独立种子、best-of 合并、错误不挂起、参数校验）。**UI 当前跑单线程**，见 §4 |
| R4.3 | we-as-GPU / WASM 决策 | ✅ 决策：**不做** | 见 §3.1：实测 1,836 迭代/秒已够用，而 WASM 会引入第二套数字实现（与铁律 1 直接冲突） |
| R4.4 | 生成器界面（进度 / 中间结果 / 中断） | ✅ | `packages/app/src/ui/generator.ts`（面板）、`model/generatorBridge.ts`（网格桥）、`model/generatorHost.ts`（预设加载/翻译/运行/回填）；`test/generatorPanel.test.ts` **20 项全绿**；新增 18 个 i18n key（en + zh） |
| R4.5 | JS 沙箱取代 DSSL 脚本 | ✅ 以"组合"取代"解释器" | `script.ts`：`composeStages()`（用数据构造阶段机）+ 内置脚本目录 + `SandboxTransport` 契约；**不移植 DSSL 解释器**，见 §3.3 |
| — | NCPF 读写（`plannerator:generator_settings`） | ✅ | `ncpf.ts` |
| — | 动画/预览（`anim/**`） | ⚠️ 部分 | `anim.ts` 只保留"最近结果环 + 游标"（104 行）；**没有渲染**（Java 是 Java2D 补间系统），见 §4 |

---

## 2. 验收标准与判定

### 2.1 铁律 1：生成器与编辑器是同一个内核

这是 R4 唯一的"必须做对否则整轮作废"的判据。

- **实现方式**：`packages/kernel/src/fast.ts` 的 `SfrFastReactor` / `UsfrFastReactor`
  每格持有**一个长生命周期的 `SfrBlock`**，只省掉**分配**，物理调用的是
  编辑器统计面板同样的 `OverhaulSfrReactor.recalculate()`。
- **证据**：`packages/generator/test/search.test.ts` 的
  `matches the editor kernel cell-for-cell on the final grid` 断言三件事：
  1. 同一个网格连续两次 `calculate()` 得到**逐字段相同**的统计量；
  2. 内核对象（`grid.kernel()`）直接重算，`totalOutput/totalHeat/totalCooling/totalEfficiency/netHeat`
     与网格报告值**逐项相等**；
  3. 全部字段有限（`Number.isFinite`）。

```text
pnpm vitest run packages/generator
 ✓ packages/generator/test/presets.test.ts (8 tests)
 ✓ packages/generator/test/search.test.ts (9 tests)
 ✓ packages/generator/test/pool.test.ts (6 tests)
 Tests  23 passed (23)
```

### 2.2 四份出厂预设必须真的能用

预设是**针对另一份"占位配置"**写的：文件里内嵌的是 6 个占位方块
（`FUEL CELL`/`IRRADIATOR`/`REFLECTOR`/`MODERATOR`/`SHIELD`/`HEATSINK`），
而 `indicies` 是那份列表的下标。**不翻译就等于没有生成器。**

- 翻译规则照抄 Java `Mutator.importFrom`，包括那个**不对称比较**：
  存储侧读 `configuration.blocks[i-1]`（"有 `heat_sink` 模块"），
  目标侧读 `cooling != 0`。正因如此，占位方块 `cooling: 0` 仍能匹配到真实散热器——
  **这是四份预设唯一能工作的原因**（`compiled-import.ts` 有完整说明）。
- **证据**：`test/presets.test.ts` 断言四份预设的 `referencedPaths` **全部可寻址**、
  索引列表翻译后**非空**、每个产出的下标都指向真实 entry；
  `test/generatorPanel.test.ts` 进一步断言翻译后 **`random_cell` 仍能放燃料单元**
  （否则搜索会"报告了几万次迭代却什么都没改进"）。

```text
 ✓ presets: structure > describes all four shipped presets
 ✓ presets: structure > references only variables the reactor actually exposes
 ✓ presets: index translation > turns the overhaul placeholder indices into real blocks
 ✓ presets: index translation > expands the heatsink placeholder even though its cooling is zeroed
 ✓ presets: index translation > turns the underhaul placeholder indices into real blocks
```

### 2.3 搜索必须真的在搜索

- `test/search.test.ts`：2,000 次迭代内 **`upgrades > 0`**（说明优先级、`copyVarsFrom`
  暂存网格、算子求值全部接通）；阶段指针**离开 stage 0**（说明转换条件与
  `generator.stages[i].Hits` 变量生效）。
- `test/generatorPanel.test.ts`：在真实设计上运行 2,000 次迭代，`upgrades > 0`，
  且返回的 tooltip 含 `Total Output`。

### 2.4 确定性（**对冻结版的刻意改进**）

冻结版 Java 每个线程 `new Random()`（时钟播种），**完全不可复现**。
这里一律 `JavaRandom(seed)`，且 `test/presets.test.ts` 用**真实 JDK 25 跑出来的数列**钉住 LCG：

```text
$ java RndProbe.java
nextInt(100) seed42: 30, 63, 48, 84, 70, 25, 5, 18, 19, 93
nextFloat    seed42: 0.7275637, 0.054665208, 0.6832234, ...
nextInt()    seed0 : -1155484576
nextLong     seed42: -5025562857975149833
```

断言：同种子 → 同最优解**逐格相同**；异种子 → 不同。`test/pool.test.ts` 与
`test/generatorPanel.test.ts` 各有一条独立的同种子复现测试。

> **这一条最初是红的，并因此抓到一个真 bug。** 见 §3.2：`GeneratorStage` 每检查一个
> 条件都重新 `withRandom()`，而 `withRandom` 退出时会**恢复上一次的 RNG**，
> 于是"条件能看到哪个 RNG"取决于调用深度——同种子跑两次得到不同的网格
> （实测 4 次升级 vs 9 次升级）。改成"一次运行只安装一次 ambient RNG"后复现。

### 2.5 性能（R4.3 要求的是**测量**，不是阈值）

```text
R4.3 performance: 20000 iterations of overhaul_sfr/output on 9x9x9
                  in 10895 ms = 1836 iterations/second (65 upgrades)
```

首次测量（未修 RNG 时的同一配置）为 **7,584 迭代/秒**；修好后为 1,836——慢下来的部分
正是被跳过的物理调用，**修复同时提升了搜索质量**（0 upgrades → 65 upgrades）。

**R4.3 决策：不做 WASM / we-as-GPU。** 理由有两条，第二条比第一条重要：

1. 1,836 迭代/秒 × 4 线程（或 Worker 池）对"点一下、等几秒"的交互已经够用；
2. **WASM 会引入第二套数字实现**。铁律 1 的全部价值在于"只有一个内核"，
   而把物理再写一遍到 Rust/C++ 正是 R0 记录的那类错误
   （`LiteOverhaulSFR` 与 `OverhaulSFR` 在 33.9% 的网格上不一致）。
   性能不够时正确的做法是**复用现有内核**（Worker 池、增量重算），而不是平行实现。

### 2.6 界面（R4.4）

`test/generatorPanel.test.ts` 20 项，覆盖三个层面：

- **网格桥**：内部尺寸 = 外部尺寸 − 2（外壳环是结构，不参与搜索）；
  两个格子进出一致、**不位移**；不同方块解析到**不同 entry**（合并到同一 entry
  是"看起来正常但放错方块"的索引空间 bug）；未知下标**报错而不是猜**；
  真实但不可放置的方块（机壳/控制器/端口）**静默跳过**；空设计不误报。
- **预设翻译**：编译 entry 空间是真实配置的（58 方块 > 6 占位）；
  翻译后下标全部可寻址；`clear_invalid` 的空列表是**正确**的（它不取下标）。
- **运行**：改进真实设计；同种子复现；**中断信号生效**（`stop: 'cancelled'`，
  迭代数远小于 100 万）；Underhaul 预设同样可跑。

i18n：新增 18 个 key（`panel.generator`、`generator.*`），`en_US` 与 `zh_CN`
**同时**补齐，`pnpm i18n:audit` 通过（`en_US` 411 → 429 keys）。

### 2.7 构建与体积

```text
pnpm build:app
 ✓ 111 modules transformed.
 dist/assets/index-BFQP-ok7.js   1,817.65 kB │ gzip: 613.66 kB
 ✓ built in 935ms

pnpm size
 assets   : 1.78 MB  (budget 15.00 MB)
 datasets : 1.20 MB  (excluded)
 total    : 2.98 MB
size-check passed
```

引入生成器后主包从 1,631 kB 增至 1,818 kB（+187 kB，未压缩），**仍在门禁内**。

---

## 3. 端口过程中发现并处理的真实缺陷

这一节是本轮最有价值的部分：以下每一条都是**跑测试或读数据时发现的**，不是推测。

### 3.1 预设索引列表与真实配置是**两个不同的下标空间**（保留原行为并记录）

`overhaul_sfr` 预设的 `random_cell` 存 `indicies [1,2,3,4,5]`，Java 按
`configuration.blocks[i-1]` 读成 `blocks[0..4]`。**如果 `configuration` 是真实的
NuclearCraft 配置**，`blocks[0..4]` 是控制器与 4 种机壳 → **燃料单元列表为空** →
`random_cell` 什么都不做。

实测（`test/presets.test.ts`，已写成永久断言）：

```text
importSfrIndices([6], 真实overhaul配置, 编译结果) → [114,115,119,120,128]
  entry 114 nuclearcraft:fission_cell_port      heatsink= null
  entry 115 nuclearcraft:fission_cell_port      heatsink= null
  entry 119 nuclearcraft:fission_irradiator_port heatsink= null
  entry 128 nuclearcraft:fission_shield          heatsink= null
```

即：**同一个规则，配错配置就会选出通风口**。因此 `prepareRun` 必须用**预设自带的
配置**做翻译（Java 也正是这么做的：`mutator.importFrom(multiblock, ncpf.configuration)`，
其中 `ncpf` 是**被加载为预设的那个文件**）。这一点在 `generatorHost.ts` 与
`generatorBridge.ts` 都有注释，且 `test/generatorPanel.test.ts` 直接钉住
"翻译后 `random_cell` 仍能放燃料单元"。

> **踩过的坑**：我最初用*真实配置*翻译，结果搜索"报告 1,836 迭代/秒、0 次改进"。
> 这不是崩溃，是静默无效——所以这条专门写了断言。

### 3.2 嵌套 `withRandom` 破坏确定性（**已修**）

`GeneratorStage.run` 早先对每个条件调用 `withRandom(currentAmbient(), () => condition.check())`。
`withRandom` 在 `finally` 里**恢复前一个** RNG，于是内层调用退出后，外层看到的 RNG
不再是最初安装的那个。实测症状：

```text
DEBUG upgrades a/b: 4 9      ← 同种子、同迭代数，两次运行结果不同
DEBUG identical: false
DEBUG differing cells: 693
```

修法：`LiteGenerator.run` 用**一次** `withRunRandom(rand, …)` 包住整个迭代，
`GeneratorStage` 直接 `condition.check()`。修后：

```text
DEBUG upgrades a/b: 7 7
DEBUG identical: true
DEBUG differing cells: 0
```

这条同时解释了 §2.5 里"7,584 → 1,836 迭代/秒"的差异（被跳过的物理调用）。

### 3.3 延迟变量绑定的**节点身份**（**已修**）

预设的表达式是 `subtract(min(1, multiblock2.X), min(1, multiblock.X))`——
变量引用是**算子树的叶子**，不是槽位本身。第一版实现里 sink 记录了一个路径、
`expressionFromJson` 又**另造**一个节点，于是"绑定"补在了没人读的对象上：

```text
DEBUG nodes reachable from priorities BEFORE: 46
DEBUG nodes reachable from priorities AFTER:  46
DEBUG still-throwing variable nodes: 38 of 38   ← 一个都没绑上
```

修法：sink 返回**它要放进树里的那个节点**，调用方记录并稍后原地打补丁。修后
`still-throwing variable nodes: 0 of 38`。

### 3.4 `random_quantity` 的 min/max 在 Java 里**从不写盘**（刻意分歧）

`RandomQuantityMutator` 拥有 `min`/`max`（默认 1 / 100），但基类
`GeneratorMutator.convertToObject` 只写 `mutator`，**没有任何子类覆盖它**。
后果：用户把"50 到 200 次"设好、保存，**静默丢失**，四份出厂预设全部锁死在 1..100。

我们**写**这两个字段，也**读**它们。出厂预设不受影响（缺省即 Java 默认值）。

### 3.5 每步的 `conditions` 在 Java 里**也不写盘**（保留原行为）

同上：`convertFromObject` 只读 `mutator`，而 `GeneratorStage.run` **确实会求值**
`step.conditions`。我们保留字段（阶段机需要），但**沿袭 Java 的"不写出"**——
写一个 Java 读不回来的字段会让我们的文件在上游打不开。这个不对称记在这里。

### 3.6 `RandomCellMutator` 的三处 Java 瑕疵（逐字保留）

1. 它读**同一份** `indicies`，却**不减 1**（`random_block` 减 1）。在 Java 的
   `-1 = 空气` 域里这是越界一位；我们用 `0 = 空气`，所以"不减 1"恰好**是**我们的语义，
   代码里写明了这个转换。
2. `add_moderators` 与 `use_reflectors` 两个设置项**从未被 `run` 读取**；
   `reflectorBlocks` 列表填了但没用。
3. 角落循环算出 `x/y/z` 之后**推入的是目标格**，所以"填充角落"实际是重复写目标格。

三者都是四份预设依赖的行为，**改任何一个都会改变预设生成的结果**，因此只记录不改。

### 3.7 空索引列表：Java 会**静默杀死生成线程**（已改）

Java `rand.nextInt(0)` 抛 `IllegalArgumentException`；抛出点在线程里，
**没有 try/catch**——用户看到的是"搜索停了，没有任何提示"。
§3.1 说明这个状态**从出厂数据可达**。现在 `pick()` 对空列表是**空操作 + 一次性警告**：

```text
generator: Random Cell Mutator has an empty index list, so it does nothing.
           Enable at least one entry in the generator settings.
```

### 3.8 注册表必须**在 import 时**自注册（**已修**）

app 侧测试直接抓到：`describePresets()` 在模块顶层调用，而它需要 mutator 注册表；
注册原本是显式调用，于是**两条看似无关的语句之间产生了顺序依赖**。
现在 `index.ts` 在 import 时注册（等价于 Java 的 classpath 扫描语义），
`registerAllMutators()` 保留给想显式确认的调用方。

### 3.9 `clear_invalid` 的判据：整数计数器 → 逐块谓词（**语义等价性未完全证明**）

Java 的 lite 引擎在传播 cluster 时维护**整数计数器**
`blockActive[x][y][z]`、`moderatorValid[x][y][z]`（可 >1，可被多条路径累加），
`clear_invalid` 判据是 `blockActive + moderatorValid <= 0`。

内核没有这些计数器；它暴露逐块谓词 `SfrBlock.isActive()` 与 `SfrBlock.moderatorValid`
（编辑器自己的方块渲染读的就是这两个）。**这不是同一个表达式**，两者可能在一个情况下分歧：
**只靠 cluster 成员资格才算 active 的方块**。见 §5 未验证第 1 条。

### 3.10 导出语义的刻意分歧

冻结版 lite 导出**总是剪枝**（把非 active 的格子清成空气），于是**导出的网格重新仿真
可能与生成器刚刚打分的网格不一致**。这里 `toIndices()` 返回**原始未剪枝**网格
（重放它精确复现生成器报告的数字），`pruneInactive()` 是显式选择的对照方法。

### 3.11 `random.ts` 的 LCG 是对的，是我的**测试**错了

最初我按印象写了一组"JDK 期望值"，测试红了。装了真 JDK 25 跑探针（§2.4 的命令）
才发现**实现是对的、我记的数是错的**。教训写在这里：期望值必须来自被测系统之外的
权威来源，否则测试只是在钉住自己的猜测。

---

## 4. 明确没做的事

| 项 | 状态 | 原因 |
|---|---|---|
| **Worker 池接线到 UI** | ⚠️ 契约与测试完备，UI 跑单线程 | 需要把 ~1.2 MB 内核配置传给每个 worker + 消息级取消协议；**把未经浏览器验证的线程池藏在 UI 后面，比诚实地单线程更糟**。`GeneratorPool`/`worker.ts` 已有 6 项测试，接线是纯机械工作 |
| **中间结果画廊** | ⚠️ 只有计数 | Java 用动画轮播已存的多方块；这里只显示当前最优解的文字读数 + `Stored Multiblocks` 计数。要缩略图需要渲染器 |
| **阶段/步骤的逐项设置编辑器** | ⚠️ 只能选预设 | 可移植的 `Setting`/`SettingVariable` 接口已经就位（这正是为它准备的），但 UI 树是下一轮 |
| **`anim/**` 的渲染** | ⚠️ 只保留数据环 | Java 的 `Animation` 是 Java2D 补间系统；这里 `anim.ts` 只保留"最近结果环 + 游标 + 计时推进"（104 行），**不改变任何网格**（Java 的预览会 `multiblock.rotate()` 原地旋转，即**看着看着就把结果改了**） |
| **DSSL 脚本语言** | ⛔ 不做（决策，§9 D5） | 见 §3.3 的替代方案 |
| **表达式求值器** | ⛔ 不做 | 用户不能在脚本里写 `multiblock.Total Output / multiblock.Total Heat`，只能从注册的算子中选择。**这是相对 DSSL 的真实能力回退**，是刻意的取舍：计划优先"一个内核 / 确定性 / 可解释的 UI"，而内嵌解释器与这三条都冲突 |
| **MSR / Turbine 的生成器** | ⛔ 无预设 | 出厂数据里没有它们的生成器预设，所以面板对这两种堆**明确显示"没有预设"**，而不是给一个点了没反应的按钮 |
| **`SetIndicies` 的 UI 复现 Java 的 `gen()`** | ⚠️ 未复现 | `SettingIndicies.gen()` 是死代码，Java 自己也没调用（`init()` 只建标签）。我们同样不调用，但**保留了 `names`**，因为 UI 需要它 |

---

## 5. 未验证（明确清单）

1. **`clear_invalid` 的整数计数器语义**（§3.9）。逐块谓词与 Java 的累加计数器在
   "仅因 cluster 成员资格而 active"的方块上可能分歧。**没有实测**：要验证需要让冻结版
   Java 生成一组网格、对每个网格跑 lite 的 `clear_invalid`、再与我们的结果逐格比对，
   而仓库里的 golden 数据集**不含生成器运行轨迹**。影响面：搜索可能保留一个 Java 会清掉的
   方块，或反之。这是本报告里**最实质的一条未验证**。
2. **Worker 池在真实浏览器里的行为**。`test/pool.test.ts` 用 `createInlineTransport`
   验证的是**编排**（lane 分配、取消、best-of 合并），真 `Worker` 的构造/消息/终止
   **完全没有跑过**——仓库没有浏览器端自动化测试。`worker.ts` 里
   `new Worker(new URL('@ncplanner/generator/worker', import.meta.url))` 的 Vite 打包路径
   只验证到"构建通过、`pwa:check` 看到 worker URL"。
3. **UI 面板的人工走查**。20 项测试覆盖桥、翻译、运行与中断信号，但
   **DOM 交互没有测**（点击 Start/Stop/Use result、选择预设、改写种子）。
   `ui/generator.ts` 为了这个理由把宿主抽成接口，**面板本身可以用假宿主测**——
   但这轮没做。
4. **与冻结版 Java 的生成结果对照**。R0 的 golden 数据集是针对**给定网格**的统计量，
   不是针对**生成轨迹**。所以"我们的搜索与 Java 的搜索给出同样好的反应堆"**从未被验证**，
   也不可能在不跑冻结版 JVM 生成器的前提下验证。我们验证的是：同样的**框架语义**
   （阶段机、优先级、转换、确定性 RNG）。
5. **`importSfrIndices` 的写回不对称**。Java **写** `indicies` 用的是"编译 entry 空间"，
   **读**回来却按"原始方块下标"解释。出厂预设里两个空间恰好重合，所以往返无损；
   不重合的配置下**冻结版 Java 读自己的文件就已经错了**。我们复现了它，但没有构造
   一个"不重合"的配置去实测这个错误的样子。
6. **`percent` 参数存的是分数**（`4.0` 在 Java UI 显示为 `400%`）。已在 `setting.ts`
   注释里记录，但**没有实测**这四份预设里的 `percent` 在 Java 端到底如何显示。
7. **性能数字的跨机器可比性**。1,836 迭代/秒是本机（Windows / Node 24）的测量值，
   **没有**与冻结版 Java 生成器的速度做过任何对比。

---

## 6. 文件清单

| 文件 | 行数 | 作用 |
|---|---:|---|
| `packages/generator/src/generator.ts` | 564 | `LiteGenerator`/`GeneratorStage`/`Priority`/`StageTransition` + 变量路径注册表 |
| `packages/generator/src/expression.ts` | 509 | 常量 / 算子 / `SettingVariable` / 延迟绑定 sink |
| `packages/generator/src/driver.ts` | 408 | 单线程运行核心 + `WorkerTransport` + `GeneratorPool` |
| `packages/generator/src/condition.ts` | 394 | 条件（含 `and`/`or`/`not` 与 `Hits` 计数） |
| `packages/generator/src/setting.ts` | 366 | 参数（`int`/`float`/`percent`/`boolean`）与结构设置 |
| `packages/generator/src/mutators/sfr.ts` | 317 | Overhaul 的 4 个 mutator |
| `packages/generator/src/mutator.ts` | 315 | 两层 mutator 框架 + 注册表 |
| `packages/generator/src/script.ts` | 289 | R4.5：组合式脚本 + 沙箱契约 |
| `packages/generator/src/reactors/usfr.ts` | 253 | Underhaul 索引网格 |
| `packages/generator/src/compiled.ts` | 243 | 索引空间编译（含 `Mutator.importFrom` 的不对称规则） |
| `packages/generator/src/compiled-import.ts` | 220 | 出厂预设的索引翻译 |
| `packages/generator/src/presets.ts` | 189 | 两阶段加载（延迟 → 绑定） |
| `packages/generator/src/reactors/sfr.ts` | 381 | Overhaul 索引网格 |
| `packages/generator/src/worker.ts` | 129 | Worker 入口（`@ncplanner/generator/worker`） |
| `packages/generator/src/{anim,grid,index,json,ncpf,random,symmetry,variable}.ts` | 730 | 其余 |
| `packages/kernel/src/fast.ts` | 355 | `SfrFastReactor`/`UsfrFastReactor`（铁律 1 的实现点） |
| `packages/app/src/ui/generator.ts` | 392 | R4.4 面板 |
| `packages/app/src/model/generatorHost.ts` | 243 | 预设加载 / 翻译 / 运行 / 回填 |
| `packages/app/src/model/generatorBridge.ts` | 164 | 编辑器网格 ↔ 生成器网格 |
| `packages/generator/test/{presets,search,pool}.test.ts` | 663 | 23 项测试 |
| `packages/app/test/generatorPanel.test.ts` | 444 | 20 项测试 |
