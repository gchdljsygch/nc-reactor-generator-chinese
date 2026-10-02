# R1 状态与 M1 闸门报告

> 计划：`docs/rewrite-plan-r1-r5.md`（R1 = 骨架 + 内核，§4/§9）。
> 本文件是 **R1 的唯一状态入口**：每项任务做了什么、证据在哪、什么没做。
> 所有"通过"都可以用文中的命令复现；没有实测支撑的项一律标 `未验证`。

---

## 0. 一句话结论

**R1 完成，M1 闸门通过。** 单一物理内核在**四种堆型**上全部通过各自的黄金数据集：

| 堆型 | 记录 | 结果 |
|---|---:|---|
| Overhaul SFR | 5,000 | **100.00%** |
| Underhaul SFR | 5,000 | **100.00%** |
| Overhaul MSR | 1,000 | **100.00%** |
| Overhaul Turbine | 500 | **100.00%** |

另有：R1.5h 独立手算验证、R1.0a 确定性测量（0 差异）、D1 两个产品 bug 的修复与验证、
i18n（58 项测试）、NCPF 读写（38/38 指纹，含用冻结 Java 版读回 TS 写出文件的交叉验证）。
此时**没有一行 UI** —— 这正是 M1 的定义。

```powershell
pnpm install
pnpm verify     # typecheck + lint + 全量测试（SFR/USFR/MSR/Turbine 黄金数据集）
```

## 1. 任务清单

| # | 任务 | 状态 | 产物 / 证据 |
|---|---|---|---|
| R1.0a | Java 引擎逐次确定性 | ✅ | `--repeat 10`：3,429 次重复、0 差异、0 ULP → `docs/r1/r1.0-determinism.md` |
| R1.0b | MSR 黄金数据（≥1,000 例） | ✅ | **1,000 例，0 error，87.6% productive，980 例含燃料容器** |
| R1.0c | Turbine 黄金数据（≥500 例） | ✅ | **500 例，0 error，96.6% productive（`totalOutput>0`）** |
| R1.0d | 文件级移植量复核 | ✅ | `tools/ts/port-audit.mjs`（确定性 hash）+ `docs/r1/port-audit-file-level.md` |
| R1.0e | D1 决策落地 + 数据集重生成 | ✅ | 数据集 v3（单射命名）+ D1-B 修复 → `docs/r1/d1-decision.md`、`datasets/golden/BASELINE.md` |
| R1.1 | 仓库骨架与工程约定 | ✅ | `docs/r1/r1.1-skeleton.md`；`pnpm typecheck`/`lint`/`test` 全绿 |
| R1.2 | i18n 基础设施 | ✅ | `packages/i18n`（58 项测试）、`docs/r1/r1.2-i18n.md`、`docs/r1/r1.2-translation-migration.md` |
| R1.3 | NCPF 数据模型 | ✅ | `packages/ncpf`（声明式 module schema、四段式身份键、`packages/ncpf/test/*`） |
| R1.4 | NCPF 读写 + 38 指纹 | ✅ | `packages/formats`（134 项测试）、`docs/r1/r1.4-ncpf-io.md`：读 38/38、保存往返 38/38、**TS 写出的文件被冻结 Java 版读回 38/38 指纹一致** |
| R1.5 | Overhaul SFR 内核 | ✅ | **5,000/5,000**；`docs/r1/r1.5-kernel.md`、`docs/r1/float-fidelity.md` |
| R1.5h | 独立手算验证（不可省） | ✅ | `packages/kernel/test/hand-calc.test.ts`（含边界与幂等性） |
| R1.6a | Underhaul SFR 内核 | ✅ | **5,000/5,000** |
| R1.6b | Overhaul MSR 内核 | ✅ | **1,000/1,000** → `docs/r1/r1.6-msr-turbine.md` |
| R1.6c | Overhaul Turbine 内核 | ✅ | **500/500** → 同上 |
| R1.6d/e | Distiller / Fusion | ⛔ 砍掉 | R0 判定：distiller 无随附配置、fusion 非长方体几何；计划 §9.3 本身建议砍 |

## 2. M1 闸门判定

计划 §4.7：**内核能在 Node 端跑完 SFR/Underhaul/MSR/Turbine 物理，黄金数据集全部通过
（含崩溃策略）。此时没有一行 UI，但核心风险已消除。** → **满足。**

M1 作为"决策闸门"的用途是「若卡在 <90%，说明栈选错，应切 Kotlin（R-2）」。
实测结果（4 个数据集、11,500 条记录、全部通过；SFR/USFR 逐位一致）：

- **R-2（TS 表达力不足）判定为已消除** —— 不建议切 Kotlin；
- 剩余风险回到 §10 的 R-3（兼容层，R2）与 R-10（工作量），即"体力"而非"可行性"。


