#!/usr/bin/env node
/**
 * R5.3 + R5.5 — the PWA build gate: what the *published* directory must contain.
 *
 * The service worker, the manifest and the registration hook are all ordinary
 * files, so they are the kind of thing that silently disappears from a build (a
 * `publicDir` rename, a base-URL change, a `--base=/` regression). This script
 * checks the built `packages/app/dist` against the offline contract and exits
 * non-zero on any violation, so "断网可用" stops being a claim about a developer's
 * laptop and becomes a CI step.
 *
 * It checks, in order:
 *
 *   1. `dist/sw.js` exists **and is byte-identical** to the reviewed
 *      `packages/app/public/sw.js` (Vite copies `public/` verbatim — this asserts
 *      that, including that no build step rewrote it);
 *   2. `dist/manifest.webmanifest` parses, carries the members R5.3 asks for, and
 *      every icon `src` exists in the build with a signature that matches its
 *      declared type/size;
 *   3. `dist/index.html` links the manifest, sets `theme_color`, and uses **no
 *      root-absolute** `src`/`href` (a project Pages site lives under `/<repo>/`);
 *   4. the URL discovery the worker performs at activation — the `<script src>` /
 *      `<link href>` values of the built HTML — resolves to files that are really
 *      there, which is what makes "openable offline after one visit" true;
 *   5. the built JS still contains the registration call and no surviving
 *      `import.meta.env`, i.e. Vite's define replaced `import.meta.env.PROD`
 *      (otherwise the registration branch would be dead in production).
 *
 * Usage:
 *
 *   node tools/ts/pwa-build-check.mjs [distDir]     # default packages/app/dist
 *
 * Exit codes: 0 all checks pass, 1 otherwise, 2 for a usage/IO problem.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DIST = process.argv[2] ?? join(ROOT, 'packages', 'app', 'dist');
const PUBLIC_DIR = join(ROOT, 'packages', 'app', 'public');

const REQUIRED_MANIFEST_MEMBERS = [
  'name',
  'short_name',
  'start_url',
  'display',
  'theme_color',
  'background_color',
  'icons',
];

/** Same discovery the service worker does at activation (public/sw.js). */
const RESOURCE_PATTERN = /(?:src|href)\s*=\s*"([^"]+)"/g;

const failures = [];
const checks = [];

function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  if (!ok) failures.push(`${name}: ${detail}`);
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

if (!existsSync(DIST) || !statSync(DIST).isDirectory()) {
  console.error(`pwa-build-check: no build at ${DIST}; run \`pnpm build:app\` first`);
  process.exit(2);
}

const files = walk(DIST).map((path) => relative(DIST, path).split('\\').join('/'));
const has = (name) => files.includes(name);

// 1 ------------------------------------------------------------------ the worker
const worker = join(DIST, 'sw.js');
const workerSource = join(PUBLIC_DIR, 'sw.js');
check('dist/sw.js exists', existsSync(worker), `missing ${relative(ROOT, worker)}`);
if (existsSync(worker) && existsSync(workerSource)) {
  const shipped = sha256(worker);
  const reviewed = sha256(workerSource);
  check(
    'dist/sw.js is the reviewed public/sw.js verbatim',
    shipped === reviewed,
    `sha256 ${shipped} != ${reviewed}`,
  );
}

// 2 ------------------------------------------------------------------ the manifest
const manifestPath = join(DIST, 'manifest.webmanifest');
let manifest = null;
if (!existsSync(manifestPath)) {
  check('dist/manifest.webmanifest exists', false, `missing ${relative(ROOT, manifestPath)}`);
} else {
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    check('dist/manifest.webmanifest is valid JSON', true, '');
  } catch (error) {
    check('dist/manifest.webmanifest is valid JSON', false, String(error));
  }
}

