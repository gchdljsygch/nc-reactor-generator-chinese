# tools/ — TypeScript 工具链

> 本目录现在**只有 TypeScript/Node 工具**（`tools/ts/*.mjs`），全部由 `pnpm` 脚本驱动。
>
> **Java 时代的工具已随 Java 树一起删除**（`docs/java-exit-plan.md` P2/P3/P4）：
> `tools/golden/*.ps1`、`tools/audit/port-audit.ps1`、`tools/i18n/*.ps1`。
> 它们的产物全部已入库（`datasets/golden/`、`datasets/fixtures/`、
> `datasets/translations/`、`docs/r0/*.md`），脚本原文可从 tag 取回：
>
> ```powershell
> git ls-tree -r --name-only java-frozen-c79c557f -- tools
> git checkout java-frozen-c79c557f -- tools/golden tools/audit tools/i18n
> ```
>
> Java 工具的历史说明保留在 `docs/r0/`（`findings.md` / `golden-datasets.md` /
> `fixture-coverage.md` / `port-audit.md` / `translation-migration.md`），
> 那里记录的用法仍准确，只是需要先把脚本从 tag 取回、并自备 JDK。

---

## 1. 命令一览

| 命令 | 脚本 | 作用 |
|---|---|---|
| `pnpm typecheck` | `tsc --noEmit` | 全仓库类型检查 |
| `pnpm lint` | `tools/ts/lint.mjs` | 依赖方向（`kernel`/`ncpf` 不得依赖 UI）+ 裸字符串检查 |
| `pnpm test` | `vitest run` | 单元测试 + 黄金数据集（`NCPL_GOLDEN=full` 跑全量） |
| `pnpm verify` | — | typecheck + lint + 全量测试 |
| `pnpm build:app` | `vite build` | 构建 Web 应用（`packages/app/dist`） |
| `pnpm size` | `tools/ts/size-check.mjs` | **构建产物**体积门禁（静态资源 < 15 MB，数据集不计） |
| `pnpm size:repo` | `tools/ts/repo-size.mjs` | **tracked 仓库**体积门禁（< 60 MB，§P5） |
| `pnpm check:no-java` | `tools/ts/no-java.mjs` | 仓库里不得再有 tracked `*.java` / `*.jar`（§P5） |
| `pnpm pwa:check` | `tools/ts/pwa-build-check.mjs` | 构建产物必须满足离线契约（R5.3） |
| `pnpm i18n:audit` | `tools/ts/i18n-audit-app.mjs` | UI 用到的 key 必须在语言包里存在 |
| `pnpm i18n:elements` / `:check` | `tools/ts/elements-pack.mjs` | 生成 / 校验元素名语言包 |
| `pnpm i18n:locale` / `:check` | `tools/ts/make-locale.mjs` | 生成 / 校验应用语言包 |
| `pnpm r2:coverage` | `tools/ts/r2-coverage.mjs` | 重生成 `docs/r2/fixture-coverage.md`（必须是 no-op） |
| `pnpm icons` | `tools/ts/make-icons.mjs` | 生成 PWA 图标 |
| `pnpm verify:full` | — | 以上全部串起来的**总门禁** |

CI（`.github/workflows/ci.yml`）与发布（`release.yml`）跑的就是这些命令；
`pnpm verify:full` 是本地复现 CI 的入口。

---

## 2. 移植审计（`tools/ts/port-audit.mjs`）

R0.6（包级规则）与 R1.0d（文件级）的审计结果都已入库，脚本现在有两种模式：

```bash
# ① CI 跑的形态：重放已入库快照，不读 src/（Java 树已删除）
node tools/ts/port-audit.mjs --baseline docs/r1/port-audit-file-level.json

# ② 重新扫描一棵 Java 树（先 git checkout java-frozen-c79c557f -- src）
node tools/ts/port-audit.mjs --summary
node tools/ts/port-audit.mjs --json docs/r1/port-audit-file-level.json
node tools/ts/port-audit.mjs --report
```

`--baseline` 做两道断言：JSON 自身的 `contentSha256` 必须等于其载荷哈希，
且必须等于脚本内置的 `EXPECTED_SHA`。任一不符即 `exit 1`，所以删掉 `src/`
不会让门禁静默变成 `files=0`（java-exit-plan 风险 R-4）。

**冻结基线**：831 文件 / 77,840 行，`contentSha256=7e36b9a5…`。
口径、分类规则与工期修正见 `docs/r1/port-audit-file-level.md`。

---

## 3. 数据（`datasets/`）

| 目录 | 内容 | 来源（已入库，无需重跑） |
|---|---|---|
| `datasets/configurations/` | 38 个生产配置（18.7 MB，`*.ncpf.json`） | Java 版随附配置；2026-10 从 `src/configurations` 迁出（§P1） |
| `datasets/golden/` | 四堆型黄金数据集（gzip JSONL，5,000/5,000/1,000/500 例） | `tools/golden/golden.ps1`（已删，见 tag） |
| `datasets/fixtures/` | 格式 fixtures + 19 个真实历史文件语料 | `tools/golden/fixtures.ps1` / `historical-fixtures.ps1`（已删，见 tag） |
| `datasets/converted/` | 冻结版 Java reader 链对 fixtures 的读数（`MANIFEST.json`） | `tools/golden/format-golden.ps1`（已删，见 tag） |
| `datasets/translations/` | 旧中文化的译文/数据名拆分结果 | `tools/i18n/*.ps1`（已删，见 tag） |
| `datasets/tutorials/` | 7 个 `.ncpt` 教程文件 | `src/tutorials`（§P4/D4 迁出） |

黄金数据集的格式、口径与已知限制见 `datasets/golden/BASELINE.md` 与
`docs/r0/golden-datasets.md`。

---

## 4. 仓库体积与 Java 退出（§P5 门禁）

```bash
pnpm check:no-java    # git ls-files '*.java' '*.jar' 必须为空（白名单为空）
pnpm size:repo        # tracked 总字节 < 60 MB，并打印目录分解与十个最大文件
```

退出前后的实测（`docs/java-exit-plan.md` §0）：

| 项 | Java 退出前 | 现在 |
|---|---:|---:|
| tracked 文件 | 2,097 | 357 |
| tracked 体积 | 205.5 MB | 50.1 MB |
| `*.java` / `*.jar` | 838 / 169 | 0 / 0 |

`.git` 历史不变（不做 `filter-repo`），所以**已有的 clone 不会变小**；
变轻的是新 clone 的 checkout。完整冻结树在 tag `java-frozen-c79c557f`。
