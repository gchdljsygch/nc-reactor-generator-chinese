# nc-reactor-generator

A program to plan and generate reactors and other multiblocks for Nuclearcraft (https://www.curseforge.com/minecraft/mc-mods/nuclearcraft-mod)

This is the Standard (Windows/Linux Desktop) version.
For the Multiplatform version, see https://github.com/ThizThizzyDizzy/nc-planner-twd


## Contact
You can find me (Thiz#1633) on the NuclearCraft discord (https://discord.gg/KCPyGww)

---

## 中文版重写（TypeScript / Web）—— R1–R5 状态

本仓库现在是一个**纯 TypeScript / Web** 仓库：`packages/` 下是新实现，
`datasets/` 是黄金数据集与生产配置，`tools/ts/` 是全部工具链。

**Java 树已归档至 tag `java-frozen-c79c557f`**（`docs/java-exit-plan.md` P4），
仓库里已不存在 `.java` / `.jar`，也没有 Java 构建链——由 `pnpm check:no-java`
与 `pnpm size:repo` 在 CI 里守住。需要取回冻结的 Java 源码或 golden harness：

```powershell
git ls-tree -r --name-only java-frozen-c79c557f -- src      # 看有什么
git checkout java-frozen-c79c557f -- src tools/golden       # 取回（会在工作区留下改动）
node tools/ts/port-audit.mjs --summary                      # 对取回的树重跑移植审计
```

```powershell
pnpm install
pnpm verify               # typecheck + lint + 全量测试（含四堆型黄金数据集）
pnpm verify:full          # 上面 + i18n 覆盖审计 + 应用构建 + 构建体积 + 仓库体积 + PWA 门禁
```

| 入口 | 内容 |
|---|---|
| `docs/java-exit-plan.md` | **Java 退出方案与执行日志**（P0–P5，含每阶段验收） |
| `docs/rewrite-plan-r1-r5.md` | R1–R5 执行计划（含验收标准；Java 时代的历史方案） |
| `docs/r1/README.md` | **R1 状态与 M1 闸门报告**（内核，先看这个） |
| `docs/r2/README.md` | **R2 状态：格式兼容层**（`docs/r2/fixture-coverage.md` 是逐文件覆盖表） |
| `docs/r3/README.md` | **R3 状态：Web 应用**（含需要浏览器的手工验收步骤） |
| `docs/r0/findings.md` | R0 实测发现（13 项） |
| `datasets/golden/BASELINE.md` | 黄金数据集基线记录（Java 版本 + 种子 + 参数） |
| `packages/kernel/` | 单一物理内核（四堆型） |
| `packages/formats/` | NCPF 读写 + R2 兼容层（LegacyNCPF / Hellrage / NCConfig） |
| `packages/app/` | R3 Web 应用（`pnpm build:app` 后打开 `packages/app/dist/index.html`） |

铁律：**物理只有一份实现**（编辑器与生成器共用）；`kernel`/`ncpf` 不得依赖 UI
（由 `tools/ts/lint.mjs` 在 CI 中强制）；元素匹配一律用身份而不是显示名；
用户可见文案一律走 i18n key，不做字符串拼接。

