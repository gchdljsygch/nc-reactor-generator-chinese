/*
 * R5.3 — the service worker (option (a): cache on demand, no build step).
 *
 * Hand-written and dependency-free, and served verbatim from `public/`. It runs
 * in a worker global scope: no DOM, no bundler, no imports (a Vite build rewrites
 * every *bundled* file name to a content hash, so a hand-written precache list of
 * hashed asset URLs is impossible — that trade-off is documented in
 * `docs/r5/offline.md`, together with why option (b), a post-build rewrite of this
 * file, was rejected).
 *
 * Three rules, in this order:
 *
 *   1. anything that is not a same-origin GET, or carries a `Range` header, is
 *      left entirely alone (no `respondWith` → the browser does what it always did);
 *   2. a document navigation is network-first, with the cached app shell as the
 *      offline fallback, so a deploy is picked up immediately when online;
 *   3. `assets/` holds content-hashed files (Vite's `assetsDir`), so those are
 *      cache-first — a hit can never be stale, because a new build has a new name.
 *
 * Offline-after-one-visit is guaranteed by the *install* and *activate* steps, not
 * by luck: install precaches the shell files whose names are known by hand
 * (`index.html`, the manifest, the icons), and activate discovers the hashed
 * assets by fetching the built `index.html` and reading its `<script src>` /
 * `<link href>` attributes. No hard-coded hash, no build-order coupling.
 *
 * The routing table below is mirrored by `cacheStrategyFor` in
 * `packages/app/src/pwa.ts`; `packages/app/test/pwa.test.ts` executes this file
 * with a stubbed worker scope and asserts both implementations classify the same
 * requests the same way, so the two cannot drift silently.
 *
 * Bumping CACHE_VERSION is the manual cache-invalidation switch: activate drops
 * every `ncplanner-*` cache that is not the current pair.
 */
'use strict';

const CACHE_VERSION = 'v1';
const SHELL_CACHE = `ncplanner-shell-${CACHE_VERSION}`;
const ASSET_CACHE = `ncplanner-assets-${CACHE_VERSION}`;
const CACHE_PREFIX = 'ncplanner-';
const CURRENT_CACHES = [SHELL_CACHE, ASSET_CACHE];

/** Files whose names are stable, so they can be precached by hand. */
const APP_SHELL = './index.html';
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

/**
 * The registration scope, i.e. the deploy root. `registration.scope` is the
 * authoritative value; the fallbacks exist so that a broken scope degrades to an
 * inert worker instead of a worker that fails to install.
 */
function resolveScope() {
  try {
    return new URL(self.registration.scope).href;
  } catch (error) {
    /* fall through */
  }
  try {
    return new URL('./', self.location.href).href;
  } catch (error) {
    return null;
  }
}

const SCOPE = resolveScope();
const ASSET_BASE = SCOPE === null ? null : new URL('assets/', SCOPE).href;
const ORIGIN = SCOPE === null ? null : new URL(SCOPE).origin;

/** Same table as `cacheStrategyFor` in packages/app/src/pwa.ts. */
function strategyFor(request) {
  if (SCOPE === null || ASSET_BASE === null || ORIGIN === null) return 'ignore';
  if (request.method !== 'GET') return 'ignore';
  let url;
  try {
    url = new URL(request.url);
  } catch (error) {
    return 'ignore';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'ignore';
  if (url.origin !== ORIGIN) return 'ignore';
  const headers = request.headers;
  if (headers !== undefined && headers !== null && typeof headers.has === 'function' && headers.has('range')) {
    return 'ignore';
  }
  if (request.mode === 'navigate') return 'app-shell';
  if (url.href.indexOf(ASSET_BASE) === 0) return 'cache-first';
  return 'stale-while-revalidate';
}

async function put(cacheName, request, response) {
  if (response === undefined || response === null || response.ok !== true) return;
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  } catch (error) {
    /* A full or unavailable Cache Storage must not fail the response. */
  }
}

/** Content-hashed, immutable: a cache hit is always correct. */
async function cacheFirst(request) {
  const cached = await caches.match(request, { cacheName: ASSET_CACHE });
  if (cached !== undefined) return cached;
  const response = await fetch(request);
  await put(ASSET_CACHE, request, response);
  return response;
}

/** Navigations: fresh when online, the cached shell when not. */
async function appShellFirst(request) {
  try {
    const response = await fetch(request);
    // The newest HTML replaces the shell copy, so the next offline load is the
    // build the user actually saw last.
    await put(SHELL_CACHE, APP_SHELL, response);
    return response;
  } catch (error) {
    const shell = await caches.match(APP_SHELL, { cacheName: SHELL_CACHE });
    if (shell !== undefined) return shell;
    throw error;
  }
}

/** Manifest/icons: answer from the cache, refresh in the background. */
function staleWhileRevalidate(event, request) {
  const revalidation = fetch(request)
    .then(async (response) => {
      await put(SHELL_CACHE, request, response);
      return response;
    })
    .catch(() => undefined);
  // `ExtendableEvent.waitUntil` throws InvalidStateError once the event has
  // finished dispatching, so it must be called *here*, synchronously — not inside
  // the `caches.match` callback below. (Asserted by test/pwa.test.ts.)
  event.waitUntil(revalidation);
  return caches.match(request).then((cached) => {
    if (cached !== undefined) return cached;
    return revalidation.then((response) => {
      if (response !== undefined) return response;
      throw new Error(`ncplanner-sw: offline and not cached: ${request.url}`);
    });
  });
}

/**
 * Discover the current build's hashed assets from the built `index.html` and
 * cache them, so the shell is complete before the user ever goes offline.
 */
async function precacheHashedAssets() {
  try {
    const response = await fetch(APP_SHELL, { cache: 'no-cache' });
    if (response === undefined || response === null || response.ok !== true) return;
    await put(SHELL_CACHE, APP_SHELL, response);
    const html = await response.text();
    const found = [];
    const pattern = /(?:src|href)\s*=\s*"([^"]+)"/g;
    let match = pattern.exec(html);
    while (match !== null) {
      const raw = match[1];
      if (raw.indexOf('data:') !== 0 && raw.indexOf('http://') !== 0 && raw.indexOf('https://') !== 0 && raw.indexOf('//') !== 0) {
        const url = new URL(raw, SCOPE);
        if (url.origin === ORIGIN && url.href.indexOf(ASSET_BASE) === 0 && found.indexOf(url.href) < 0) {
          found.push(url.href);
        }
      }
      match = pattern.exec(html);
    }
    await Promise.all(found.map(async (url) => {
      const assetCache = await caches.open(ASSET_CACHE);
      try {
        await assetCache.add(url);
      } catch (error) {
        /* One missing asset must not abort the warm-up. */
      }
    }));
  } catch (error) {
    /* Offline during install: assets fall back to cache-on-first-use below. */
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.all(SHELL_FILES.map(async (file) => {
      try {
        await cache.add(file);
      } catch (error) {
        /* A 404 here must not block activation; the fetch handler still works. */
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map(async (name) => {
      if (name.indexOf(CACHE_PREFIX) === 0 && CURRENT_CACHES.indexOf(name) < 0) {
        await caches.delete(name);
      }
    }));
    await precacheHashedAssets();
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const strategy = strategyFor(request);
  if (strategy === 'ignore') return;
  if (strategy === 'app-shell') {
    event.respondWith(appShellFirst(request));
    return;
  }
  if (strategy === 'cache-first') {
    event.respondWith(cacheFirst(request));
    return;
  }
  event.respondWith(staleWhileRevalidate(event, request));
});
