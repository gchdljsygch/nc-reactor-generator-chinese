# R5.5 状态报告 — 发布流水线（CI → GitHub Pages 静态站点）

> 计划：`docs/rewrite-plan-r1-r5.md` §8（R5.5「发布流水线（CI → 静态站点 + 可选桌面壳）／
> 一键发布」）、§3 D3（**Web + PWA**，桌面壳按需后加）、§11.3（构建门禁）。
> 房屋风格见 `docs/r3/README.md`：每条"通过"都要能用文中的命令复现，没有实测支撑的标 `未验证`。
>
> **本文件是 R5.5 的唯一状态入口。**

---

## 0. 一句话结论

**R5.5 交付（可静态验证的部分）**：`.github/workflows/release.yml` 在默认分支
`overhaul` 有 push（或 Actions 页手动 `workflow_dispatch`）时，按
**install → typecheck → lint → 测试 → 构建 → 体积门禁 → PWA 构建门禁 → 上传 artifact →
部署 GitHub Pages** 执行；部署是**纯静态站点**（`actions/upload-pages-artifact` +
`actions/deploy-pages`），**没有任何服务器**。

**可选桌面壳（Tauri / PWA 包装）没有实现，本仓库里一行相关代码、一个相关依赖都没有**
—— D3 的选择是 "Web + PWA，桌面壳按需后加"，本文档不暗示它可用（§4）。

| 指标 | 数值 |
|---|---:|
| 工作流文件 | `.github/workflows/release.yml`（2 个 job，11 + 4 步） |
| 触发 | `push: overhaul`、`workflow_dispatch` |
| 部署方式 | 静态站点（Pages artifact），无服务器、无运行时 |
| 新增依赖 | **0**（`pnpm install --frozen-lockfile` 通过，lockfile SHA256 未变） |
| 本地可复现的部分 | §3 的 `pnpm verify` / `build:app` / `size` / `pwa:check` |

**未验证**：真实 GitHub 仓库上的一次 Pages 部署（本环境无法运行 Actions、也无法访问网络）。
上线前必须做的一次性人工设置见 §2，上线后的人工验收清单见 §6。

---

## 1. 流水线结构

```text
push overhaul ─┐
workflow_dispatch ─┤
                   ▼
        job: build（ubuntu-latest / 30 min）
          checkout → pnpm 11 → node 22（cache: pnpm）
          install --frozen-lockfile
          typecheck → lint → test（NCPL_GOLDEN=full）
          build:app（--base=./）
          size（§11.3 体积门禁）
          pwa:check（R5.3 离线构建门禁）
          upload-artifact: nc-plannerator-web ← packages/app/dist
                   ▼
        job: deploy（needs: build / environment: github-pages）
          download-artifact → configure-pages@v5
          upload-pages-artifact@v3 ← packages/app/dist
          deploy-pages@v4
```

| 关注点 | 落点 | 说明 |
|---|---|---|
| 触发分支 | `on.push.branches: [overhaul]` | `overhaul` 是本 fork 的默认分支（`git symbolic-ref refs/remotes/origin/HEAD` → `refs/remotes/origin/overhaul`） |
| 手动触发 | `workflow_dispatch` | 计划要求的"一键发布" |
| 权限 | 顶层 `contents: read`；`deploy` job 单独 `pages: write` + `id-token: write` | 最小权限；Pages 的 OIDC 只需要这两个 |
| 并发 | `group: pages`，`cancel-in-progress: false` | 同时只允许一次部署，且**不打断**进行中的部署 |
| 环境 | `environment: github-pages`，`url: ${{ steps.deployment.outputs.page_url }}` | 部署完成后 Actions 页面直接给出站点地址 |
| 产物 | `actions/upload-artifact@v4`（`nc-plannerator-web`，留 14 天） | 即使部署失败，也能下载构建产物排查 |
| 无服务器 | 没有任何 `runs-on` 之外的服务进程、没有 Docker、没有 Pages 之外的主机 | §8.2 的"静态站点"要求 |

