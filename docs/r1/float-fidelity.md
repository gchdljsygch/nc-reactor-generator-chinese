# R1 — 浮点保真规则（TS 内核如何复刻 Java 的 `float` 语义）

> 本文档是代码注释里反复引用的 `docs/r1/float-fidelity.md`。
> 它是 R1.5 期间**实测踩出来的**规则：Overhaul SFR 内核最初 99.94% 通过，
> 剩下的失败全部来自浮点语义，修正后才达到 100%。
> 适用者：任何要移植 Java 数值代码的人（R1.6 的 MSR/Turbine、R4 的生成器）。

---

## 0. 结论先行

| # | 规则 | 违反后的现象（实测） |
|---|---|---|
| 1 | **JSON 里的 `float` 字段必须在读入时 `Math.fround`** | `efficiency` 偏 1 ULP，进而 `totalOutput` 差 1e-4 相对量 |
| 2 | **Java 里每一步 `float` 运算都要逐步 `fround`**，不能只在最后取整 | 同上，误差随链长累积 |
| 3 | **`int += float` 是 `(int)(int + float)`**：先按 float 相加再向零截断 | `rawOutput` 差 1（3/5000 例） |
| 4 | **求和顺序是有语义的**：方块扫描 x→y→z、方向 PX,PY,PZ,NX,NY,NZ、簇的发现顺序 | 截断累积差、簇内浮点和差 |
| 5 | **Java 表达式里是 `double` 的部分要用 double 算，最后只 cast 一次** | `sparsityMult`、`criticalityModifier` |
| 6 | **`double` 字段（如 underhaul 的 `heatMult`）只承载 float 商**，不要反向精化 | — |

---

## 1. 规则 1：读入即收窄（最重要的一个）

`NCPFSettingsModule.addFloat(...)` 在 Java 里把 JSON 数字读成 **`float`**。
TS 若直接 `JSON.parse` 得到 `number`（即 double），值就已经不同了：

```ts
// 错：1.05 是 double，Java 里是 float(1.05) = 1.0499999523162842
efficiency: num(m, 'efficiency'),
// 对：
efficiency: f(num(m, 'efficiency')),
```

**实测**：Overhaul SFR 全量 5000 例中，有 10 个方块的 `efficiency` 因此偏 1 ULP，
其中 3 例导致 `rawOutput` 差 1（`int` 截断把 1 ULP 放大成整数差）。
`packages/ncpf/src/moduleSchema.ts` 因此把每个字段标注了 `int` / `float` / `double`：
**这张表不是文档，是正确性的一部分。**

已收窄的位置：
`sfr/config.ts`（fuel_stats.efficiency、moderator.efficiency、reflector.*、
neutron_shield.efficiency、neutron_source.efficiency、irradiator_stats.*、settings.*）、
`usfr/config.ts`（fuel_stats.power/heat、settings.moderator_extra_*）。

## 2. 规则 2：逐步 fround

Java：

```java
block.efficiency = fuel.eff * posEff * sourceEff * critMod;   // 三次乘法，三次舍入
```

TS 必须 `fmul(fmul(fmul(a,b),c),d)`，不能 `f(a*b*c*d)`：两者相差 1 ULP 是常态。
`packages/kernel/src/float.ts` 提供 `fadd/fsub/fmul/fdiv/d2f/f2i`。

## 3. 规则 3：`int += float`

JLS 15.26.2：`E1 op= E2` 等价于 `E1 = (T)((E1) op (E2))`。
`rawOutput += cluster.totalOutput`（`int += float`）因此是：

```ts
this.rawOutput = intAccumulateFloat(this.rawOutput, cluster.totalOutput);
// = f2i(Math.fround(intValue + floatValue))
```

**不是** `rawOutput += Math.trunc(totalOutput)` —— 后者在负数与进位时不等价。
同理出现在 `that.neutronFlux += flux*2*reflectivity`、
`cluster.totalHeat += irradiatorRecipe.stats.heat*neutronFlux`。

## 4. 规则 4：求和顺序

浮点加法不满足结合律，而 `int` 截断会把顺序差异放大成整数差。必须复刻：

- 方块扫描顺序：`BlockGrid.getBlocks()` 是 `x` 外层、`y`、`z` 内层（`BoundingBox.forEachPosition`）；
- 方向顺序：`Direction.values()` = `PX, PY, PZ, NX, NY, NZ`；
- 簇的发现顺序：按 `allBlocks` 顺序，首次遇到的新簇追加到 `clusters` 末尾；
- 簇内方块顺序：`getClusterBlocks` 分层 BFS 后按层号升序展平
  （Java 用 `HashMap<Integer,...>` 的 keySet，实测对本工程的 key 范围就是升序）。

