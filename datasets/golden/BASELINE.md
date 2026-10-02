# 黄金数据集基线记录（BASELINE）

> 计划 `docs/rewrite-plan-r1-r5.md` §11.4 要求：**每次重新生成基线都必须记录**
> 「Java 提交号 + 种子 + 参数」。本文件是 R1 之后的权威记录。

## 当前基线

| 项 | 值 |
|---|---|
| 数据集版本 | `datasetVersion 3` |
| 生成器 | `GoldenGen`（`tools/golden/src/net/ncplanner/plannerator/tools/GoldenGen.java`） |
| 引擎 | `java-final`（工作区冻结源码 + D1-B 的辐照器 null guard，见 `docs/r1/d1-decision.md`） |
| 配置 | `src/configurations/nuclearcraft.ncpf.json`（NuclearCraft 1.12.2-2o.9.3 / underhaul 2.19a） |
| 种子 / 参数 | `--seed 20260101 --min-size 3 --max-size 14` |
| 统计口径 | 反射取全部数值字段（含 private），排除 `calcStep`/`calcSubstep`/`lastChangeTime`/`x`/`y`/`z` |
| 模板与配方命名 | `NCPFElementDefinition.toString()`（单射；见 `docs/r1/r1.0-dataset-naming.md`） |
| 统计提取 | `reflection over numeric fields (incl. private)` |

| 文件 | 内容 | 状态 |
|---|---|---|
| `sfr-cases.jsonl.gz` | Overhaul SFR ×5000（0 个 `error` 记录） | **当前基线** |
| `usfr-cases.jsonl.gz` | Underhaul SFR ×5000 | **当前基线** |
| `msr-cases.jsonl.gz` | Overhaul MSR ×1000（0 error，87.6% productive，980 例含燃料容器） | **当前基线**（R1.0b） |
| `turbine-cases.jsonl.gz` | Overhaul Turbine ×500（0 error，96.6% productive） | **当前基线**（R1.0c） |
| `sfr-cases.pre-d1.jsonl.gz` | Overhaul SFR ×5000，**未修**辐照器 NPE（277 个 `error`） | 审计对照 |
| `*-cases.v2.jsonl.gz` | R0 原始版本（`getName()` 命名，有歧义） | 审计对照 |

> MSR / Turbine 的种子：MSR `20260101`、Turbine `20260102`（各自独立生成）；
> 两者的 `--min-size 3 --max-size 14` 与 SFR 相同。
> MSR 数据集需要 D1 追加的第 5 个 bug 修复（MSR 加热器配方 `ClassCastException`），
> 否则任何含激活加热器的用例都会抛异常 —— 见 `docs/r1/d1-decision.md` §6。

## 复现命令

```powershell
# 1) 重新编译应用源码 + harness（不要加 -SkipCompile：app classes 必须与当前 src 同步，
#    否则会拿到「未含 D1 修复」的旧 class，生成出带 277 个 error 的数据集）
pwsh -File tools/golden/golden.ps1 -Type sfr           -Cases 5000 -Seed 20260101 -MinSize 3 -MaxSize 14 -Out datasets/golden/sfr-cases.jsonl
pwsh -File tools/golden/golden.ps1 -Type underhaul-sfr -Cases 5000 -Seed 20260101 -MinSize 3 -MaxSize 14 -Out datasets/golden/usfr-cases.jsonl -SkipCompile

# 2) 压缩（仓库只保留 .gz）
node -e "const z=require('zlib'),f=require('fs');for(const n of ['sfr','usfr'])f.writeFileSync('datasets/golden/'+n+'-cases.jsonl.gz',z.gzipSync(f.readFileSync('datasets/golden/'+n+'-cases.jsonl'),{level:9}))"
```

> `tools/golden/build/classes` 是**构建产物**，可能落后于 `src/**`。
> 任何「重生成基线」的操作都必须先重编译应用源码（上面的第一步），
> 否则会静默得到与本文档不符的数据集。

## 基线自检（每次改产品代码后应重跑）

```powershell
# 生成前 200 例，与 datasets/golden/sfr-cases.jsonl.gz 逐条比对 grid/recipes/blockNames/editor/error
# 期望：identical 200 / 200
```

**最近一次自检**：R1 结束时（`src` 已含 D1-B 的辐照器 guard 与 MSR 加热器 guard），
`identical 200 / 200`。


## 变更历史

| 阶段 | 变化 | 验证 |
|---|---|---|
| R0 | 初次生成（`getName()` 命名） | `docs/r0/golden-datasets.md` |
| R1.0e | 命名改单射（v3），数据集版本 2 → 3 | 与 v2 逐条对照：`editor diffs 0`、`error diffs 0` |
| R1.0e / D1-B | 辐照器 null guard 修复后重生成 | 4,723 条逐字段不变；277 条由 `error` 变为有黄金值 |
| R1.0b / D1-追加 | MSR 加热器配方 `ClassCastException` 修复（不影响 SFR） | 前 200 例 SFR 与基线逐条相同（R1 结束时自检） |

> ⚠️ 修改任何产品代码（`src/**`）之后，**必须**重跑上面的命令并更新本文件；
> 否则 TS 侧的 100% 通过率将无法归因到具体基线。
