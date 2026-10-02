# nc-reactor-generator

A program to plan and generate reactors and other multiblocks for Nuclearcraft (https://www.curseforge.com/minecraft/mc-mods/nuclearcraft-mod)

This is the Standard (Windows/Linux Desktop) version.
For the Multiplatform version, see https://github.com/ThizThizzyDizzy/nc-planner-twd


## Contact
You can find me (Thiz#1633) on the NuclearCraft discord (https://discord.gg/KCPyGww)

---

## 中文版重写（TypeScript / Web）—— R1–R3 状态

本仓库同时承载 **NC Plannerator 中文版**的重写工作（Java → TypeScript/Web）。
Java 源码保持冻结，作为**验收基线**；新代码在 `packages/` 下。

```powershell
pnpm install
pnpm verify               # typecheck + lint + 全量测试（含四堆型黄金数据集）
pnpm verify:full          # 上面 + i18n 覆盖审计 + 应用构建 + 构建体积门禁
```

| 入口 | 内容 |
|---|---|
| `docs/rewrite-plan-r1-r5.md` | R1–R5 执行计划（含验收标准） |
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

