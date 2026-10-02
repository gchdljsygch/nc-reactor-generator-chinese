# R5.3 状态报告 — PWA / 离线（Service Worker）

> 计划：`docs/rewrite-plan-r1-r5.md` §8（R5.3「断网可用」）、§3 D3（Web + PWA）、
> §11.3（构建门禁）。房屋风格见 `docs/r3/README.md`：每条"通过"都要能用文中的命令复现，
> 没有实测支撑的一律标 `未验证`。
>
> **本文件是 R5.3 的唯一状态入口。**

---

## 0. 一句话结论

**R5.3 交付（可静态验证的部分）**：手写、零依赖的 Service Worker
（`packages/app/public/sw.js`）在**生产构建**里注册，导航走"网络优先 + 缓存的应用外壳兜底"，
`assets/` 下的内容哈希文件走"缓存优先"，其余同源 GET 走"stale-while-revalidate"；
离线所需的资源在**安装期**（手写清单）和**激活期**（从构建后的 `index.html` 里发现哈希资源）
两次预热，因此**不需要构建顺序耦合，也不需要把哈希文件名写死**。
选型是**方案 (a)**，理由与被否的方案 (b) 见 §3。

| 指标 | 数值 |
|---|---:|
| `packages/app` 测试 | **137 passed**（8 个文件，其中 `test/pwa.test.ts` **36 项**） |
| 构建产物（不含数据集） | **1.59 MB**（门禁 15 MB；R3 记录为 1.57 MB，本项 +约 16 kB） |
| `dist/sw.js` | 8,346 B，与 `public/sw.js` **逐字节相同**（门禁会校验） |
| 新增图标（1 SVG + 2 PNG）/ manifest / worker | 5,946 B / 856 B / 8,346 B（合计 15,148 B，远低于任务的 1 MB 上限） |
| 新增运行时/构建依赖 | **0**（`pnpm-lock.yaml` 的 SHA256 未变化） |

```powershell
pnpm install --frozen-lockfile   # 依赖不变
pnpm build:app                   # Vite 生产构建（--base=./）
pnpm size                        # §11.3 体积门禁
pnpm pwa:check                   # R5.3 构建门禁：离线契约是否真的进了 dist/
npx vitest run packages/app      # 含 test/pwa.test.ts 的 36 项
node tools/ts/make-icons.mjs     # 重新生成图标（确定性，见 §4.4）
```

**未验证**：真实浏览器里的 install/activate/fetch 行为、"访问一次后真的断网可用"、
iOS 的 manifest/apple-touch-icon 细节。**本环境不能运行浏览器**，所以 §2 的证据是
"契约单测 + 对构建产物的静态门禁"，不是真机实测 —— 详见 §5。

---

## 1. 交付物与落点

| 文件 | 作用 | 证据 |
|---|---|---|
| `packages/app/public/manifest.webmanifest` | 应用清单：`name` / `short_name` / `start_url` / `display: standalone` / `theme_color` / `background_color` / 4 条 icon | `pnpm pwa:check` 校验必需字段、`display`、图标文件存在且签名与声明一致 |
| `packages/app/public/icons/icon.svg` | 手写矢量图标 | `pwa:check` 校验 SVG；与 PNG 同一套几何常量（见文件注释） |
| `packages/app/public/icons/icon-192.png`、`icon-512.png` | 位图图标（795 B / 3,738 B） | `node tools/ts/make-icons.mjs` 确定性生成；`pwa:check` 校验 IHDR 尺寸 |
| `tools/ts/make-icons.mjs` | 图标生成器（手写 PNG：`node:zlib` + IHDR/IDAT/IEND/CRC32，无依赖） | 重跑两次 SHA256 相同（§4.4） |
| `packages/app/src/pwa.ts` | 路由契约 `cacheStrategyFor()` + 注册 `installOfflineSupport()`（永不抛） | `test/pwa.test.ts`：路由 12 项 + 注册 7 项 |
| `packages/app/public/sw.js` | 手写 Service Worker（Vite 原样拷贝到 `dist/`） | `test/pwa.test.ts` 用桩作用域**执行真实文件**（17 项，含 install/activate/离线回退/`waitUntil` 时序）；`pwa:check` 校验 `dist/sw.js` 与它逐字节相同 |
| `packages/app/index.html` | 引用 manifest、`theme-color`、图标；用一个内联 module script 调用 `installOfflineSupport()` | `pwa:check` 校验链接与"无根绝对路径" |
| `tools/ts/pwa-build-check.mjs` | 构建门禁：把上面这些断言成 `exit 0/1` | §4.3 的 18 项输出，负向对照见 §4.5 |
| `package.json` | `build:app` 加 `--base=./`；新增 `icons` / `pwa:check`；`verify:full` 串联 `pwa:check` | §4.1 的命令与输出 |