工作流注释里写了 action 大版本的选择依据（与 `ci.yml` 同代）与一次性设置要求；
版本要**刻意**升，不要顺手升。

> **后续一行改动（本项未做）**：`.github/workflows/ci.yml` 目前只跑
> `build:app` + `size`，没有跑 `pnpm pwa:check`。把这一行加进 CI 就能让 R5.3 的离线契约
> 在**每个 push** 上把关，而不是只在发布时；该文件属于其他工作流（不在本项的允许改动清单里），
> 所以留给它的 owner。本地已经通过 `verify:full` 串上（见 §1 的 `package.json` 行）。

---

## 2. 一次性人工设置：Pages 的 Source 必须是 "GitHub Actions"

**这一步在仓库里做不到，必须在网页上点一次**：

> Settings ▸ Pages ▸ Build and deployment ▸ **Source = GitHub Actions**

否则 `deploy-pages` 会以 `Get Pages site failed` / HTTP 404 失败（Pages 默认走
"Deploy from a branch"，此时仓库里并不存在 `gh-pages` 分支）。
**未验证**：本环境无法访问该仓库的设置页，因此这条设置的状态无法在此确认。

---

## 3. 为什么构建要加 `--base=./`（以及它对部署的影响）

项目站点的地址是 `https://gchdljsygch.github.io/nc-reactor-generator-chinese/`，
**不是**域根。Vite 默认 `base: '/'`，会产出 `/assets/index-*.js` 这类根绝对路径 ——
在项目站点下全部 404（连同 `/sw.js`、`/manifest.webmanifest`）。

因此：

| 位置 | 写法 | 原因 |
|---|---|---|
| `package.json` 的 `build:app` | `vite build --config packages/app/vite.config.ts --base=./` | 让所有产物 URL 变成相对路径；`vite.config.ts` 属于其他工作流，不动它 |
| `index.html` | `./manifest.webmanifest`、`./icons/icon.svg` | 相对路径在域根与项目路径下都对 |
| `src/pwa.ts` | `SERVICE_WORKER_URL = './sw.js'`，且不传 `scope` | 相对注册；默认作用域就是 worker 所在目录（= 部署根），不需要 `Service-Worker-Allowed` 头 |
| `public/sw.js` | `assets/` 目录由 `self.registration.scope` 推导 | 项目站点下哈希资源在 `/<repo>/assets/`，写死 `/assets/` 会漏掉 |

`tools/ts/pwa-build-check.mjs` 里有一条断言专门盯这件事：
**`dist/index.html` 不得出现任何根绝对的 `src`/`href`**（§4.2）。

---

## 4. 桌面壳：明确**未实现**

计划原文是「CI → 静态站点 + **可选**桌面壳」，D3 的结论是「**Web + PWA**，桌面壳
（Tauri/PWA 包装）按需后加」（`docs/rewrite-plan-r1-r5.md` §3 D3、§12 D3）。

如实说明：

- 仓库里**没有** Tauri / Electron / Capacitor 的配置、脚本或依赖；
- `pnpm-lock.yaml` 里**没有**任何桌面壳相关包；
- 本文档**不**声称可以打出 `.exe` / `.dmg` / `.AppImage`；
- 现在能"像应用一样用"的路径只有一条：**浏览器/PWA 安装**（`display: standalone`
  的 manifest + Service Worker，见 `docs/r5/offline.md`）。这条路径本身也仍是
  `未验证`（没有真机浏览器）。

将来要做桌面壳，最小改动面是：给 `packages/app/dist` 套一个 Tauri 工程 —— 产物已经是
纯静态、相对路径、可离线，这正是把 `--base=./` 与 PWA 一起做的原因；但那是一个新的
工作项（新依赖、新签名/发布流程），不在 R5.5 内。

---

## 5. 复现命令与实测输出

工作流本身只能在 GitHub 上跑（**未验证**，§7），但它包含的每一步都可以在本机跑；
本机输出如下（Windows / Node 22 / pnpm 11.5.1）。模块数与产物文件名哈希随工作树变化，
数字是成文时的一次实跑。

### 5.1 依赖与锁文件（"没有新增依赖"的证据）

