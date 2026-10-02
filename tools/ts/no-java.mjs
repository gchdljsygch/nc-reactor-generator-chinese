#!/usr/bin/env node
/**
 * java-exit-plan §P5 gate — **零 Java 仓库**: no tracked `*.java` and no tracked `*.jar`.
 *
 * Why a gate and not just a one-off cleanup: the point of the Java exit plan is that the
 * frozen Java tree stays archived in the tag `java-frozen-<sha>` (and in git history) and
 * *nothing* re-introduces a `.java`/`.jar` into the tree. The whitelist is deliberately
 * empty, so a re-added `*.java` (a stray copy, a dependency that ships sources, a
 * `libraries/` checkout) fails CI instead of quietly becoming "the baseline again".
 *
 * Usage:
 *
 *   node tools/ts/no-java.mjs [--json]
 *
 * Exit codes: 0 when the tree is Java-free, 1 otherwise.
 *
 * The file list comes from `git ls-files`, so this is about what the repository
 * *ships*, not about local leftovers (a build product in an ignored directory is fine).
 * Where the archive lives is stated in the failure message, because "I need that file
 * back" is the first question this gate provokes.
 */
import { execFileSync } from 'node:child_process';

/** Archived tag holding the complete pre-exit Java tree (java-exit-plan §P4). */
export const FROZEN_TAG = 'java-frozen-c79c557f';

/** Nothing is allowed back in (java-exit-plan §P5: 白名单为空). */
export const ALLOWED = Object.freeze([]);

/** Patterns that must never match a tracked path again. */
export const FORBIDDEN_PATTERNS = Object.freeze(['*.java', '*.jar']);

/**
 * List the tracked files matching `patterns` (git pathspecs, so `*.java` matches at any depth).
 * @param {readonly string[]} patterns
 * @param {string} [cwd]
 * @returns {string[]}
 */
export function findForbidden(patterns = FORBIDDEN_PATTERNS, cwd = process.cwd()) {
  const out = execFileSync('git', ['ls-files', '--', ...patterns], { cwd, encoding: 'utf8' });
  return out.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
}

/** Tracked files under a `.jar`-bearing path prefix would still be Java baggage. */
const JAVA_TREES = Object.freeze(['libraries/', 'gradle/', 'nbproject/']);

function report(files) {
  console.error('[no-java] the repository is supposed to be Java-free (java-exit-plan §P5)');
  console.error(`[no-java] tracked Java files: ${files.length}`);
  for (const file of files.slice(0, 40)) console.error(`  ${file}`);
  if (files.length > 40) console.error(`  … ${files.length - 40} more`);
  console.error('');
  console.error(`[no-java] the complete Java tree is archived in the tag ${FROZEN_TAG}`);
  console.error(`[no-java]   inspect it:  git ls-tree -r --name-only ${FROZEN_TAG} -- src`);
  console.error(`[no-java]   restore it:  git checkout ${FROZEN_TAG} -- src tools/golden`);
  console.error('[no-java] if a file must really come back, add it to ALLOWED in tools/ts/no-java.mjs');
  console.error('          with a comment saying why — the whitelist is empty on purpose.');
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('usage: node tools/ts/no-java.mjs [--json]');
    return;
  }

  const files = findForbidden();
  const baggage = JAVA_TREES.flatMap((tree) => findForbidden([`${tree}*`]));

  if (argv.includes('--json')) {
    console.log(JSON.stringify({ frozenTag: FROZEN_TAG, allowed: ALLOWED, files, baggage }, null, 2));
  }

  if (files.length > 0 || baggage.length > 0) {
    report([...files, ...baggage]);
    process.exit(1);
  }

  console.log(`no-java: 0 tracked *.java / *.jar (archive: tag ${FROZEN_TAG})`);
  console.log('no-java passed');
}

// Only run the CLI when this file is the entry point; importing it must be side-effect free.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) main();
