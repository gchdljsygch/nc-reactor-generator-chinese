#!/usr/bin/env node
/**
 * §11.3 CI gate — **i18n 覆盖率**: for the app layer, `未翻译 key = 0`.
 *
 * `tools/ts/lint.mjs` already enforces the *bare string* rule for the core
 * packages (R3.8: no user-visible string literal outside the packs). This tool
 * covers the other half of the gate: every key the UI asks for must exist in the
 * canonical pack, and every locale that ships must define the same key set — a
 * key that resolves through the fallback chain is a *missing translation*, which
 * §11.3 counts as a failure.
 *
 * It is a static audit on purpose: it sees keys used on code paths a test may
 * never reach, and it is what lets the *unused* key list be reviewed (that list
 * is a warning, because keys reached only through templates — `tool.${id}`,
 * `stat.${field}` — cannot be attributed to a single literal).
 *
 * Usage:
 *
 *   node tools/ts/i18n-audit-app.mjs [--json]
 *
 * Exit codes: 0 when no key is missing anywhere, 1 otherwise.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const APP_SRC = 'packages/app/src';
const LANG_DIR = 'lang';
const CANONICAL = 'en_US';

/** Files merged per locale: `<locale>.<part>.json` (`messages` / `app` / `elements`). */
function packFiles() {
  const out = new Map();
  for (const name of readdirSync(LANG_DIR)) {
    if (!name.endsWith('.json')) continue;
    const locale = name.split('.')[0];
    const list = out.get(locale) ?? [];
    list.push(join(LANG_DIR, name));
    out.set(locale, list);
  }
  return out;
}

function loadLocale(files) {
  const keys = new Set();
  for (const file of files) {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    for (const key of Object.keys(parsed.messages ?? {})) keys.add(key);
  }
  return keys;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (path.endsWith('.ts') && statSync(path).isFile()) out.push(path);
  }
  return out;
}

/**
 * Keys the app asks for. Two shapes matter:
 *
 *  - `t('literal.key')` / `t("literal.key")` — exact;
 *  - `` t(`tool.${id}`) `` — a *prefix*: only the prefix is checkable, so those are
 *    collected separately and reported as template families.
 */
function usedKeys() {
  const exact = new Map();
  const templates = new Map();
  for (const file of walk(APP_SRC)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\b(?:t|tc|has|tOr)\(\s*(['"])([^'"]+)\1/g)) {
      if (!exact.has(match[2])) exact.set(match[2], file);
    }
    for (const match of source.matchAll(/\b(?:t|tc|has|tOr)\(\s*`([^`$]*)\$\{/g)) {
      if (!templates.has(match[1])) templates.set(match[1], file);
    }
    // `` `stat.${field}` `` built outside a `t(...)` call, e.g. into a lookup.
    for (const match of source.matchAll(/`((?:stat|tool|panel|menu|image|message|error)\.[a-z.]*)\.\$\{/g)) {
      if (!templates.has(match[1])) templates.set(match[1], file);
    }
  }
  return { exact, templates };
}

const json = process.argv.includes('--json');
const locales = packFiles();
const { exact, templates } = usedKeys();

const report = { canonical: CANONICAL, locales: {}, missing: {}, extra: {}, unused: [] };
const canonicalKeys = loadLocale(locales.get(CANONICAL) ?? []);

for (const [locale, files] of locales) {
  const keys = loadLocale(files);
  report.locales[locale] = keys.size;
  report.extra[locale] = [...keys].filter((key) => !canonicalKeys.has(key)).sort();
  report.missing[locale] = [...exact.keys()].filter((key) => !keys.has(key)).sort();
}

report.unused = [...canonicalKeys].filter((key) => !exact.has(key)).sort();

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('app i18n audit');
  for (const [locale, size] of Object.entries(report.locales)) {
    console.log(`  ${locale}: ${size} keys`);
  }
  console.log(`  used by ${APP_SRC}: ${exact.size} literal + ${templates.size} template famil(ies)`);
  if (templates.size > 0) {
    console.log(`  templates: ${[...templates.keys()].sort().join(', ')}`);
  }
  for (const [locale, missing] of Object.entries(report.missing)) {
    if (missing.length === 0) continue;
    console.log(`\n  MISSING in ${locale} (${missing.length}):`);
    for (const key of missing) console.log(`    ${key}   (${exact.get(key)})`);
  }
  for (const [locale, extra] of Object.entries(report.extra)) {
    if (extra.length === 0) continue;
    // Almost all of these are legacy GUI strings the R1.2 migration carried over
    // from the Java translation tables (zh_CN has ~1100 of them). They are
    // deliberately not in the canonical pack: the canonical source for those is
    // the Java code, and they stay unused until R5. Count only; `--json` lists them.
    console.log(`  not in ${CANONICAL} (${locale}): ${extra.length} (legacy-migrated, see --json)`);
  }
  if (report.unused.length > 0) {
    console.log(`\n  unused in canonical (${report.unused.length}, warning only):`);
    console.log(`    ${report.unused.join(', ')}`);
  }
}

const missingTotal = Object.values(report.missing).reduce((sum, list) => sum + list.length, 0);
if (missingTotal > 0) {
  console.error(`\ni18n audit FAILED: ${missingTotal} missing key(s) across locales`);
  process.exit(1);
}
console.log('\ni18n audit passed');
