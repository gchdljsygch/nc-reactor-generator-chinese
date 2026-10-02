/**
 * R5.3 — the service worker contract, tested **without a browser**.
 *
 * Two layers are asserted, and the point is that they agree:
 *
 *  1. `cacheStrategyFor` from `src/pwa.ts` — the routing table, as a pure function;
 *  2. `public/sw.js` — the file that actually ships, executed here with a stubbed
 *     worker global scope (`self`, `caches`, `fetch`). The worker cannot import the
 *     TypeScript module (Vite copies `public/` verbatim; R5.3 chose *not* to add a
 *     post-build rewrite), so instead of trusting that two implementations match,
 *     `observeRouting` **derives** the strategy from what the worker observably
 *     does, and that verdict is compared with the table. Drift is a red test.
 *
 * What this still cannot prove, and does not claim: that a real browser installs
 * the worker, that the Cache Storage quota allows it, or that a page opens with the
 * network unplugged. Those are documented as 未验证 in `docs/r5/offline.md`; what is
 * proven here is that every request class takes the intended path and that the
 * shell is complete before the first offline navigation.
 *
 * No jsdom and no new dependency: the fakes below are hand-rolled, in the spirit of
 * `test/bootstrap.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SERVICE_WORKER_URL,
  cacheStrategyFor,
  installOfflineSupport,
  isProductionBuild,
  registerOfflineSupport,
  shouldRegisterOfflineSupport,
  type CacheStrategy,
} from '../src/pwa.js';

// ------------------------------------------------------------------- test doubles

const ORIGIN = 'https://plannerator.test';
const SCOPE = `${ORIGIN}/`;
const ASSET_BASE = `${SCOPE}assets/`;
const SHELL_CACHE = 'ncplanner-shell-v1';
const ASSET_CACHE = 'ncplanner-assets-v1';

class FakeResponse {
  constructor(
    readonly body: string,
    readonly status = 200,
  ) {}
  get ok(): boolean {
    return this.status >= 200 && this.status < 300;
  }
  clone(): FakeResponse {
    return new FakeResponse(this.body, this.status);
  }
  async text(): Promise<string> {
    return this.body;
  }
}

interface FakeRequest {
  readonly url: string;
  readonly method: string;
  readonly mode?: string;
  readonly headers?: { has(name: string): boolean };
}

const NO_RANGE = { has: () => false };
const HAS_RANGE = { has: (name: string) => name.toLowerCase() === 'range' };

/** Cache keys are absolute URLs, exactly as the Cache API stores them. */
function keyOf(request: string | FakeRequest): string {
  return new URL(typeof request === 'string' ? request : request.url, SCOPE).href;
}

class FakeCache {
  readonly entries = new Map<string, FakeResponse>();
  constructor(private readonly harness: ServiceWorkerSandbox) {}

  async add(request: string | FakeRequest): Promise<void> {
    const url = keyOf(request);
    const response = await this.harness.network(url);
    if (!response.ok) throw new Error(`sw stub: cache.add got ${response.status} for ${url}`);
    this.entries.set(url, response);
  }
  async put(request: string | FakeRequest, response: FakeResponse): Promise<void> {
    this.entries.set(keyOf(request), response);
  }
  async match(request: string | FakeRequest): Promise<FakeResponse | undefined> {
    return this.entries.get(keyOf(request));
  }
}

class FakeCaches {
  readonly stores = new Map<string, FakeCache>();
  constructor(private readonly harness: ServiceWorkerSandbox) {}

  async open(name: string): Promise<FakeCache> {
    const existing = this.stores.get(name);
    if (existing !== undefined) return existing;
    const created = new FakeCache(this.harness);
    this.stores.set(name, created);
    return created;
  }
  async keys(): Promise<string[]> {
    return [...this.stores.keys()];
  }
  async delete(name: string): Promise<boolean> {
    return this.stores.delete(name);
  }
  async match(
    request: string | FakeRequest,
    options?: { cacheName?: string },
  ): Promise<FakeResponse | undefined> {
    const names = options?.cacheName !== undefined ? [options.cacheName] : [...this.stores.keys()];
    for (const name of names) {
      const found = await this.stores.get(name)?.match(request);
      if (found !== undefined) return found;
    }
    return undefined;
  }
}