## 3. 关键证据索引

| 主题 | 文件 |
|---|---|
| 浮点保真规则（所有内核代码注释引用它） | `docs/r1/float-fidelity.md` |
| 数据集为什么升到 v3（`getName()` 非单射） | `docs/r1/r1.0-dataset-naming.md` |
| 冻结引擎的确定性 | `docs/r1/r1.0-determinism.md` |
| D1 决策：修了什么、为什么另两个 bug 不回改 Java、第 5 个 bug | `docs/r1/d1-decision.md` |
| MSR / Turbine 黄金数据的构造器与实测率 | `docs/r1/msr-turbine-goldens.md` |
| 内核移植报告 + 移植中发现的 6 个真实缺陷 | `docs/r1/r1.5-kernel.md` |
| MSR / Turbine 内核移植与逐位一致率分布 | `docs/r1/r1.6-msr-turbine.md` |
| NCPF 读写：两种 writer 语义 + 38 指纹交叉验证 | `docs/r1/r1.4-ncpf-io.md` |
| 基线记录（Java 版本 / 种子 / 参数 / 变更史） | `datasets/golden/BASELINE.md` |
| 文件级移植量与**排期修正** | `docs/r1/port-audit-file-level.md` |
| i18n 设计 / 迁移账目（0 条静默丢失） | `docs/r1/r1.2-i18n.md`、`docs/r1/r1.2-translation-migration.md` |
| 工程约定与铁律落地 | `docs/r1/r1.1-skeleton.md` |

## 4. 未完成项与已知限制（诚实清单）

1. **R1.6d/e Distiller / Fusion**：按计划 §9.3 **主动砍掉**（R0 判定 distiller 无随附配置可实例化、
   fusion 非 `CuboidalMultiblock`）。这是决策，不是遗漏。
2. **MSR / Turbine 的浮点并非全部逐位一致**：验收门槛（§3.1.3 的 1e-5）全部满足，
   但逐位一致率为 MSR 99.15%、Turbine 92.2%，最大相对偏差 2.4e-7。
   MSR 的非逐位字段全部是 `shutdownFactor` 归一化；Turbine 是
   `rotorEfficiency → totalEfficiency → totalFluidEfficiency` 链的表示差异。
   分布与逐字段归因见 `docs/r1/r1.6-msr-turbine.md` §1.3 与 `docs/r1/float-fidelity.md` §8。
3. **冻结实现的两处 `NaN` 泄漏已在 TS 侧定义域**：SFR/MSR 的 `shutdownFactor`
   （零输出/负值）与 Turbine 的 `rotorEfficiency`（无叶片时 `0/0`，17/500 例）。
   `packages/kernel/test/finite-stats.test.ts` 断言四个数据集**每一条记录的每一个统计量**
   都是有限值。注意：**不夹到 `[0,1]`** —— `rotorEfficiency` 合法地大于 1（最大 1.0957），
   夹紧会破坏 21/500 例（第一版实现踩过这个坑，已记录）。
3. **R1.4 的三项未移植**（均有明确归属，不影响 38/38 指纹）：
   `sfr-ncpf-save` 的 `coolant_recipe: -1`（Java 写出的不可恢复值，R0 发现 #9）、
   导出时不合并 addon 元素（仅影响同时含 addon 与 design 的文件，R2）、
   读取期的 metadata/贴图回填副作用（R2.1）。见 `docs/r1/r1.4-ncpf-io.md` §7。
4. **i18n 的 818 条待人工判断**：迁移做到了 0 条静默丢失，但真正需要人判断的部分留给 R3.8
   （密钥提取时才能确定最终 key 与占位符）。
5. **排期修正**：R1.0d 的文件级复核给出 **R1 = 8–10 周**（计划写 5–7 周），
   依据是 R1 范围内 25,364 行 must-port 代码量。R1 的关键路径已交付，
   但按修正后的排期，`docs/rewrite-plan-r1-r5.md` 的 §4 工时表需要重排。

## 5. 建议的下一步

1. 按 R1.0d 的修正排期重排 R2–R5（R2 的 2.5–4 周与 6,777 行实测一致，可保持）；
2. 把「NCPF 往返指纹 38/38」（R1.4 已有测试）与「黄金数据集四堆型」一起写进 CI 门禁
   （计划 §11.3 的两行现在已经可执行）；
3. 把 i18n 的 818 条待判断项排进 R3.8 的 burn-down（`tools/ts/lint.mjs` 的裸字符串基线
   会在 R3 写 UI 时开始增长，需要配套的 ICU key 提取工具）；
4. R2 的第一件事建议是 `LegacyNCPF v9/v10/v11` 与 Hellrage 读取——它是 R-3（兼容性丢失）
   的主要缓解项，且有 15 个真实历史文件可立即验收。
