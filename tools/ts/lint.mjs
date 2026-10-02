#!/usr/bin/env node
/**
 * R1.1b / R1.1d — the engineering guards the rewrite plan asks for, implemented
 * as one dependency-free Node script so they run in CI without an ESLint install
 * (the rules are structural, not stylistic).
 *
 *  1. **Dependency direction** (`kernel` must not import `app`/UI): enforced as a
 *     hard error. The kernel is the one thing every other package may depend on;
 *     if it ever reaches back into the UI or the localization layer, the "one
 *     physics implementation" law is already broken.
 *  2. **No bare user-visible strings** in the core packages (`ncpf`, `kernel`):
 *     reported as a burn-down list against `tools/ts/bare-strings-baseline.json`.
 *     New prose must be added deliberately (and eventually replaced by an i18n
 *     key); developer-facing text (thrown errors, log lines) is exempt by
 *     construction.
 *
 * Usage:
 *   node tools/ts/lint.mjs                 # check
 *   node tools/ts/lint.mjs --update-baseline
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BASELINE_PATH = join(ROOT, 'tools', 'ts', 'bare-strings-baseline.json');
const CORE_PACKAGES = ['ncpf', 'kernel'];
const UI_FORBIDDEN = ['@ncplanner/app', '@ncplanner/i18n', 'react', 'react-dom', 'vue', 'svelte'];

/** Packages that may not import a UI/localization layer. */
const PURE_PACKAGES = ['ncpf', 'kernel', 'generator'];

const updateBaseline = process.argv.includes('--update-baseline');

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      out.push(...walk(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

const rel = (p) => relative(ROOT, p).split(sep).join('/');

// ---------------------------------------------------------------------------
// rule 1 — dependency direction
// ---------------------------------------------------------------------------
const violations = [];
for (const pkg of PURE_PACKAGES) {
  for (const file of walk(join(ROOT, 'packages', pkg, 'src'))) {
    const text = readFileSync(file, 'utf8');
    for (const spec of UI_FORBIDDEN) {
      const re = new RegExp(`from\\s+['"]${spec.replace(/[/\\]/g, '\\$&')}(/[^'"]*)?['"]`);
      if (re.test(text)) {
        violations.push(`${rel(file)} imports '${spec}' — ${pkg} must stay free of UI/i18n`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// rule 2 — no bare user-visible strings in core packages
// ---------------------------------------------------------------------------
const DEVELOPER_CONTEXT =
  /throw new Error|new Error\(|console\.|\.name ===|case '|\bimport\b|\bfrom ['"]|require\(|\.test\.|RegExp|expect\(/;

function stringLiterals(line) {
  const out = [];
  const re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(line)) !== null) out.push(m[1] ?? m[2] ?? '');
  return out;
}

function looksLikeProse(s) {
  if (s.length < 8) return false;
  if (!/\s/.test(s)) return false;
  // Identity keys, module names, paths and format strings are data, not prose.
  if (/^[\w./|:@%{}$-]+$/.test(s)) return false;
  const words = s.trim().split(/\s+/);
  if (words.length < 2) return false;
  return words.some((w) => /^[A-Z][a-z]{2,}/.test(w)) || words.filter((w) => /^[a-z]{3,}$/.test(w)).length >= 2;
}

const prose = [];
for (const pkg of CORE_PACKAGES) {
  for (const file of walk(join(ROOT, 'packages', pkg, 'src'))) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) return;
      if (DEVELOPER_CONTEXT.test(line)) return;
      for (const literal of stringLiterals(line)) {
        if (looksLikeProse(literal)) {
          prose.push({ file: rel(file), line: i + 1, text: literal });
        }
      }
    });
  }
}

const baseline = existsSync(BASELINE_PATH)
  ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  : { note: '', entries: [] };
const baselineKeys = new Set(baseline.entries.map((e) => `${e.file}:${e.text}`));
const newProse = prose.filter((p) => !baselineKeys.has(`${p.file}:${p.text}`));
const stale = baseline.entries.filter(
  (e) => !prose.some((p) => p.file === e.file && p.text === e.text),
);

if (updateBaseline) {
  const entries = prose
    .map(({ file, text }) => ({ file, text, reason: 'TODO(R3.8): replace with an i18n key' }))
    .sort((a, b) => (a.file + a.text).localeCompare(b.file + b.text));
  writeFileSync(BASELINE_PATH, `${JSON.stringify({ note: baseline.note, entries }, null, 2)}\n`);
  console.log(`baseline updated: ${entries.length} bare-string entries`);
  process.exit(0);
}

console.log('dependency direction');
if (violations.length === 0) console.log('  OK — no core package imports a UI/i18n layer');
else for (const v of violations) console.log(`  ERROR ${v}`);

console.log('bare strings in core packages');
console.log(`  ${prose.length} prose literals, ${baseline.entries.length} baselined`);
for (const p of newProse) console.log(`  ERROR new bare string ${p.file}:${p.line} "${p.text}"`);
if (stale.length > 0) {
  console.log(`  note: ${stale.length} baseline entries are no longer present (run --update-baseline)`);
}

if (violations.length > 0 || newProse.length > 0) {
  console.log('\nlint FAILED');
  process.exit(1);
}
console.log('\nlint passed');