interface FetchOutcome {
  responded?: Promise<FakeResponse>;
  readonly waited: Promise<unknown>[];
}

/** The worker global scope, stubbed down to exactly what `public/sw.js` touches. */
class ServiceWorkerSandbox {
  readonly handlers = new Map<string, (event: never) => void>();
  readonly caches = new FakeCaches(this);
  readonly networkCalls: string[] = [];
  readonly shellCacheName = SHELL_CACHE;
  readonly assetCacheName = ASSET_CACHE;
  clientsClaimed = false;
  skipWaitingCalled = false;

  private readonly routes = new Map<string, FakeResponse>();
  private offline = false;

  /** A URL the network can serve; `body` is what a caller reads back. */
  serve(url: string, body: string, status = 200): void {
    this.routes.set(keyOf(url), new FakeResponse(body, status));
  }
  goOffline(): void {
    this.offline = true;
  }

  async network(url: string): Promise<FakeResponse> {
    this.networkCalls.push(url);
    if (this.offline) throw new TypeError(`sw stub: offline (${url})`);
    const response = this.routes.get(url);
    if (response === undefined) throw new TypeError(`sw stub: no route for ${url}`);
    return response;
  }

  dispatchFetch(request: FakeRequest): FetchOutcome {
    const outcome: FetchOutcome = { waited: [] };
    const handler = this.handlers.get('fetch');
    expect(handler, 'public/sw.js must register a fetch handler').toBeDefined();
    handler?.({
      request,
      respondWith: (promise: Promise<FakeResponse>) => {
        outcome.responded = promise;
      },
      waitUntil: (promise: Promise<unknown>) => {
        outcome.waited.push(promise);
      },
    } as never);
    return outcome;
  }

  async dispatchLifecycle(type: 'install' | 'activate'): Promise<void> {
    const handler = this.handlers.get(type);
    expect(handler, `public/sw.js must register an ${type} handler`).toBeDefined();
    const waited: Promise<unknown>[] = [];
    handler?.({ waitUntil: (promise: Promise<unknown>) => waited.push(promise) } as never);
    await Promise.all(waited);
  }

  async seedCache(cacheName: string, request: string | FakeRequest, body: string): Promise<void> {
    const cache = await this.caches.open(cacheName);
    await cache.put(request, new FakeResponse(body));
  }

  async cachedBody(cacheName: string, request: string | FakeRequest): Promise<string | undefined> {
    const cache = this.caches.stores.get(cacheName);
    return (await cache?.match(request))?.body;
  }
}

/** Execute the shipped worker file with the stub scope above. */
function loadServiceWorker(): ServiceWorkerSandbox {
  const sandbox = new ServiceWorkerSandbox();
  const source = readFileSync(fileURLToPath(new URL('../public/sw.js', import.meta.url)), 'utf8');
  const scope = {
    registration: { scope: SCOPE },
    location: { href: `${SCOPE}sw.js` },
    clients: {
      claim: async () => {
        sandbox.clientsClaimed = true;
      },
    },
    skipWaiting: async () => {
      sandbox.skipWaitingCalled = true;
    },
    addEventListener: (type: string, handler: (event: never) => void) => {
      sandbox.handlers.set(type, handler);
    },
  };
  // `new Function`, not `vm`: the source is this repository's own file, and running
  // it in the current realm keeps `URL`/`Promise`/`Error` identical to the fakes'.
  const run = new Function('self', 'caches', 'fetch', source) as (
    self: unknown,
    caches: unknown,
    fetch: (input: unknown) => Promise<FakeResponse>,
  ) => void;
  run(scope, sandbox.caches, (input: unknown) => sandbox.network(keyOf(input as string)));
  sandbox.serve('./index.html', 'built index.html');
  return sandbox;
}

// ------------------------------------------------------------------------ routing

interface RouteCase {
  readonly name: string;
  readonly request: FakeRequest;
  readonly strategy: CacheStrategy;
}

/**
 * The same table the documentation uses. Every entry is checked twice: against
 * `cacheStrategyFor` and against the shipped worker's observable behaviour.
 */