`index.html` 里的那一行是**唯一**的接线点：

```html
<script type="module">
  import { installOfflineSupport } from './src/pwa.ts';
  installOfflineSupport();
</script>
```

之所以不写在 `src/main.ts`：该文件属于另一条工作流（R3），改它会冲突。Vite 会把这段内联
module script 与主入口合并进同一个 chunk，所以**没有多一次请求**；构建产物里可以看到
`po();` 就出现在主 chunk 的顶层（§4.3 的静态门禁同时校验"注册分支还活着"）。

---

## 2. 缓存路由契约（唯一一张表）

`cacheStrategyFor()`（`src/pwa.ts`）就是这张表；`public/sw.js` 的 `strategyFor()` 是它在
运行时的同一份实现。

| 请求 | 策略 | 为什么 |
|---|---|---|
| 非 `GET`（保存/上传等） | `ignore`（不 `respondWith`） | 完全交给浏览器，SW 不参与 |
| 带 `Range` 头 | `ignore` | 206 分段响应不能进 Cache Storage |
| 跨源（CDN 等） | `ignore` | 缓存别人的源没有意义，也无法保证完整性 |
| `data:` / 非 http(s) | `ignore` | 不可缓存 |
| 文档导航（`mode === 'navigate'`） | `app-shell`：**网络优先**，失败回 `index.html` | 在线时立刻拿到新版本；离线时打开应用外壳 |
| `<scope>/assets/**`（内容哈希） | `cache-first` | 文件名带哈希 ⇒ 命中永远不会过期，省一次网络往返 |
| 同源其它 GET（manifest、图标） | `stale-while-revalidate` | 文件名稳定，先给旧的、后台刷新 |

**两层证据，互为防漂移**：

1. `cacheStrategyFor()` —— 纯函数，10 条路由逐条断言（含根路径与深链导航各一条）；
2. `public/sw.js` —— 测试用 `new Function` 把它放进一个**桩 worker 作用域**
   （`self` / `caches` / `fetch`，都是手写的假实现），**从行为反推**策略：
   把缓存里塞 `cached`、网络回 `network`，再看它返回谁、有没有打网络 —— 四种策略因此
   可以被唯一区分（`cache-first`＝只用缓存；`app-shell`＝返回网络；`stale-while-revalidate`
   ＝返回缓存**并且**打了网络；`ignore`＝没调 `respondWith`）。
   同一条路由，两张表必须给出同一个答案；任何一边改了策略，测试就红。

> 这就是"两份实现"这个味道不对的地方的**机械兜底**：worker 不能 `import` 这个 TS 模块
> （Vite 原样拷贝 `public/`，而 R5.3 选择不加构建步骤去改写它，见 §3），所以用测试把两者钉在一起，
> 而不是靠注释提醒。

### 2.1 "访问一次后断网可用"的静态论证

浏览器的 Service Worker 生命周期里有三个众所周知的坑，这里逐条对上：

| 坑 | 本实现 |
|---|---|
| 首次访问时 SW 还没接管页面，`fetch` 不会被拦截 | `install` 里 `skipWaiting()`、`activate` 里 `clients.claim()`，且**安装期就写缓存**（不依赖拦截） |
| 哈希文件名无法手写进预缓存清单 | `activate` 里 `fetch('./index.html')` → 正则取 `<script src>` / `<link href>` → 只保留同源且落在 `assets/` 的 → 逐个 `cache.add` |
| 导航请求离线时没有响应 | `respondWith` 的 `app-shell` 分支回退到缓存的 `./index.html`；每次在线导航还会把最新 HTML 覆盖进缓存 |

