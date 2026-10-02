#!/usr/bin/env node
/**
 * §11.3 CI gate — **构建体积**: the static assets of the app build must stay under
 * 15 MB, *excluding the datasets* (the plan says 静态资源（不含数据集）< 15 MB).
 *
 * The R3 app build inlines the shipped `nuclearcraft.ncpf.json` (~1.2 MB) as a
 * chunk; that is a dataset, not a static asset, so it is excluded by file name
 * pattern. Everything else in `dist/` (JS, CSS, HTML, fonts, images) counts.
 *
 * Usage:
 *
 *   node tools/ts/size-check.mjs [distDir]
 *
 *   distDir  default: packages/app/dist
 *
 * Exit codes: 0 under the budget, 1 over it or when there is no build to measure.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const BUDGET = 15 * 1024 * 1024;
const DEFAULT_DIST = 'packages/app/dist';

/** The shipped configurations are data, not code (plan §11.3). */
function isDataset(name) {
  return /\.ncpf(-[A-Za-z0-9_-]+)?\.json$/.test(name) || name.endsWith('.ncpf.json');
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else out.push({ path, size: statSync(path).size });
  }
  return out;
}

function human(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${bytes} B`;
}

const dist = process.argv[2] ?? DEFAULT_DIST;
let files;
try {
  files = walk(dist);
} catch {
  console.error(`size-check: no build at ${dist}; run the app build first`);
  process.exit(1);
}

let assets = 0;
let datasets = 0;
const rows = [];
for (const file of files) {
  if (isDataset(file.path)) datasets += file.size;
  else {
    assets += file.size;
    rows.push(file);
  }
}

rows.sort((a, b) => b.size - a.size);
console.log(`size-check: ${dist}`);
for (const row of rows) console.log(`  ${human(row.size).padStart(9)}  ${relative(dist, row.path)}`);
console.log(`  ${'—'.repeat(9)}`);
console.log(`  assets   : ${human(assets)}  (budget ${human(BUDGET)})`);
console.log(`  datasets : ${human(datasets)}  (excluded)`);
console.log(`  total    : ${human(assets + datasets)}`);

if (assets >= BUDGET) {
  console.error(`size-check: static assets exceed the ${human(BUDGET)} budget (plan §11.3)`);
  process.exit(1);
}
console.log('size-check passed');