const ROUTES: RouteCase[] = [
  {
    name: 'POST to a same-origin path',
    request: { url: `${SCOPE}save`, method: 'POST' },
    strategy: 'ignore',
  },
  {
    name: 'range request for a hashed asset',
    request: { url: `${ASSET_BASE}index-abc123.js`, method: 'GET', headers: HAS_RANGE },
    strategy: 'ignore',
  },
  {
    name: 'third-party script',
    request: { url: 'https://cdn.example.test/analytics.js', method: 'GET' },
    strategy: 'ignore',
  },
  {
    name: 'data: URL',
    request: { url: 'data:text/plain,hello', method: 'GET' },
    strategy: 'ignore',
  },
  {
    name: 'document navigation at the root',
    request: { url: SCOPE, method: 'GET', mode: 'navigate' },
    strategy: 'app-shell',
  },
  {
    name: 'document navigation under a deep link',
    request: { url: `${SCOPE}?design=abc`, method: 'GET', mode: 'navigate' },
    strategy: 'app-shell',
  },
  {
    name: 'content-hashed JS asset',
    request: { url: `${ASSET_BASE}index-abc123.js`, method: 'GET', headers: NO_RANGE },
    strategy: 'cache-first',
  },
  {
    name: 'content-hashed CSS asset',
    request: { url: `${ASSET_BASE}index-def456.css`, method: 'GET', headers: NO_RANGE },
    strategy: 'cache-first',
  },
  {
    name: 'web app manifest',
    request: { url: `${SCOPE}manifest.webmanifest`, method: 'GET' },
    strategy: 'stale-while-revalidate',
  },
  {
    name: 'icon',
    request: { url: `${SCOPE}icons/icon-512.png`, method: 'GET' },
    strategy: 'stale-while-revalidate',
  },
];

function requestDescriptor(request: FakeRequest) {
  return {
    method: request.method,
    url: request.url,
    mode: request.mode,
    origin: ORIGIN,
    assetBase: ASSET_BASE,
    hasRangeHeader: request.headers?.has('range') ?? false,
  };
}

/**
 * Derive the strategy from what the worker *does*: with the cache seeded with
 * `cached` and the network serving `network`, the answer identifies the branch.
 */
async function observeRouting(request: FakeRequest): Promise<CacheStrategy> {
  const sandbox = loadServiceWorker();
  await sandbox.seedCache(SHELL_CACHE, request, 'cached');
  await sandbox.seedCache(ASSET_CACHE, request, 'cached');
  sandbox.serve(request.url, 'network');
  const outcome = sandbox.dispatchFetch(request);
  if (outcome.responded === undefined) return 'ignore';
  const body = (await (await outcome.responded).text()) || '';
  const hitNetwork = sandbox.networkCalls.includes(keyOf(request));
  if (body === 'cached' && !hitNetwork) return 'cache-first';
  if (body === 'network') return 'app-shell';
  if (body === 'cached' && hitNetwork) return 'stale-while-revalidate';
  throw new Error(`unexpected ${request.url}: body=${body} network=${String(hitNetwork)}`);
}

// -------------------------------------------------------------------------- tests

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('pwa.ts — the routing contract (pure)', () => {
  for (const route of ROUTES) {
    it(`routes ${route.name} to ${route.strategy}`, () => {
      expect(cacheStrategyFor(requestDescriptor(route.request))).toBe(route.strategy);
    });
  }

  it('is cache-first only inside the asset base the worker derived from its scope', () => {
    const deepLink = `${SCOPE}repo/assets/index-abc123.js`;
    // Without the scope-derived base (the app's default is `<origin>/assets/`), a
    // project-page deploy would not see its own hashed files as immutable.
    expect(cacheStrategyFor({ method: 'GET', url: deepLink, origin: ORIGIN })).toBe(
      'stale-while-revalidate',
    );
    expect(
      cacheStrategyFor({
        method: 'GET',
        url: deepLink,
        origin: ORIGIN,
        assetBase: `${SCOPE}repo/assets/`,
      }),
    ).toBe('cache-first');
  });

  it('ignores an unparseable URL instead of throwing', () => {
    expect(cacheStrategyFor({ method: 'GET', url: 'not a url' })).toBe('ignore');
  });
});