if (manifest !== null) {
  const missing = REQUIRED_MANIFEST_MEMBERS.filter((member) => manifest[member] === undefined);
  check('manifest has every member R5.3 requires', missing.length === 0, `missing: ${missing.join(', ')}`);
  check(
    'manifest display is standalone',
    manifest.display === 'standalone',
    `display=${String(manifest.display)}`,
  );
  const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
  check('manifest declares at least two icons', icons.length >= 2, `${icons.length} icon(s)`);
  for (const icon of icons) {
    const src = String(icon.src ?? '');
    const rel = src.replace(/^\.\//, '');
    const iconPath = join(DIST, rel);
    if (!existsSync(iconPath)) {
      check(`icon ${src} is in the build`, false, `missing ${rel}`);
      continue;
    }
    const bytes = readFileSync(iconPath);
    if (icon.type === 'image/png') {
      const signature = bytes.subarray(0, 8).toString('hex');
      const width = bytes.length >= 24 ? bytes.readUInt32BE(16) : 0;
      const height = bytes.length >= 24 ? bytes.readUInt32BE(20) : 0;
      const declared = String(icon.sizes ?? '');
      check(
        `icon ${src} is a ${declared} PNG`,
        signature === '89504e470d0a1a0a' && declared === `${width}x${height}`,
        `signature=${signature} size=${width}x${height}`,
      );
    } else if (icon.type === 'image/svg+xml') {
      check(
        `icon ${src} is an SVG`,
        bytes.subarray(0, 512).toString('utf8').includes('<svg'),
        'no <svg element near the start of the file',
      );
    }
  }
}

// 3 + 4 ------------------------------------------------------------- the HTML shell
const htmlPath = join(DIST, 'index.html');
const html = existsSync(htmlPath) ? readFileSync(htmlPath, 'utf8') : null;
if (html === null) {
  check('dist/index.html exists', false, `missing ${relative(ROOT, htmlPath)}`);
} else {
  check('dist/index.html links the manifest', /rel="manifest"/.test(html), 'no rel="manifest"');
  check('dist/index.html sets a theme color', /name="theme-color"/.test(html), 'no theme-color meta');

  const urls = [...html.matchAll(RESOURCE_PATTERN)].map((match) => match[1]);
  const absolute = urls.filter((url) => url.startsWith('/'));
  check(
    'index.html uses no root-absolute src/href (project Pages path)',
    absolute.length === 0,
    `found ${absolute.join(', ')}`,
  );

  const sameOrigin = urls.filter(
    (url) => !url.startsWith('data:') && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('//'),
  );
  const assets = sameOrigin.filter((url) => url.replace(/^\.\//, '').startsWith('assets/'));
  check(
    'the worker can discover the hashed assets from index.html',
    assets.length >= 2,
    `discovered ${assets.length} asset URL(s): ${assets.join(', ')}`,
  );
  for (const url of sameOrigin) {
    const rel = url.replace(/^\.\//, '').split('?')[0];
    if (!has(rel)) check(`index.html reference ${url} exists in the build`, false, `missing ${rel}`);
  }
  check(
    'every index.html reference exists in the build',
    sameOrigin.every((url) => has(url.replace(/^\.\//, '').split('?')[0])),
    'see the missing-reference failures above',
  );
}

// 5 ------------------------------------------------------------- the registration
const scripts = files.filter((name) => name.endsWith('.js') && name !== 'sw.js');
const bundle = scripts.map((name) => readFileSync(join(DIST, name), 'utf8')).join('\n');
check('the build contains the registration call', bundle.includes('serviceWorker'), 'no serviceWorker');
check('the build contains the worker URL', bundle.includes('sw.js'), 'no sw.js');
check(
  'Vite replaced import.meta.env (no survivors in the bundle)',
  !bundle.includes('import.meta.env'),
  'import.meta.env survived the build, so the PROD gate is not statically true',
);

// ------------------------------------------------------------------------- report
console.log(`pwa-build-check: ${relative(ROOT, DIST)}`);
for (const entry of checks) {
  console.log(`  ${entry.ok ? 'ok  ' : 'FAIL'} ${entry.name}${entry.ok || !entry.detail ? '' : ` — ${entry.detail}`}`);
}
const failed = checks.filter((entry) => !entry.ok).length;
console.log(`  ${checks.length - failed}/${checks.length} checks passed`);
if (failures.length > 0) {
  console.error(`pwa-build-check FAILED (${failures.length})`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log('pwa-build-check passed');
