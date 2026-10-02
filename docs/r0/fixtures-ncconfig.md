# R0.4 — NCConfig（`.cfg`）fixtures

> 由 `net.ncplanner.plannerator.tools.ConfigFixtureGen` 生成。
>
> 这两个 reader 读的是**配置**而不是设计，因此无法用其它格式那种「writer 写出 → reader 读回」的办法覆盖。
> 本工具按 reader 源码**逐属性合成**一个最小但完整的 `nuclearcraft.cfg`，再用真实的 reader 链验证。

| 文件 | 期望 reader | 大小 | 读入 | 命中的 reader | 元素数 | 配置 |
|---|---|---:|:--:|---|---:|---|
| `ncconfig-underhaul.cfg` | `UnderhaulNCConfigReader` | 3.0 KB | ✅ | `UnderhaulNCConfigReader` | 90 | Underhaul SFR Configuration |  |
| `ncconfig-overhaul.cfg` | `OverhaulNCConfigReader` | 10.7 KB | ❌ | `—` | — | — | IllegalArgumentException: Cannot create an element stack, with an amount, using a definition that cannot have an amount! |

> **`ncconfig-overhaul.cfg` 说明**：该 fixture 本身是完整的；read() 抛异常是**产品 bug**：`OverhaulNCConfigReader` 无条件地在第 129-131 行用 `new NCPFListElement(...)` 调 `builder.irradiatorRecipe(...)`，而 `OverhaulSFRConfigurationBuilder:188` 执行 `new NCPFElementStack(definition, 1)`；`NCPFListElement.canHaveAmount()` 返回 false，于是构造函数直接抛 `IllegalArgumentException: Cannot create an element stack, with an amount, using a definition that cannot have an amount!`。这三行是无条件的，因此**任何** overhaul `.cfg` 都读不进来（详见 findings §11）。

## 汇总

| 项 | 数值 |
|---|---:|
| fixture 数 | 2 |
| 读入成功 | 1 |
| 读入失败 | 1 |

## 为什么这两个 reader 需要专门的 fixture

其余格式的 fixture 走「构造反应堆 → writer 写出 → reader 读回 → 比对」这条环回链路。
`OverhaulNCConfigReader` / `UnderhaulNCConfigReader` 是**配置读取器**：

- 输入是 NuclearCraft 模组的 Forge 配置文件（`config/nuclearcraft.cfg`），不是规划器写出的文件；
- 仓库里没有任何 `.cfg` 样本；
- 没有对应的 writer（规划器只能读它，不能写它）。

所以必须**按 reader 源码合成输入**。本工具的合成规则：

1. **标量 vs 列表、元素类型**由 reader 使用的访问器决定：
   `getInt` → `I:`，`getDouble` → `D:`，`getString` → `S:`，`getBoolean` → `B:`。
   `ConfigList.getInt` 是 `return get(index)`（泛型强转），类型写错会 ClassCastException。
2. **列表长度**取 reader 里出现的最大字面量下标，循环索引的取足够大的值。
3. **燃料族的列表长度必须精确** —— `addSFRFuels`/`addFuels` 逐元素索引，
   长度取自这些调用的实参个数：thorium 5、uranium 20、neptunium 10、plutonium 20、
   mixed 10、americium 10、curium 30、berkelium 10、californium 20（overhaul）。
4. **放置规则字符串**用 reader 的解析器能接受的最小形式：`at least one cell` / `at least one moderator`。
   `parsePlacementRule` → `NCPFPlacementRule.parseNc` 会把 `cell`/`moderator`/`casing` 等前缀
   映射到模块，所以这些字符串无需引用具体方块。

## TS 实现的验收口径

新实现必须能把这两个 `.cfg` 读成与上表一致的配置（元素数与配置名），
并且**探测顺序**要与 `docs/r0/compat-contract.md` §6 一致：
underhaul 的 `.cfg` 不能先被 overhaul reader 抢走（两者靠 `fission_sink_cooling_rate`
与 `fission_cooling_rate` 的存在与否区分）。
