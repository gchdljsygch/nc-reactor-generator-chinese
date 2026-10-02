#!/usr/bin/env node
/**
 * R2 — generate the **TypeScript side** fixture coverage table.
 *
 * `docs/rewrite-plan-r1-r5.md` §5, closing note:
 *
 * > 每实现一个 reader，就往 `docs/r0/fixture-coverage.md` 的等价表里记一行
 * > （TS 侧应产出一份自己的覆盖表，字段与 R0 的表格一致，便于逐行比对）。
 *
 * R0's table (`docs/r0/fixture-coverage.md`) was produced by the Java
 * `RoundTrip --coverage`; this tool produces the same columns for the TS reader
 * chain and adds the R2 verdict — whether the produced tree is structurally equal
 * to the Java conversion and reproduces its fingerprint.
 *
 * Usage:
 *
 *   node --experimental-transform-types tools/ts/r2-coverage.mjs [outFile]
 *
 *   outFile  default: docs/r2/fixture-coverage.md
 *
 * The heavy lifting is not re-implemented here: the manifest, the structural diff
 * and the fingerprint all come from `packages/formats/src/index.ts` and
 * `packages/formats/test/legacyGoldens.ts`, so the table and the tests can never
 * disagree about what "matches" means.
 *
 * Why `--experimental-transform-types` is required: `config2.ts` declares a
 * `const enum`, which Node's strip-only type removal rejects.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const USAGE = 'usage: node --experimental-transform-types tools/ts/r2-coverage.mjs [outFile]';

/** `.js` specifiers inside the TS sources resolve to the adjacent `.ts` file. */
function tsSpecifierHook() {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (
        (specifier.startsWith('./') || specifier.startsWith('../')) &&
        specifier.endsWith('.js') &&
        typeof context.parentURL === 'string' &&
        context.parentURL.endsWith('.ts')
      ) {
        const candidate = new URL(`${specifier.slice(0, -3)}.ts`, context.parentURL);
        if (existsSync(fileURLToPath(candidate))) {
          return { url: candidate.href, shortCircuit: true };
        }
      }
      return nextResolve(specifier, context);
    },
  });
}

