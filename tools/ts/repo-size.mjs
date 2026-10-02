#!/usr/bin/env node
/**
 * java-exit-plan §P5 gate — **仓库体积**: the tracked tree must stay under 60 MB.
 *
 * `pnpm size` (tools/ts/size-check.mjs) measures the *built* app; this measures what the
 * repository ships, which is the number the Java exit plan moved (205.5 MB → ~50 MB after
 * P3/P4). Without it, the archive work can be undone one fat binary at a time without CI
 * noticing — `git ls-files` is a fast, deterministic source for it.
 *
 * Usage:
 *
 *   node tools/ts/repo-size.mjs [--json]
 *
 * Exit codes: 0 under the budget, 1 over it.
 *
 * Sizes are read from the working tree (where `pnpm` also runs), so a file that is tracked
 * but missing locally is reported rather than silently counted as 0: that is a broken
 * checkout, not a small repository.
 */
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { join } from 'node:path';

/** java-exit-plan §5 验收矩阵: tracked < 60 MB. */
export const BUDGET_BYTES = 60 * 1024 * 1024;

/** Directories that dominate the total, reported as a breakdown. */
const BREAKDOWN = Object.freeze(['datasets/', 'packages/', 'docs/', 'lang/', 'tools/', '.github/']);

/**
 * Measure every tracked file.
 * @param {string} [cwd]
 * @returns {{ files: number, bytes: number, missing: string[], byPrefix: Map<string, {files: number, bytes: number}>, largest: {path: string, bytes: number}[] }}
 */
export function measureRepo(cwd = process.cwd()) {
  const listed = execFileSync('git', ['ls-files'], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const paths = listed.split('\n').map((line) => line).filter((line) => line.length > 0);

  let bytes = 0;
  const missing = [];
  const byPrefix = new Map(BREAKDOWN.map((prefix) => [prefix, { files: 0, bytes: 0 }]));
  const largest = [];

  for (const path of paths) {
    let size;
    try {
      const info = statSync(join(cwd, path));
      if (!info.isFile()) continue;
      size = info.size;
    } catch {
      missing.push(path);
      continue;
    }
    bytes += size;
    for (const [prefix, group] of byPrefix) {
      if (path.startsWith(prefix)) {
        group.files++;
        group.bytes += size;
        break;
      }
    }
    largest.push({ path, bytes: size });
  }

  largest.sort((a, b) => b.bytes - a.bytes);
  return { files: paths.length - missing.length, bytes, missing, byPrefix, largest: largest.slice(0, 10) };
}

function human(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${bytes} B`;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('usage: node tools/ts/repo-size.mjs [--json]');
    return;
  }

  const result = measureRepo();
  const byPrefix = Object.fromEntries(
    [...result.byPrefix.entries()].map(([prefix, group]) => [prefix, { ...group }]),
  );

  if (argv.includes('--json')) {
    console.log(JSON.stringify({ budgetBytes: BUDGET_BYTES, ...result, byPrefix }, null, 2));
  }

  console.log('repo-size: tracked tree (git ls-files)');
  for (const [prefix, group] of result.byPrefix) {
    if (group.files === 0) continue;
    console.log(`  ${human(group.bytes).padStart(9)}  ${prefix.padEnd(12)} ${group.files} files`);
  }
  console.log('  largest tracked files:');
  for (const entry of result.largest) console.log(`  ${human(entry.bytes).padStart(9)}  ${entry.path}`);
  console.log(`  —————————`);
  console.log(`  tracked : ${result.files} files, ${human(result.bytes)}  (budget ${human(BUDGET_BYTES)})`);

  if (result.missing.length > 0) {
    console.error(`repo-size: ${result.missing.length} tracked file(s) are missing from the working tree:`);
    for (const path of result.missing.slice(0, 20)) console.error(`  ${path}`);
    console.error('  restore them (`git checkout -- .`) and re-run; a broken checkout is not a small repo.');
    process.exit(1);
  }

  if (result.bytes >= BUDGET_BYTES) {
    console.error(`repo-size: the tracked tree exceeds the ${human(BUDGET_BYTES)} budget (java-exit-plan §5)`);
    console.error('  the ten largest files are listed above; the Java archive lives in tag java-frozen-c79c557f');
    process.exit(1);
  }

  console.log('repo-size passed');
}

// Only run the CLI when this file is the entry point; importing it must be side-effect free.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) main();
