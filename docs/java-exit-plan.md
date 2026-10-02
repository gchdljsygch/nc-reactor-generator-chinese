# Java 退出方案（java-exit-plan）

> 目标：把仓库从「TS 重写 + 冻结 Java 基线共存」推进到 **零 Java 仓库**（0 个 `.java`、0 个 `.jar`、无 Java 构建链），
> 且每一步结束时 `pnpm verify:full` 全绿。
>
> 前情：`docs/r1/port-audit-file-level.md`（R1.0d 文件级移植审计）、`docs/r5/README.md`（R5 交付状态）、`docs/r5/migration.md`（数据迁移）。
>
> 本文所有数字都可用文中命令复现；**本文只描述计划，不修改任何 Java 文件**。

---

## 0. 摘要（先看这里）

| 阶段 | 内容 | tracked 文件 | tracked 体积 | 工时 | 提交 |
|---|---|---:|---:|---:|---|
| **P0** | 固化审计基线 + 修 CI 门禁 | ±0 | ±0 | 0.5 d | 1 |
| **P1** | 生产配置解耦：`src/configurations` → `datasets/configurations` | ±0 | ±0 | 1.0 d | 1 |
| **P2** | 审计/工具链与 Java 解耦 | −3 | ≈0 | 0.5 d | 1 |
| **P3** | 删构建链 + 二进制依赖 | −183 | **−104.4 MB** | 0.25 d | 1 |
| **P4** | 删 Java 源码 + 死资产（先打 tag） | **−1,562** | **−51.0 MB** | 0.5 d | 1–2 |
| **P5** | 守卫 + 文档收尾 | +2 | ≈0 | 0.5 d | 1 |
| | **合计** | **2,097 → ≈350** | **205.5 → ≈50 MB** | **3.25 d** | 6–7 |

复现当前口径：

```powershell
git ls-files '*.java' | Measure-Object                          # 838
git ls-files '*.jar'  | Measure-Object                          # 169
$t = git ls-files; ($t | Measure-Object).Count                  # 2097
node tools/ts/port-audit.mjs --summary                          # files=831 rawLines=77,840 codeLines=76,579
```

---

## 1. 不变量（每个阶段结束都必须为真）

1. **`pnpm verify:full` 全绿**：typecheck + lint + 全量测试 + i18n 审计 + 元素包 + 语言包 + `build:app` + `size` + `pwa:check`。
2. **测试永远不需要 Java、GL、网络**（`ci.yml` 顶部注释已经是这个契约，只保持，不放宽）。
3. `datasets/**` 的**字节**除路径搬迁外不变（黄金数据集、fixtures、指纹不许重算）。
4. **R2.3 / R2.4 的历史 fixtures 只能靠 git 历史取得**（`tools/golden/historical-fixtures.ps1` 用 `git show <rev>:<path>`、`git cat-file blob`），因此搬迁/删除工作区文件**不得**破坏历史路径字符串。
5. TS 源码里的 `OverhaulSFR.java:1024`、`MenuInit.java:219-220` 这类**出处注释保留**——它们是移植依据，不是 Java 残留。
6. 每阶段一个提交，可独立 `git revert`。

---

## 2. 现状耦合矩阵（实测）

| 目标 | 规模 | 谁真正引用它 | 处置 |
|---|---:|---|---|
| `src/configurations/**` | 38 文件 / 18.7 MB | `packages/app/src/main.ts`（5 处 import）、`packages/formats/src/legacy/hellrage.ts`、**20 个测试文件**（38 条 `baseline.ts` 路径 + 相对 URL）、docs | **P1 搬迁** |
| `src/net/**/*.java` | 831 文件 / 3.6 MB | 仅 `tools/ts/port-audit.mjs --src src`、`tools/audit/port-audit.ps1`、注释/文档 | P2 解耦 → P4 删 |
| `tools/golden/src/**/*.java` | 7 文件 / 0.06 MB | `tools/golden/*.ps1`（javac/java 调用） | P4 删（连同脚本） |
| `libraries/**` | 169 文件 / **104.4 MB** | `nbproject/project.properties`、`tools/golden/golden.ps1`（classpath） | P3 删 |
| 构建链 | `gradlew` `gradlew.bat` `gradle.properties` `settings.gradle` `build.gradle` `build.xml` `manifest.mf` + `gradle/wrapper/*` | 无（CI 纯 Node） | P3 删 |
| `nbproject/**` + `*.iml` | 4 + 1 | Ant 构建 | P3 删 |
| `src/{textures,fonts,shaders}/**` + `src/textures/multitool/*.{obj,mtl}` | 692 文件 / 27.7 MB | **0 处代码引用**（仅 docs 叙述） | P4 删 |
| `src/tutorials/*.ncpt` | 7 文件 / 0.1 MB | **0 处**（TS 侧只有 `tutorialShown` 这个设置位，无 tutorial reader） | D4 决策 |
| `test/textures/**` | 23 文件 / 19.5 MB | **0 处** | P4 删 |
| `versions.txt` | 1 文件 / 107 行 | Java 自动更新清单（`Updater.java` / `VersionManager.java`） | P3 删 |
| `src/changelog.txt` | 1 文件 / 0.03 MB | 仅人读 | D5 决策 |
| `patrons.txt` | 1 文件 / 8 行 | 只有 docs 与 Java `MenuCredits.java`；README 致谢语义 | **保留** |
| `LICENSE.md`（GPLv3） | 1 文件 | 全仓库 | **保留** |
| docs 中的 Java 路径引用 | 数百处 | 历史叙述 / 审计证据 | 保留（P5 加横幅） |