/** Escape a markdown table cell: pipes and newlines would break the row. */
function cell(value) {
  if (value === null || value === undefined || value === '') return ' ';
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

function short(value, max = 90) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

async function main() {
  const outFile = process.argv[2] ?? 'docs/r2/fixture-coverage.md';
  if (process.argv[2] === '--help' || process.argv[2] === '-h') {
    console.log(USAGE);
    return;
  }

  tsSpecifierHook();
  const formats = await import('../../packages/formats/src/index.ts');
  const goldens = await import('../../packages/formats/test/legacyGoldens.ts');

  const manifest = goldens.manifest();
  const readers = formats.allLegacyReaders();
  const rows = [];

  for (const entry of manifest.entries) {
    const bytes = goldens.fixtureBytes(entry.file);
    const input = formats.makeInput(bytes, entry.file);

    // Which registered readers claim the file (R0's "同时匹配" column). The NCPF
    // JSON catch-all is always a candidate: it defers by returning from `read`.
    const matching = ['NCPFReader'];
    for (const reader of readers) {
      let claims = false;
      try {
        claims = reader.matches(input);
      } catch {
        claims = false;
      }
      if (claims) matching.push(reader.name);
    }

    let tsReader = '—';
    let tsOk = false;
    let tsElements = '—';
    let tsDesigns = '—';
    let tsFingerprint = '—';
    let verdict = '';
    try {
      const outcome = formats.readAnyProjectBytes(bytes, entry.file);
      tsReader = outcome.reader;
      tsOk = true;
      const counts = goldens.countsOf(outcome.raw);
      tsElements = counts.elements;
      tsDesigns = counts.designs;
      tsFingerprint = goldens.fingerprintOf(outcome.raw);
      if (entry.ok) {
        const diff = goldens.jsonDiff(outcome.raw, goldens.goldenJson(entry.file));
        if (diff !== null) verdict = `结构差异 \`${short(diff, 70)}\``;
        else if (tsFingerprint !== entry.fingerprint) verdict = '指纹不一致';
        else verdict = '**与 Java 一致**';
      } else {
        verdict = 'Java 读入失败，无 golden；TS 按修复后语义读入';
      }
    } catch (error) {
      verdict = short(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    }

    rows.push({ entry, matching, tsReader, tsOk, tsElements, tsDesigns, tsFingerprint, verdict });
  }

  const javaOk = rows.filter((row) => row.entry.ok).length;
  const tsOkCount = rows.filter((row) => row.tsOk).length;
  const agree = rows.filter((row) => row.entry.ok && row.verdict === '**与 Java 一致**').length;

  const lines = [];
  lines.push('# R2 — fixture 覆盖表（TypeScript 侧）');
  lines.push('');
  lines.push('> 由 `node --experimental-transform-types tools/ts/r2-coverage.mjs` 生成；**请勿手改**。');
  lines.push('>');
  lines.push('> 逐行对应 `docs/r0/fixture-coverage.md` 的表格字段（fixture / 命中的 reader / 同时匹配 /');
  lines.push('> 读入 / 元素数 / 设计数 / 结果），"Java" 一列组取 `datasets/converted/MANIFEST.json`');
  lines.push('> （冻结版 Java reader 链跑出来的产物，采集脚本 `tools/golden/format-golden.ps1` 已在');
  lines.push('> java-exit-plan §P4 随 Java 树一起删除；数据本身已入库，复现见 `docs/changelog-java.md` 同级说明），"TS" 一列组是');
  lines.push('> `packages/formats/src/legacy/index.ts` 注册的同一条链。');
  lines.push('>');
  lines.push('> 「同时匹配」只列 TS 侧：`NCPFReader` 的 `formatMatches` 恒为 true（它靠 `read()` 返回');
  lines.push('> null 让位），LegacyNCPF / Hellrage / NCConfig 各版本靠版本号或容器特征互相排斥——');
  lines.push('> 正常情况下同一条链里只有一个 legacy reader 匹配。');
  lines.push('');
  lines.push('## Java（冻结版）');
  lines.push('');
  lines.push('| fixture | 命中的 reader | 读入 | 元素数 | 设计数 | 指纹 | 结果 |');
  lines.push('|---|---|:--:|---:|---:|---|---|');
  for (const row of rows) {
    const e = row.entry;
    lines.push(
      `| \`${e.file}\` | \`${e.reader}\` | ${e.ok ? '✅' : '❌'} | ${e.ok ? e.elements : '—'} | ` +
        `${e.ok ? e.designs : '—'} | ${e.ok ? `\`${e.fingerprint}\`` : '—'} | ${cell(e.ok ? '' : e.error)} |`,
    );
  }
  lines.push('');
  lines.push('## TypeScript');
  lines.push('');
  lines.push('| fixture | 命中的 reader | 同时匹配（含 catch-all） | 读入 | 元素数 | 设计数 | 指纹 | 结果 |');
  lines.push('|---|---|---|:--:|---:|---:|---|---|');
  for (const row of rows) {
    lines.push(
      `| \`${row.entry.file}\` | \`${row.tsReader}\` | ${cell(row.matching.join(', '))} | ` +
        `${row.tsOk ? '✅' : '❌'} | ${row.tsElements} | ${row.tsDesigns} | ` +
        `${row.tsFingerprint === '—' ? '—' : `\`${row.tsFingerprint}\``} | ${cell(row.verdict)} |`,
    );
  }
  lines.push('');
  lines.push('## 汇总');
  lines.push('');
  lines.push('| 项 | 数值 |');
  lines.push('|---|---:|');
  lines.push(`| fixture 数 | ${rows.length} |`);
  lines.push(`| Java 读入成功 | ${javaOk} |`);
  lines.push(`| Java 读入失败 | ${rows.length - javaOk} |`);
  lines.push(`| TS 读入成功 | ${tsOkCount} |`);
  lines.push(`| TS 读入失败 | ${rows.length - tsOkCount} |`);
  lines.push(`| TS 与 Java golden 结构+指纹一致 | ${agree} / ${javaOk} |`);
  lines.push('');
  lines.push('## 未覆盖的版本');
  lines.push('');
  lines.push('| LegacyNCPF 版本 | 仓库历史里有样本吗 | reader |');
  lines.push('|---|---|---|');
  for (const version of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
    const sample = rows.find((row) => row.entry.reader === `LegacyNCPF${version}Reader`);
    const tsReader = sample === undefined ? '—' : `\`${sample.tsReader}\``;
    lines.push(`| v${version} | ${sample === undefined ? '❌ 无' : `✅ \`${sample.entry.file}\``} | ${tsReader} |`);
  }
  lines.push('');
  lines.push(
    '> 版本分布由 `tools/golden/historical-fixtures.ps1`（已在 java-exit-plan §P4 删除）对仓库 git 历史里每一条 `*.ncpf` 路径的' +
      '每个 blob 探测得到：历史中存在的是 **1、2、5、8、10、11**；**3、4、6、7、9 从未被提交过**，' +
      '因此这几个 reader 没有真实样本可验（`docs/rewrite-plan-r1-r5.md` §5 R2.3 已把"需要真实样本"写成前置条件）。' +
      '脚本本身仍可从 tag `java-frozen-c79c557f` 取回：`git checkout java-frozen-c79c557f -- tools/golden`。',
  );
  lines.push('');

  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, lines.join('\n'));
  console.log(`wrote ${outFile} (${rows.length} fixtures, TS ok ${tsOkCount}, agree ${agree}/${javaOk})`);
}

main().catch((error) => {
  console.error(`r2-coverage: ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