describe('pwa.ts — registration', () => {
  it('is not a production build in the test environment', () => {
    // This is what makes the two tests below no-ops rather than luck.
    expect(isProductionBuild()).toBe(false);
  });

  it('does not register when navigator is absent', () => {
    vi.stubGlobal('navigator', undefined);
    expect(() => installOfflineSupport()).not.toThrow();
  });

  it('does not register when navigator has no serviceWorker', async () => {
    const onError = vi.fn();
    vi.stubGlobal('navigator', {});
    expect(() => installOfflineSupport()).not.toThrow();
    expect(shouldRegisterOfflineSupport(true, {})).toBe(false);
    await expect(registerOfflineSupport({ production: true, navigator: {}, onError })).resolves.toBe(
      false,
    );
    expect(onError).not.toHaveBeenCalled();
  });

  it('does not register in a development build even when the API exists', async () => {
    const register = vi.fn(async () => undefined);
    const onError = vi.fn();
    await expect(
      registerOfflineSupport({
        production: false,
        navigator: { serviceWorker: { register } },
        onError,
      }),
    ).resolves.toBe(false);
    expect(register).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('registers the relative worker URL, with no explicit scope', async () => {
    const register = vi.fn(async (url: string) => ({ url, scope: SCOPE }));
    const navigatorLike = { serviceWorker: { register } };
    await expect(registerOfflineSupport({ production: true, navigator: navigatorLike })).resolves.toBe(
      true,
    );
    expect(register).toHaveBeenCalledTimes(1);
    expect(register.mock.calls[0]?.[0]).toBe('./sw.js');
    expect(SERVICE_WORKER_URL).toBe('./sw.js');
    // A relative URL is what makes the worker work under `/<repo>/` on Pages.
    expect(SERVICE_WORKER_URL.startsWith('/')).toBe(false);
  });

  it('never throws when the API rejects', async () => {
    const onError = vi.fn();
    const navigatorLike = {
      serviceWorker: { register: async () => Promise.reject(new Error('SecurityError')) },
    };
    await expect(
      registerOfflineSupport({ production: true, navigator: navigatorLike, onError }),
    ).resolves.toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('never throws when register throws synchronously', async () => {
    const onError = vi.fn();
    const navigatorLike = {
      serviceWorker: {
        register: () => {
          throw new Error('InvalidStateError');
        },
      },
    };
    await expect(
      registerOfflineSupport({ production: true, navigator: navigatorLike, onError }),
    ).resolves.toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(() => installOfflineSupport()).not.toThrow();
  });
});

describe('public/sw.js — the shipped worker', () => {
  for (const route of ROUTES) {
    it(`routes ${route.name} to ${route.strategy}`, async () => {
      await expect(observeRouting(route.request)).resolves.toBe(route.strategy);
    });
  }

  it('precaches the hand-known shell files on install', async () => {
    const sandbox = loadServiceWorker();
    for (const file of [
      './',
      './index.html',
      './manifest.webmanifest',
      './icons/icon.svg',
      './icons/icon-192.png',
      './icons/icon-512.png',
    ]) {
      sandbox.serve(file, `body of ${file}`);
    }
    await sandbox.dispatchLifecycle('install');
    for (const file of ['./', './index.html', './manifest.webmanifest', './icons/icon.svg']) {
      await expect(sandbox.cachedBody(SHELL_CACHE, file)).resolves.toBe(`body of ${file}`);
    }
    expect(sandbox.skipWaitingCalled).toBe(true);
  });

  it('discovers the hashed assets from the built index.html on activate', async () => {
    const sandbox = loadServiceWorker();
    // The shape a real `vite build --base=./` emits, plus two decoys.
    sandbox.serve(
      './index.html',
      [
        '<!doctype html><html><head>',
        '<link rel="stylesheet" crossorigin href="./assets/index-def456.css">',
        '<link rel="manifest" href="./manifest.webmanifest">',
        '<script type="module" crossorigin src="./assets/index-abc123.js"></script>',
        '<script src="https://cdn.example.test/analytics.js"></script>',
        '<img src="data:image/png;base64,AAAA">',
        '</head><body><div id="app"></div></body></html>',
      ].join(''),
    );
    sandbox.serve('./assets/index-abc123.js', 'console.log(1)');
    sandbox.serve('./assets/index-def456.css', 'body{}');
    // A stale cache from a previous version must be dropped, not served forever.
    await sandbox.seedCache('ncplanner-shell-v0', './index.html', 'old shell');

    await sandbox.dispatchLifecycle('activate');

    await expect(sandbox.cachedBody(ASSET_CACHE, './assets/index-abc123.js')).resolves.toBe(
      'console.log(1)',
    );
    await expect(sandbox.cachedBody(ASSET_CACHE, './assets/index-def456.css')).resolves.toBe('body{}');
    // Decoys: a third-party script and a data: URL are never cached, and the
    // manifest is not an "asset" (it is precached as part of the shell).
    await expect(
      sandbox.cachedBody(ASSET_CACHE, 'https://cdn.example.test/analytics.js'),
    ).resolves.toBeUndefined();
    await expect(sandbox.cachedBody(SHELL_CACHE, './assets/index-abc123.js')).resolves.toBeUndefined();
    expect(sandbox.caches.stores.has('ncplanner-shell-v0')).toBe(false);
    expect(sandbox.caches.stores.has(SHELL_CACHE)).toBe(true);
    expect(sandbox.clientsClaimed).toBe(true);
  });

  it('opens the app shell for a navigation while offline', async () => {
    const sandbox = loadServiceWorker();
    sandbox.serve('./index.html', 'the shell');
    await sandbox.dispatchLifecycle('install');
    sandbox.goOffline();

    const outcome = sandbox.dispatchFetch({ url: SCOPE, method: 'GET', mode: 'navigate' });
    expect(outcome.responded).toBeDefined();
    await expect(outcome.responded?.then((response) => response.text())).resolves.toBe('the shell');
  });

  it('caches a hashed asset on first use, then serves it offline', async () => {
    const online = loadServiceWorker();
    online.serve(`${ASSET_BASE}index-abc123.js`, 'fresh asset');
    const first = online.dispatchFetch({
      url: `${ASSET_BASE}index-abc123.js`,
      method: 'GET',
      headers: NO_RANGE,
    });
    await expect(first.responded?.then((response) => response.text())).resolves.toBe('fresh asset');
    await expect(online.cachedBody(ASSET_CACHE, `${ASSET_BASE}index-abc123.js`)).resolves.toBe(
      'fresh asset',
    );

    // Same worker state, network unplugged: the asset must come from the cache.
    online.goOffline();
    const offline = online.dispatchFetch({
      url: `${ASSET_BASE}index-abc123.js`,
      method: 'GET',
      headers: NO_RANGE,
    });
    await expect(offline.responded?.then((response) => response.text())).resolves.toBe('fresh asset');
  });

  it('leaves a non-GET request entirely to the browser', () => {
    const sandbox = loadServiceWorker();
    const outcome = sandbox.dispatchFetch({ url: `${SCOPE}save`, method: 'POST' });
    expect(outcome.responded).toBeUndefined();
    expect(sandbox.networkCalls).toEqual([]);
  });

  it('extends the event lifetime synchronously, as ExtendableEvent requires', () => {
    // Regression: `event.waitUntil` throws InvalidStateError once the event has
    // finished dispatching, so it may not be called from inside a promise
    // callback. Asserted with no `await` between dispatch and the check.
    const sandbox = loadServiceWorker();
    sandbox.serve(`${SCOPE}manifest.webmanifest`, 'manifest v2');
    const outcome = sandbox.dispatchFetch({ url: `${SCOPE}manifest.webmanifest`, method: 'GET' });
    expect(outcome.responded).toBeDefined();
    expect(outcome.waited.length).toBeGreaterThan(0);
  });

  it('replaces the cached shell with the newest navigation response', async () => {
    const sandbox = loadServiceWorker();
    sandbox.serve('./index.html', 'shell v1');
    await sandbox.dispatchLifecycle('install');

    const outcome = sandbox.dispatchFetch({ url: SCOPE, method: 'GET', mode: 'navigate' });
    await expect(outcome.responded?.then((response) => response.text())).resolves.toBe('shell v1');

    sandbox.serve('./index.html', 'shell v2');
    const second = sandbox.dispatchFetch({
      url: `${SCOPE}index.html`,
      method: 'GET',
      mode: 'navigate',
    });
    await expect(second.responded?.then((response) => response.text())).resolves.toBe('shell v2');
    await expect(sandbox.cachedBody(SHELL_CACHE, './index.html')).resolves.toBe('shell v2');
  });
});