`pnpm pwa:check` 校验的就是这条链路的**输入**：`dist/index.html` 里发现的
`assets/` 引用**确实存在**于构建产物中（§4.3）。真机实测仍是 `未验证`（§5）。

---

## 3. 方案 (a) 还是 (b)？—— 选 (a)，理由与代价

| | (a) `public/sw.js` 按需缓存 + 自发现预热 | (b) `tools/ts/` 里加构建后步骤，把哈希清单写进 `dist/sw.js` |
|---|---|---|
| 构建顺序耦合 | **无**（`public/` 原样拷贝，`dist/sw.js` 与源码逐字节相同） | 有：必须严格排在 `vite build` **之后**，否则写的是下一次构建前的旧文件 |
| 新增机制 | 无 | 一个改写已生成产物的脚本 + 一次额外的失败模式（写坏了 SW，网站就彻底白屏） |
| 可审查性 | `git diff` 里的 `sw.js` 就是线上跑的东西 | 线上跑的是"源码 + 未提交的注入结果" |
| 首次离线的强度 | 安装期清单（手写文件名）+ 激活期自发现哈希资源 ⇒ 一次访问即完整 | 同样完整，但依赖构建步骤成功 |
| 代价 | 需要解析自己的 `index.html`（~15 行正则，只认自己的产物）；`CACHE_VERSION` 要手动 bump 才清旧缓存 | — |

**结论：选 (a)**。计划 §8 允许两者；R3 已经确立"每条产物都有命令、越少机制越好"的风格，
(b) 的全部收益（预缓存一份哈希清单）已经被"激活期自发现"拿到，而它引入的构建顺序耦合是
CI 里最容易悄悄失效的那一类。**代价照实说**：`CACHE_VERSION` 是手动开关（`sw.js` 顶部），
忘了 bump 时旧缓存不会被清理 —— 但 `assets/` 的哈希文件名让这最多影响 manifest/图标一类
稳定文件名，且 `stale-while-revalidate` 会在后台刷新它们。

---

## 4. 复现命令与实测输出

以下输出均为本机（Windows / Node 22 / pnpm 11.5.1）实跑结果。
（模块数与 `assets/` 的文件名哈希由内容决定，会随工作树变化；下面的数字是本文档成文时的一次实跑。）

### 4.1 构建与体积（§11.3）

```console
$ pnpm build:app
vite v5.4.21 building for production...
✓ 82 modules transformed.
dist/index.html                                  1.21 kB │ gzip:   0.67 kB
dist/assets/nuclearcraft.ncpf-C6cD-xj2.json  1,261.78 kB │ gzip: 487.52 kB
dist/assets/index-Cg8D6bYi.css                   5.94 kB │ gzip:   1.80 kB
dist/assets/index-DgYd2Ypk.js                1,631.26 kB │ gzip: 591.00 kB
✓ built in 753ms

$ pnpm size
size-check: packages/app/dist
    1.57 MB  assets\index-DgYd2Ypk.js
     8.2 kB  sw.js
     5.8 kB  assets\index-Cg8D6bYi.css
     3.7 kB  icons\icon-512.png
     1.4 kB  icons\icon.svg
     1.2 kB  index.html
     856 B  manifest.webmanifest
     795 B  icons\icon-192.png
  —————————
  assets   : 1.59 MB  (budget 15.00 MB)
  datasets : 1.20 MB  (excluded)
  total    : 2.79 MB
size-check passed
```

`build:app` 加了 `--base=./`（见 `docs/r5/release.md` §3）：项目站点的 URL 是
`https://<user>.github.io/<repo>/`，根绝对路径（`/assets/…`、`/sw.js`）在那里会 404。

### 4.2 单元测试

```console
$ npx vitest run packages/app
 ✓ packages/app/test/pwa.test.ts (36 tests) 31ms
 Test Files  8 passed (8)
      Tests  137 passed (137)
```

`lint`（R3 的裸字符串/依赖方向门禁）：

```console
$ node tools/ts/lint.mjs
dependency direction
  OK — no core package imports a UI/i18n layer
bare strings in core packages
  0 prose literals, 0 baselined

lint passed
```