**结论**：真正阻塞删除的只有一处——`src/configurations/**`。其余全是「删掉就行」或「删除后只剩注释引用」。

---

## 3. 决策点（默认值可直接执行）

| # | 问题 | 推荐（默认） | 备选 |
|---|---|---|---|
| **D1** | Java 树怎么归档 | `git tag java-frozen-<sha>` + 删除；历史 blob 仍在，可 `git checkout java-frozen-<sha> -- src` 取回 | `legacy/java/` 目录常驻（+155 MB，不推荐） |
| **D2** | 生产配置落点 | **A：`datasets/configurations/`**（与 `src/` 同相对深度，Vite import 只需换一段路径；不与 `.gitignore:7 /configurations` 冲突） | B：根 `configurations/`（需删 `.gitignore` 第 7 行）；C：原地不动（`src/` 永远留壳） |
| **D3** | `tools/golden/` 处置 | 整目录删除（无 JDK 后脚本不可运行；`datasets/golden` 已提交为 gzip 基线） | 保留脚本 + 文档注明「需 `git checkout java-frozen-<sha>` 后运行」 |
| **D4** | `src/tutorials/*.ncpt` | `git mv src/tutorials datasets/tutorials`（0.1 MB，留作未来 Web 教程功能的素材） | 直接删（TS 目前无 reader） |
| **D5** | `src/changelog.txt` | `git mv src/changelog.txt docs/changelog-java.md` | 直接删（`git log` 可查） |

---

## 4. 阶段方案

### P0 — 固化审计基线并修门禁（0.5 d）

**为什么必须先做**：审计文档的数字**已经漂移**，而 CI 不会发现。

实测（2026-10 复算）：

```
files=831 rawLines=77,840 codeLines=76,579
contentSha256=7e36b9a5c7c9de15382259418b0941b8ae6cffb47c543946889c9f788beda6a4
```

而文档记录的是 `831 / 77,825`、`contentSha256=e6b2f520…`。逐文件 diff 只有 **2 个文件**变了，都来自中文化冻结提交 `4fad557f`：

| 文件 | 行数 |
|---|---|
| `multiblock/overhaul/fissionmsr/OverhaulMSR.java` | 2117 → 2126（+9） |
| `multiblock/overhaul/fissionsfr/OverhaulSFR.java` | 1878 → 1884（+6） |

`ci.yml` 的 `Port audit (deterministic)` 步骤只跑 `--summary` **打印**，没有比对，因此 `+15` 行漂移静默通过。

**动作**

1. 刷新唯一数据源：`node tools/ts/port-audit.mjs --json docs/r1/port-audit-file-level.json`
2. 更新 `docs/r0/port-audit.md`、`docs/r1/port-audit-file-level.md` 的总数与 hash（或改成「实测值以 JSON 的 `contentSha256` 为准」）
3. `tools/ts/port-audit.mjs` 内置 `EXPECTED_SHA`，`--summary` 时哈希不符即 `exit 1`
4. 记录 Java 冻结点：`git rev-parse HEAD` → 写进 P4 的 tag 名与本文

**验收**

- 故意改 1 行 Java → CI 的 Port audit 步骤**失败**；改回 → 通过（用一个临时提交验证，别推）
- `pnpm verify:full` 绿

**回滚**：单提交 revert。

---