```console
$ pnpm install --frozen-lockfile
Scope: all 7 workspace projects
Already up to date
Done in 254ms using pnpm v11.5.1

# 运行前后 pnpm-lock.yaml 的 SHA256：
F3ABBF17F81B6B605E9CD091E3A506B3CA24976892F9ECD6EE9B44E0BABDE906   （未变化）
```

### 5.2 流水线里除部署以外的每一步

```console
$ pnpm lint
lint passed

$ pnpm test -- packages/app        # 等价于 npx vitest run packages/app
 Test Files  8 passed (8)
      Tests  137 passed (137)

$ pnpm build:app
✓ 82 modules transformed.
✓ built in 753ms

$ pnpm size
  assets   : 1.59 MB  (budget 15.00 MB)
  datasets : 1.20 MB  (excluded)
size-check passed

$ pnpm pwa:check
  18/18 checks passed
pwa-build-check passed
```

> **`pnpm typecheck`（流水线的第 2 步）本机当前是红的**，但与本项无关：
> 报错全部在另一条工作流正在写的 `packages/generator/**`（34 条）与
> `packages/kernel/src/fast.ts`（1 条），`packages/app/**`、`tools/**` 为 0 条；
> 这两个位置本项不许改。**这也意味着 release.yml 现在会在这两步上失败 —— 这是仓库
> 当前的真实状态，不是工作流的问题。** 复现：
> `pnpm typecheck 2>&1 | Select-String 'error TS'`。

### 5.3 YAML 语法检查

```console
$ python -c "import yaml;d=yaml.safe_load(open('.github/workflows/release.yml',encoding='utf-8'));print(list(d.keys()),d[True],list(d['jobs']),len(d['jobs']['build']['steps']),len(d['jobs']['deploy']['steps']))"
['name', True, 'permissions', 'concurrency', 'jobs'] {'push': {'branches': ['overhaul']}, 'workflow_dispatch': None} ['build', 'deploy'] 11 4
```

（PyYAML 把 YAML 1.1 的 `on:` 键读成 `True`，这是 PyYAML 的已知行为，不是文件的问题。）

---

## 6. 上线后的人工验收清单（需要真实仓库）

1. Actions 页出现 `Release (GitHub Pages)` 运行记录；`build` job 全绿。
2. `deploy` job 的 environment 卡片上有站点 URL。
3. 打开 `https://gchdljsygch.github.io/nc-reactor-generator-chinese/`：
   页面正常、DevTools 里 `sw.js` 注册成功、Application ▸ Manifest 显示 `NC Plannerator`。
4. 断网刷新仍能打开（R5.3 的验收栏）。
5. 再推一次 `overhaul`，站点内容更新（哈希文件名变化 ⇒ 缓存自动失效）。

---

## 7. 未验证清单（诚实）

1. **工作流没有在真实 GitHub 上跑过**：本环境不能执行 Actions，也无法访问网络。
   YAML 语法已用 PyYAML 解析（§5.3），步骤命令已逐条在本机跑过（§5.2），
   但"Green run + 上线"这件事**未验证**。
2. **Pages Source 的一次性设置未确认**（§2），它是首次部署成功的前提。
3. **action 的大版本未在真实 runner 上验证**：`configure-pages@v5` /
   `upload-pages-artifact@v3` / `deploy-pages@v4` / `upload-artifact@v4` /
   `download-artifact@v4` 是按当前 GitHub Pages 部署三件套写的（与 `ci.yml` 同代），
   若上游发布新主版本需刻意升级。
4. **桌面壳未实现**（§4），因此"可选桌面壳"这一半的验收无处可谈。
5. **`pnpm typecheck` 当前整体为红**（§5.2，原因属于 R4 工作流），
   以现状推送会停在 `typecheck` 一步 —— 这是必须由 R4 侧清零的前置条件。
6. **上传/部署的配额与保留策略未实测**：Pages 站点 1 GB / 每月 100 GB 流量、
   artifact 保留 14 天（工作流里写死）都是平台常量，未在此环境验证。