> **`pnpm typecheck` 的现场状态（诚实记录）**：本项提交时它**整体是红的**，
> 但 `packages/app/**` 与 `tools/**` 的错误数是 **0**；报错全部来自另一条工作流正在写的
> `packages/generator/**`（34 条）与 `packages/kernel/src/fast.ts`（1 条），这两个位置本项
> **不许改**（见任务书约束）。复现：
> `pnpm typecheck 2>&1 | Select-String 'error TS'`。等 R4 工作流落地后应复跑。

### 4.3 PWA 构建门禁

```console
$ node tools/ts/pwa-build-check.mjs
pwa-build-check: packages\app\dist
  ok   dist/sw.js exists
  ok   dist/sw.js is the reviewed public/sw.js verbatim
  ok   dist/manifest.webmanifest is valid JSON
  ok   manifest has every member R5.3 requires
  ok   manifest display is standalone
  ok   manifest declares at least two icons
  ok   icon ./icons/icon.svg is an SVG
  ok   icon ./icons/icon-192.png is a 192x192 PNG
  ok   icon ./icons/icon-512.png is a 512x512 PNG
  ok   icon ./icons/icon-512.png is a 512x512 PNG
  ok   dist/index.html links the manifest
  ok   dist/index.html sets a theme color
  ok   index.html uses no root-absolute src/href (project Pages path)
  ok   the worker can discover the hashed assets from index.html
  ok   every index.html reference exists in the build
  ok   the build contains the registration call
  ok   the build contains the worker URL
  ok   Vite replaced import.meta.env (no survivors in the bundle)
  18/18 checks passed
pwa-build-check passed
```

最后一条是关键：Vite 的 `define` 把 `import.meta.env.PROD` 静态替换成 `true`，
而且**把裸的 `import.meta.env` 替换成 `undefined`**（见 `vite/dist/node` 的 `resolveDefine`），
所以 `src/pwa.ts` 里必须写成字面量成员表达式 `import.meta.env.PROD`，
写成 `const env = import.meta.env; env.PROD` 在生产里会静默变成 `undefined`。构建产物中：

```js
const Go="./sw.js";function Yo(){try{return!0}catch{return!1}}function po(){try{if(typeof navigator>"u"||!("serviceWorker"in navigator)||!Yo())return;navigator.serviceWorker.register(Go).catch(Sa)}catch(t){Sa(t)}}po();
```

### 4.4 图标确定性

```console
$ node tools/ts/make-icons.mjs
make-icons: wrote …\packages\app\public\icons\icon-192.png (795 bytes, 192x192)
make-icons: wrote …\packages\app\public\icons\icon-512.png (3738 bytes, 512x512)
# 重跑一次后 SHA256：
EA532A27D612568D47D813AF5D18E93ECDCA873565C257774C05564262225CB5  icon-512.png   （两次相同）
```

### 4.5 门禁的负向对照（证明它真的会红）

```console
$ Copy-Item -Recurse packages/app/dist .tmp-pwa-negative
$ Add-Content .tmp-pwa-negative/sw.js "`n// tampered"
$ # 并删掉 index.html 里的 theme-color
$ node tools/ts/pwa-build-check.mjs .tmp-pwa-negative
  FAIL dist/sw.js is the reviewed public/sw.js verbatim — sha256 0bc21010… != 44a18bf7…
  FAIL dist/index.html sets a theme color — no theme-color meta
  16/18 checks passed
pwa-build-check FAILED (2)          # exit 1
```

第二种负向对照是**真实发生过的**：修好 §4.6 的 `waitUntil` 缺陷后只重跑了单测、没重新构建，
门禁立刻红：

```console
$ node tools/ts/pwa-build-check.mjs        # dist/sw.js 还是上一版
  17/18 checks passed
pwa-build-check FAILED (1)
  dist/sw.js is the reviewed public/sw.js verbatim: sha256 44a18bf7… != 87b394a8…
$ pnpm build:app && node tools/ts/pwa-build-check.mjs
  18/18 checks passed