### P1 — 生产配置解耦（1 d）｜唯一的真依赖

**动作**

```powershell
git mv src/configurations datasets/configurations
git check-ignore -v datasets/configurations/nuclearcraft.ncpf.json   # 期望：无输出（不被忽略）
```

**改代码引用（6 文件 / 7 处）**

| 文件 | 位置 |
|---|---|
| `packages/app/src/main.ts` | 24, 29, 30, 31, 32 |
| `packages/formats/src/legacy/hellrage.ts` | 477（默认 `DEFAULT_ROOT_URL`）；注释 54、471 |
| `packages/generator/src/expression.ts` | 25（注释） |

**改测试路径（20 文件 / 38+ 条）**

| 包 | 文件 |
|---|---|
| formats | `test/baseline.ts`（38 条 `path:` + 头注释）、`test/r1.4a-read.test.ts:52`、`test/r1.4c-export.test.ts:160` |
| app | `test/bootstrap.test.ts:21`、`test/generatorPanel.test.ts:29,40`、`test/partsList.test.ts:25`、`test/simulate.test.ts:25` |
| generator | `test/pool.test.ts:27,29`、`test/presets.test.ts:32,33`、`test/search.test.ts:38,39` |
| kernel | `test/block-dump.test.ts:32`、`dataset-naming.test.ts:26`、`finite-stats.test.ts:30`、`hand-calc.test.ts:53`、`msr-golden.test.ts:25`、`sfr-golden.test.ts:28`、`turbine-golden.test.ts:25`、`usfr-golden.test.ts:21`、`zz-ulp-census.test.ts:25` |
| ncpf | `test/config.test.ts:32` |

**不要动**：`tools/golden/historical-fixtures.ps1` 里的 `src/configurations/…`（那是**历史路径**，靠 `git show` 取 blob；改了会取不到 v1/v2/v5/v8/v10 的历史版本）。

**顺带更新**：`tools/README.md`（“38 个生产配置”的路径）、`docs/` 中描述**当前位置**的句子（纯历史叙述可保留）。

**验收**

```powershell
git grep -n "src/configurations"      # 只剩 tools/golden/historical-fixtures.ps1 + 历史类 docs
pnpm verify:full                      # 绿
pnpm build:app; pnpm size             # 构建体积不变（配置以 JSON 内联进 bundle）
```

**回滚**：纯路径改动，`git revert` 即可。

---

### P2 — 审计与工具链与 Java 解耦（0.5 d）

必须在 P3/P4 **之前**落地：否则删掉 `src/` 后 `port-audit --summary` 只会打印 `files=0`，而 CI 不失败。

**动作**

1. `tools/ts/port-audit.mjs` 新增 `--baseline <json>`：直接从 `docs/r1/port-audit-file-level.json` 重放汇总/报告，并校验其 `contentSha256`；`--src` 保留给「checkout 了 `java-frozen-<sha>`」的人
2. `ci.yml` 的 Port audit 步骤改为
   `node tools/ts/port-audit.mjs --baseline docs/r1/port-audit-file-level.json`
3. 删除 `tools/audit/port-audit.ps1`（R0 期 PowerShell 版，已被 TS 版取代；在 `docs/r0/` 引用处加「脚本已删除，见 P2」注记）
4. 删除 `tools/i18n/extract-translations.ps1`、`tools/i18n/classify-translations.ps1`（默认入参是 `SimplifiedChineseLocalizer.java`；产物 `datasets/translations/**`、`lang/*.json` 已入库）

**验收**：`--baseline` 输出 `831 / 77,840` 且 hash 匹配；`pnpm verify:full` 绿。

**回滚**：单提交（脚本删除可从历史取回）。

---

### P3 — 删构建链与二进制依赖（0.25 d，−104.4 MB）

```powershell
git rm -r libraries nbproject gradle
git rm gradlew gradlew.bat gradle.properties settings.gradle build.gradle build.xml manifest.mf `
       nc-reactor-generator-chinese.iml versions.txt