## 5. 规则 5：Java 的 double 表达式

```java
sparsityMult = (float)(m + (1-m)*Math.sin(Math.PI*fb/(2*volume*threshold)));
```

其中 `(1-m)` 与 `2*volume*threshold` 是 **float** 运算，`Math.sin(...)` 的参数与
整个乘法是 **double**，最后 cast 一次。TS：

```ts
const inverse = fsub(1, multiplier);            // float 减法
const period  = fmul(2 * volume, threshold);    // float 乘法
const value   = multiplier + inverse * Math.sin((Math.PI * fb) / period); // double
this.sparsityMult = d2f(value);                 // 一次收窄
```

`criticalityModifier` 同理：`(float)(1/(1+Math.exp(2*(flux-2*crit))))`，
指数用 `Math.exp`（double），最后收窄一次。

## 6. 规则 6：underhaul 的 `heatMult` 是 double

Java `UnderhaulSFR.heatMult` 是 `double`，但它承载的是 `float` 除法
（`totalHeatMult/cells`）的结果被**拓宽**的值。因此 TS 侧保持「float 商 + 拓宽」，
不要用 double 精度重算商。

---

## 7. 验证方式（可复现）

1. 逐用例对拍：`packages/kernel/test/sfr-golden.test.ts`、`usfr-golden.test.ts`
   （`NCPL_GOLDEN=full`），字段级容差见 `packages/kernel/src/stats.ts`。
2. 逐方块对拍（定位差异用）：
   - Java 侧 `GoldenGen --dump-blocks-id sfr-000001`；
   - TS 侧 `NCPL_DUMP_ID=sfr-000001 npx vitest run packages/kernel/test/block-dump.test.ts`；
   - `node tools/ts/diff-block-dumps.mjs <javaDump> <tsDump>`（按 float32 归一化比较，
     并把簇当作位置的划分来比，避免进程间 identity hash 干扰）。
3. 引擎确定性：`GoldenGen --repeat 10`，见 `docs/r1/r1.0-determinism.md`。

## 8. 实测结果（R1.5 / R1.6）

### 8.1 验收（§3.1.3 的门槛：整数精确、浮点 1e-5 内）

| 数据集 | 记录 | 结果 |
|---|---:|---|
| Overhaul SFR | 5,000 | 全部通过 |
| Underhaul SFR | 5,000 | 全部通过 |
| Overhaul MSR | 1,000 | 全部通过 |
| Overhaul Turbine | 500 | 全部通过 |

### 8.2 逐位一致率（附加测量，非门槛）

命令：`$env:NCPL_ULP_CENSUS='1'; npx vitest run packages/kernel/test/zz-ulp-census.test.ts`
（统计口径：把 JSON 里的值与内核值都收敛到 float32 再比较 —— JSON 只带最短十进制表示，
不复位就会把 0.44 这类值误判成差 1 ULP）。

| 数据集 | 可比较字段 | 逐位相同 | 非逐位相同的字段 | 最大相对偏差 |
|---|---:|---:|---|---:|
| Overhaul SFR | 71,433 | **100.00%** | — | 0 |
| Underhaul SFR | 45,000 | **100.00%** | — | 0 |
| Overhaul MSR | 13,876 | 99.15% | 仅 `shutdownFactor`（758/876 逐位） | 归一化后 0 |
| Overhaul Turbine | 7,449 | 92.21% | `rotorEfficiency` → `totalEfficiency` → `totalFluidEfficiency` | 2.4e-7 |

两条非 100% 都有明确原因，且都**不是**漏掉的浮点规则：

- **MSR 的 `shutdownFactor`**：冻结引擎在该字段上会返回负值（例如 `msr-000006`：
  golden `-1.0745456`，内核原始值 `-1.0745456218719482`，其实两者逐位相同），
  而 §3.1.5 定义域把它规范化到 `[0,1]`（两侧同时规范化）→ 记为「不同」。
  其余 13,758 个字段全部逐位相同。
- **Turbine 的三个效率字段**：`rotorEfficiency` 由一串 `float` 运算得到，
  之后在 Java 里参与的是 **double** 乘法；TS 侧复刻了同样的步骤，
  但表达式的结合方式使结果落在相邻 float 上。最大相对偏差 2.4e-7，
  比 1e-5 的门槛小 42 倍，属于"表示形式"而非"物理"差异。

> 结论：**SFR/USFR 逐位可复现**；MSR/Turbine 在 1e-5 内可复现（MSR 唯一的例外是
> 规范化后的 `shutdownFactor`）。任何"逐位相同"的主张都必须按堆型限定。
