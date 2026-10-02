/**
 * Diff a `GoldenGen --dump-blocks` file against the TS kernel's block dump so a
 * port divergence can be localised to specific blocks.
 *
 * Usage: node tools/ts/diff-block-dumps.mjs <javaDumpFile> <tsDumpFile>
 *
 * Cluster identity hashes are not comparable across processes, so clusters are
 * compared as a *partition* of positions (same grouping = same clustering).
 */
import { readFileSync } from 'node:fs';

const SKIP_FIELDS = new Set(['source', 'cluster']);
/** Java prints the *class* of recipe objects; TS prints the element name. */
const PRESENCE_FIELDS = new Set(['irradiatorRecipe', 'heaterRecipe', 'recipe']);

function parse(path) {
  const text = readFileSync(path, 'utf8');
  const blocks = new Map();
  let current = null;
  const clusters = new Map();
  let stats = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const start = /=== BLOCK DUMP (\S+)/.exec(line);
    if (start) {
      current = start[1];
      continue;
    }
    if (line.startsWith('=== END BLOCK DUMP')) continue;
    if (line.startsWith('stats ')) {
      stats = JSON.parse(line.slice('stats '.length));
      continue;
    }
    if (/^\d+,\d+,\d+ /.test(line)) {
      const [pos, ...rest] = line.split(' ');
      const entry = { pos, fields: {}, cluster: null, source: null, raw: {} };
      for (const token of rest) {
        const eq = token.indexOf('=');
        if (eq < 0) {
          entry.fields['__template_extra_' + token] = token;
          continue;
        }
        const key = token.slice(0, eq);
        const value = token.slice(eq + 1);
        entry.raw[key] = value;
        if (key === 'cluster') entry.cluster = value;
        else if (key === 'source') entry.source = value;
        else entry.fields[key] = value;
      }
      blocks.set(entry.pos, entry);
      if (entry.cluster && entry.cluster !== '-') {
        if (!clusters.has(entry.cluster)) clusters.set(entry.cluster, []);
        clusters.get(entry.cluster).push(entry.pos);
      }
    }
  }
  return { id: current, blocks, clusters, stats };
}

const [javaPath, tsPath] = process.argv.slice(2);
if (!javaPath || !tsPath) {
  console.error('usage: node tools/ts/diff-block-dumps.mjs <javaDump> <tsDump>');
  process.exit(2);
}
const java = parse(javaPath);
const ts = parse(tsPath);
if (java.id !== ts.id) console.warn(`WARNING: different case ids (${java.id} vs ${ts.id})`);

const onlyJava = [...java.blocks.keys()].filter((p) => !ts.blocks.has(p));
const onlyTs = [...ts.blocks.keys()].filter((p) => !java.blocks.has(p));
console.log(`blocks: java=${java.blocks.size} ts=${ts.blocks.size}`);
if (onlyJava.length) console.log(`only in java (${onlyJava.length}): ${onlyJava.slice(0, 10).join(' ')}`);
if (onlyTs.length) console.log(`only in ts   (${onlyTs.length}): ${onlyTs.slice(0, 10).join(' ')}`);

const fieldDiffs = new Map();
const diffs = [];
for (const [pos, jb] of java.blocks) {
  const tb = ts.blocks.get(pos);
  if (!tb) continue;
  const keys = new Set([...Object.keys(jb.raw), ...Object.keys(tb.raw)]);
  const local = [];
  for (const key of keys) {
    if (SKIP_FIELDS.has(key)) continue;
    if (PRESENCE_FIELDS.has(key)) {
      const jp = jb.raw[key] !== undefined;
      const tp = tb.raw[key] !== undefined;
      if (jp !== tp) {
        local.push(`${key}: java=${jb.raw[key]} ts=${tb.raw[key]}`);
        fieldDiffs.set(key, (fieldDiffs.get(key) ?? 0) + 1);
      }
      continue;
    }
    const jv = normalizeNumber(jb.raw[key]);
    const tv = normalizeNumber(tb.raw[key]);
    if (jv !== tv) {
      local.push(`${key}: java=${jb.raw[key]} ts=${tb.raw[key]}`);
      fieldDiffs.set(key, (fieldDiffs.get(key) ?? 0) + 1);
    }
  }
  if (local.length) diffs.push(`${pos} ${jb.raw[Object.keys(jb.raw)[0]] ?? ''} :: ${local.join('; ')}`);
}

// cluster partition comparison
const jpart = new Set([...java.clusters.values()].map((v) => [...v].sort().join(' ')));
const tpart = new Set([...ts.clusters.values()].map((v) => [...v].sort().join(' ')));
const partitionEqual = jpart.size === tpart.size && [...jpart].every((c) => tpart.has(c));

console.log(`\nfield differences (${diffs.length} blocks):`);
for (const [k, v] of [...fieldDiffs].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
console.log('\nfirst differing blocks:');
for (const d of diffs.slice(0, 40)) console.log('  ' + d);
console.log(`\ncluster partition equal: ${partitionEqual} (java ${jpart.size} clusters, ts ${tpart.size})`);
if (!partitionEqual) {
  for (const c of jpart) if (!tpart.has(c)) console.log('  java-only cluster: ' + c.slice(0, 200));
  for (const c of tpart) if (!jpart.has(c)) console.log('  ts-only cluster  : ' + c.slice(0, 200));
}
if (java.stats && ts.stats) {
  console.log('\nstats comparison:');
  for (const key of new Set([...Object.keys(java.stats), ...Object.keys(ts.stats)])) {
    const jv = java.stats[key];
    const tv = ts.stats[key];
    const same = String(jv) === String(tv);
    console.log(`  ${same ? '   ' : '>> '}${key}: java=${jv} ts=${tv}`);
  }
}

/**
 * Java's `Float.toString` prints the shortest round-tripping decimal, TS prints
 * the double value of the same single-precision number. Compare them as
 * `float32` so only real differences survive.
 */
function normalizeNumber(v) {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (Number.isNaN(n)) return v;
  if (Number.isInteger(n) && Math.abs(n) < 2 ** 31) return String(n);
  return String(Math.fround(n));
}