pwa-build-check passed
```

### 4.6 本次抓到的两个真实缺陷（都有回归测试 / 门禁）

1. **`waitUntil` 在异步回调里调用** —— `stale-while-revalidate` 分支原本把
   `event.waitUntil(revalidation)` 写在 `caches.match(...).then(...)` 内部。
   规范里 `ExtendableEvent.waitUntil()` 在事件派发结束后再调用会抛
   `InvalidStateError`（Chrome 的行为也是这个），于是后台刷新没人"保命"，
   随时可能被浏览器掐掉，而且会留下一个未处理的 Promise 拒绝。
   修法：在 `fetch` 处理器里**同步**调用；回归测试
   `test/pwa.test.ts › extends the event lifetime synchronously` 在
   `dispatchFetch` 之后**不 await** 就断言 `waitUntil` 已被调用 —— 旧写法必然红。
   这条正是"没有浏览器就测不出真行为"的反例：它恰好可以在桩作用域里钉住。
2. **`import.meta.env.PROD` 必须是字面量成员表达式** —— Vite 的 `define` 在构建时把
   `import.meta.env.PROD` 换成 `true`，同时把**裸的** `import.meta.env` 换成 `undefined`
   （`vite/dist/node` 的 `resolveDefine`）。因此"先取对象再读属性"
   （`const env = import.meta.env; env.PROD`）在生产构建里会变成 `undefined`，
   注册分支永远不会执行，而且**本地测试全绿也发现不了**。
   修法：`src/pwa.ts` 里直接写 `import.meta.env.PROD`（并在注释里写明原因）；
   门禁里加了一条"bundle 中不得残留 `import.meta.env`"的断言（§4.3 最后一行）。

---

## 5. 未验证清单（诚实）

1. **真实浏览器行为全部未验证**：`install` / `activate` / `fetch` 的真实时序、
   `clients.claim()` 之后首次访问的拦截范围、Cache Storage 配额与清理策略。
   本环境不能运行浏览器，替代证据是 §2 的桩作用域单测（执行的是真实 `sw.js` 文件）。
2. **"访问一次后断网可用"是静态论证 + 仿真，不是真机实测**（§2.1）。要闭环必须在浏览器里
   按 §6 走一遍。
3. **iOS / Safari**：`display: standalone` 的细节、`apple-touch-icon` 的取用、
   iOS 对 Cache Storage 的淘汰策略，均未验证。
4. **安装提示（`beforeinstallprompt`）没有做**：没有自定义安装按钮，也没有"可安装"提示。
5. **更新提示没有做**：新版本的 SW 会在 `activate` 后立即接管（`skipWaiting` + `claim`），
   当前页面不会自动重载，也没有"有新版本，点击刷新"的 UI。这对本地应用是可接受的取舍
   （用户下次打开即是新版），但**没有做**这件事本身要记下来。
6. **manifest 不随语言变化**：`name` / `description` 是英文常量；按 locale 出多份 manifest
   不在 R5.3 范围内。
7. **`CACHE_VERSION` 是手动开关**（见 §3 的代价）。
8. **Lighthouse / 安装性评分未跑**（没有浏览器，也没有把 Lighthouse 加进依赖）。

---

## 6. 手工验收步骤（需要浏览器，本环境做不到）

Service Worker **只在生产构建、且用 http(s) 打开时**才注册（`file://` 不行，
`vite` 开发服务器也不算生产构建），所以：

```powershell
pnpm build:app
python -m http.server 8080 -d packages/app/dist     # 或任意静态服务器
# 打开 http://localhost:8080/
```

1. **注册**：DevTools ▸ Application ▸ Service Workers —— 应为 `activated and is running`。
2. **缓存**：Application ▸ Cache Storage —— 应有两个缓存
   `ncplanner-shell-v1`（含 `./index.html`、manifest、图标）与 `ncplanner-assets-v1`
   （含 `assets/index-*.js`、`assets/index-*.css`）。
3. **清单**：Application ▸ Manifest —— 名称 `NC Plannerator`、`standalone`、
   192/512 图标都能显示。
4. **离线**：勾上 Application ▸ Service Workers ▸ Offline（或断网），**刷新** —— 应用仍应打开，
   2D/3D 视图、统计面板可交互；这正是计划 §8 R5.3 的验收栏「断网可用」。
5. **深链**：直接访问 `http://localhost:8080/`（无路径）离线刷新，也应回落到应用外壳。