```

`.gitignore` 清理（Java 专条）：`/out`、`/build/`、`/.gradle/`、`/tools/golden/build/`、`/dssl.jar`、`/dssl`、`/configurations`、`/version.version`、`/benchmark.ncpf`、`/benchmark.json`、`/errors`、`/crash-reports`、`/*.config2`、`/*.dssl`、`settings.dat`、`smorebank.dat`、`special.dat`。
**保留**：`/release/`、`node_modules/`、`/datasets/golden/*.jsonl`、`!/package.json` 等 TS 例外、`/*.ncpf`（Web 版仍会导入用户 `.ncpf`？——若确认不需要则一并删）。

**验收**：`git ls-files '*.jar'` = 0；`pnpm verify:full` 绿；tracked 体积 −104.4 MB。

> 注意：`.git` 历史里仍有旧 blob，**已有克隆不会变小**；本节只保证「新 clone 的 checkout」变轻。

**回滚**：`git revert`（体积随之回来）。

---

### P4 — 删 Java 源码与死资产（0.5 d，−51.0 MB）

**第 1 步（不可跳过）：先归档**

```powershell
$sha = git rev-parse --short HEAD
git tag -a "java-frozen-$sha" -m "Java 冻结基线（中文化版 v5.0.5+），R1–R5 验收依据"
git push origin "java-frozen-$sha"      # 推送成功后才继续
```

**已记录的冻结点（P0 填写）**

| 项 | 值 |
|---|---|
| Java 源码最后一次变更（`src/**/*.java`） | `4fad557f`（中文化冻结提交，也是 `contentSha256` 漂移的来源） |
| P0 起点的 HEAD | `99335fceb22988eb5dfe33b2c55d8bd09fbba146`（`99335fce`） |
| 冻结基线 | 831 文件 / 77,840 行；`contentSha256=7e36b9a5c7c9de15382259418b0941b8ae6cffb47c543946889c9f788beda6a4` |
| P4 tag 名 | `java-frozen-<P3 提交的 short sha>`（P4 第一步用**当时**的 `git rev-parse --short HEAD` 命名；该提交仍含完整 `src/**`） |

**第 2 步：删除**

```powershell
git rm -r src/net tools/golden/src test
git rm -r src/textures src/fonts src/shaders
git rm tools/golden/golden.ps1 tools/golden/fixtures.ps1 tools/golden/format-golden.ps1 tools/golden/historical-fixtures.ps1   # D3
git mv src/tutorials datasets/tutorials                        # D4
git mv src/changelog.txt docs/changelog-java.md                # D5
```

删除后 `src/` 目录应整体消失。

**验收**

```powershell
git ls-files '*.java' | Measure-Object        # 0
git ls-files | Measure-Object                 # ≈350
pnpm verify:full                              # 绿
```

**回滚**：`git revert <commit>`，或 `git checkout java-frozen-<sha> -- src tools/golden test`。

---

### P5 — 守卫与文档收尾（0.5 d）

**新增两道门禁**

1. `tools/ts/no-java.mjs` + root script `"check:no-java"`：`git ls-files '*.java' '*.jar'` 非空即失败（白名单为空）
2. `tools/ts/repo-size.mjs` + `"size:repo"`：tracked 文件总字节断言 `< 60 MB`
3. `ci.yml` / `release.yml` 在 `pnpm test` 后追加这两步；`verify:full` 串上 `check:no-java`

**文档**

| 文件 | 改动 |
|---|---|
| `README.md:16-17` | 「Java 源码保持冻结」→「Java 树已归档至 tag `java-frozen-<sha>`（如需取回：`git checkout <tag> -- src`）」 |
| `tools/README.md` | 重写为 TS-only；Java 工具说明移入 `docs/r0/`（历史） |
| `docs/rewrite-plan.md`、`docs/refactoring-plan.md`、`docs/rewrite-plan-r1-r5.md` | 顶部加横幅：「历史方案：Java 树已于 `<commit>` 移除，文中行数/路径均为冻结基线口径」 |
| `docs/r5/upstream.md`（§2 的 `git diff` 证据） | 改为「见 tag `java-frozen-<sha>`」并保留原始 commit sha |
| `docs/r1/port-audit-file-level.md` | 指向 `--baseline` 用法（P2） |

**验收**：`pnpm verify:full && pnpm check:no-java && pnpm size:repo` 全绿；CI 两个 workflow 绿。

---

## 5. 验收矩阵

| 检查 | 命令 | 期望 |
|---|---|---|
| 全量验证 | `pnpm verify:full` | 绿（554 passed / 2 skipped 口径） |
| 审计可复现 | `node tools/ts/port-audit.mjs --baseline docs/r1/port-audit-file-level.json` | `831 / 77,840`，hash 匹配 |
| 无 Java 源码 | `git ls-files '*.java'` | 空 |
| 无 Java 二进制 | `git ls-files '*.jar'` | 空 |
| 无 Java 构建链 | `git ls-files 'gradle*' 'build.xml' 'build.gradle' 'nbproject/*' 'manifest.mf' '*.iml'` | 空 |
| 无死资产 | `Test-Path src` | `False`（或只剩 `datasets/` 搬迁结果） |
| 仓库体积 | `pnpm size:repo` | tracked < 60 MB |
| 配置可定位 | `git grep -n 'configurations/nuclearcraft'` | 全部指向 `datasets/configurations/…` |
| 历史 fixtures 不回归 | `pnpm test packages/formats` | 绿（R2.2/R2.3/R2.4 全过） |

---

## 6. 风险与缓解

| # | 风险 | 缓解 |
|---|---|---|
| R-1 | 搬迁后 Vite dev server `server.fs.allow` 拒绝 `datasets/` | `datasets/` 与 `src/` 同深度且都在仓库根，默认 workspace root 已覆盖；若 dev 报 403，在 `packages/app/vite.config.ts` 显式加 `server.fs.allow: [repoRoot]`（`build:app` 不受影响） |
| R-2 | `historical-fixtures.ps1` 取不到旧版本 | 该脚本**保留历史路径**（`src/configurations/…`）并用 `git show`/`git cat-file`，只要历史完整就可用；P1 明令不改这些字符串 |
| R-3 | `datasets/` 下 JSON 被 `.gitignore` 命中 | `/*.json` 只作用于仓库根；搬迁后跑 `git check-ignore -v` 确认 0 命中 |
| R-4 | 审计脚本删除 `src/` 后静默归零 | P2 先落地 `--baseline` 断言；顺序不可颠倒 |
| R-5 | tag 未推送就删除 | P4 第一步必须先 `git push origin java-frozen-<sha>` 成功 |
| R-6 | 期望「删了仓库就变小」 | 删除只影响新 clone 的 checkout；`.git` 历史不变。**明确不做** `git filter-repo`（重写全部 SHA，会破坏 docs 里数百处 commit/行号引用与 tag） |
| R-7 | 误删仍被引用的资产 | P1 的 `git grep` 验收 + P4 前逐项核对 §2 矩阵（`textures`/`fonts`/`shaders`/`test` 均已确认 0 代码引用） |

---

## 7. 提交切分

| # | 提交信息（建议） | 阶段 |
|---|---|---|
| 1 | `chore(audit): 刷新 R1.0d 快照并把 contentSha256 变成 CI 门禁` | P0 |
| 2 | `refactor(config): src/configurations → datasets/configurations（含 20 个测试路径）` | P1 |
| 3 | `chore(audit): port-audit 增加 --baseline，退役 R0 期 PS 脚本与 Java i18n 提取脚本` | P2 |
| 4 | `chore(java): 删除 Java 构建链与 libraries（−104 MB）` | P3 |
| 5 | `chore(java): 归档 tag java-frozen-<sha>，删除 Java 源码与死资产` | P4 |
| 6 | `chore(ci): 加 check:no-java / size:repo 门禁` | P5 |
| 7 | `docs: Java 退出收尾（README / tools / 历史方案横幅）` | P5 |

总工时 **≈3.25 人日**（其中全量验证跑 3 轮 ≈0.5 d）。

---

## 8. 明确不做

- ❌ 不重写 git 历史（`filter-repo` / `filter-branch`）
- ❌ 不改物理内核、不改测试期望、不重算黄金数据集与 fixtures
- ❌ 不清理 TS 源码里的 `*.java:行号` 出处注释（它们是移植证据）
- ❌ 不删 `patrons.txt`；`LICENSE.md`（GPLv3）必须保留
- ❌ 不移植 Java 的 GUI / GL 渲染 / VR / discord / dssl（`port-audit` 已判 `DROP`，共 400 文件 / 39,280 行）

---

## 9. 执行日志

每个阶段落地后追加一行；`pnpm verify:full` 的结论与提交号是验收依据。

| 阶段 | 提交 | `verify:full` | 备注 |
|---|---|---|---|
| P0 | _待填_ | _待填_ | `port-audit.mjs` 内置 `EXPECTED_SHA`；快照刷新到 831 / 77,840 / `7e36b9a5…`；门禁自测（改 1 行 Java → exit 1，改回 → exit 0）已通过 |
| P1 | _待填_ | _待填_ | |
| P2 | _待填_ | _待填_ | |
| P3 | _待填_ | _待填_ | |
| P4 | _待填_ | _待填_ | |
| P5 | _待填_ | _待填_ | |
