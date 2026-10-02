/**
 * R5.3 — PWA / offline support: the *app* half of the service worker.
 *
 * Two things live here, and nothing else:
 *
 *  1. `cacheStrategyFor` — the cache-routing **contract**. It is a pure function
 *     over a small request descriptor, so it can be asserted in Node with no
 *     browser (see `packages/app/test/pwa.test.ts`). The runtime implementation
 *     of the same table is `packages/app/public/sw.js`; the service worker cannot
 *     import this file (Vite copies `public/` verbatim, and the R5.3 choice was
 *     *not* to add a build step that rewrites the worker — see
 *     `docs/r5/offline.md`), so the test drives the shipped `sw.js` in a sandbox
 *     and asserts both implementations agree route by route. Drift fails CI.
 *  2. `installOfflineSupport` — registration, deliberately paranoid: production
 *     build only, `serviceWorker` supported only, and it never throws. A planner
 *     that cannot cache itself must still open.
 *
 * Deliberately **not** here: anything that touches `main.ts`. That file is owned
 * by another workstream, so registration is wired from `index.html` as its own
 * module script (one extra chunk, no import cycle, no edit to the entry point).
 */

/**
 * The worker's URL, resolved **relative to the page**, and without an explicit
 * `scope`: the default scope is the worker's own directory, which is the deploy
 * root. Both matter for the GitHub Pages project site, which is served from
 * `/<repo>/` rather than `/` (see `docs/r5/release.md`) — `/sw.js` would 404 there.
 */
export const SERVICE_WORKER_URL = './sw.js';

/** Where Vite puts content-hashed, immutable files (its `build.assetsDir`). */
export const DEFAULT_ASSET_DIR = '/assets/';

declare global {
  interface ImportMeta {
    /**
     * Vite's build-time environment object.
     *
     * Declared by hand, not via `/// <reference types="vite/client" />`: `vite` is
     * not a declared dependency (it arrives through `vitest`), so under pnpm's
     * strict layout that reference does not resolve — the same constraint
     * documented in `packages/app/vite.config.ts`.
     */
    readonly env: { readonly PROD: boolean; readonly DEV: boolean; readonly MODE: string };
  }
}

/** What the worker should do with a request. */
export type CacheStrategy =
  /** Not ours, or not safely cacheable: do not call `respondWith` at all. */
  | 'ignore'
  /** A document navigation: network first, cached app shell when offline. */
  | 'app-shell'
  /** Content-hashed file under the asset directory: cache first (immutable). */
  | 'cache-first'
  /** Everything else same-origin (manifest, icons): cached copy + background refresh. */
  | 'stale-while-revalidate';

/** The subset of `Request` the routing decision needs. */
export interface RoutedRequest {
  /** HTTP method; anything but `GET` is ignored. */
  readonly method: string;
  /** Absolute request URL. */
  readonly url: string;
  /** `'navigate'` for a document navigation, as in the Fetch API. */
  readonly mode?: string;
  /** The app's origin; defaults to the URL's own origin (then it never mismatches). */
  readonly origin?: string;
  /** Absolute URL of the asset directory; defaults to `<origin>/assets/`. */
  readonly assetBase?: string;
  /** `true` when a `Range` header is present (partial responses are not cached). */
  readonly hasRangeHeader?: boolean;
}

function isHttpProtocol(protocol: string): boolean {
  return protocol === 'http:' || protocol === 'https:';
}

/**
 * The routing table. Keep in sync with `strategyFor` in `public/sw.js` — the
 * contract test asserts the two agree, so a change in one place is a red test.
 */
export function cacheStrategyFor(request: RoutedRequest): CacheStrategy {
  if (request.method.toUpperCase() !== 'GET') return 'ignore';
  if (request.hasRangeHeader === true) return 'ignore';
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return 'ignore';
  }
  if (!isHttpProtocol(url.protocol)) return 'ignore';
  const origin = request.origin ?? url.origin;
  if (url.origin !== origin) return 'ignore';
  if (request.mode === 'navigate') return 'app-shell';
  const assetBase = request.assetBase ?? new URL(DEFAULT_ASSET_DIR, `${origin}/`).href;
  if (url.href.startsWith(assetBase)) return 'cache-first';
  return 'stale-while-revalidate';
}

/** True only in a Vite **production build**. */
export function isProductionBuild(): boolean {
  try {
    // This exact member expression is load-bearing. Vite's define replaces
    // `import.meta.env.PROD` with `true` at build time and replaces a *bare*
    // `import.meta.env` with `undefined` (see `resolveDefine` in
    // vite/dist/node) — so `const env = import.meta.env; env.PROD` would be a
    // silent `undefined` in production. Outside Vite (plain Node, SSR) the read
    // throws, and a failed check must mean "do not register", not "crash boot".
    return import.meta.env.PROD === true;
  } catch {
    return false;
  }
}

/** The smallest slice of `Navigator` registration needs. */
export interface OfflineNavigator {
  readonly serviceWorker?: {
    readonly register: (scriptURL: string) => Promise<unknown>;
  };
}

export interface RegisterOfflineSupportOptions {
  /** Caller-supplied production flag (`isProductionBuild()` in the app). */
  readonly production: boolean;
  /** Defaults to the real `globalThis.navigator`. */
  readonly navigator?: OfflineNavigator;
  /** Defaults to `reportOfflineError`. */
  readonly onError?: (error: unknown) => void;
}

function browserNavigator(): OfflineNavigator | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return navigator;
}

/** Developer-facing diagnostics only; `console` may itself be missing. */
function reportOfflineError(error: unknown): void {
  try {
    console.warn('[pwa] offline support unavailable:', error);
  } catch {
    /* Nothing left to report with. */
  }
}

/** The registration gate, as a pure predicate: production **and** supported. */
export function shouldRegisterOfflineSupport(
  production: boolean,
  nav: OfflineNavigator | undefined,
): boolean {
  if (!production) return false;
  if (nav === undefined) return false;
  if (!('serviceWorker' in nav)) return false;
  return typeof nav.serviceWorker?.register === 'function';
}

/**
 * Registers the worker and reports whether registration was attempted. **Never
 * rejects and never throws** — a failure to cache is not a failure to run.
 * Injectable (`production`, `navigator`, `onError`) so the contract is testable
 * in Node without a browser.
 */
export async function registerOfflineSupport(
  options: RegisterOfflineSupportOptions,
): Promise<boolean> {
  const onError = options.onError ?? reportOfflineError;
  try {
    const nav = options.navigator ?? browserNavigator();
    if (!shouldRegisterOfflineSupport(options.production, nav)) return false;
    const registry = nav === undefined ? undefined : nav.serviceWorker;
    if (registry === undefined) return false;
    await registry.register(SERVICE_WORKER_URL);
    return true;
  } catch (error) {
    onError(error);
    return false;
  }
}

/**
 * The shipped entry point: a no-op unless this is a production build **and**
 * `'serviceWorker' in navigator`, and a no-op in tests/SSR (no `navigator`, or no
 * `serviceWorker` on it). Returns `void` on purpose — the caller (a module script
 * in `index.html`) must not be able to observe, let alone propagate, a failure.
 */
export function installOfflineSupport(): void {
  try {
    if (typeof navigator === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (!isProductionBuild()) return;
    // Fire and forget: awaiting here would delay nothing (modules are deferred),
    // but an unhandled rejection is exactly what "never throws" forbids.
    void navigator.serviceWorker.register(SERVICE_WORKER_URL).catch(reportOfflineError);
  } catch (error) {
    reportOfflineError(error);
  }
}
