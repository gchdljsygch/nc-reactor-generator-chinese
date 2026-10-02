import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import {
  compareStats,
  loadShippedSfrConfig,
  readGoldenDataset,
  rebuildSfr,
  SFR_INTEGER_FIELDS,
  type GoldenRecord,
} from '@ncplanner/kernel';

/**
 * R1.5g — the Overhaul SFR acceptance test.
 *
 * The golden value is the `editor` block: that is what the user sees. `lite` is
 * the second implementation that is supposed to disappear, and is never a
 * target.
 *
 * `error` records (the frozen engine's 277 NPE cases) only assert §3.1.4: the
 * new kernel must *compute* a result, and it must be finite. Since D1 option B
 * was applied (the irradiator `null` guard, see `docs/r1/d1-decision.md`), the
 * shipped dataset has **zero** error records and all 5,000 cases are compared
 * against golden values; the branch below is kept so an unpatched dataset can
 * still be used for the R1.5g "must not crash" contract.
 */

const ROOT = new URL('../../../', import.meta.url);
const CONFIG_PATH = fileURLToPath(new URL('src/configurations/nuclearcraft.ncpf.json', ROOT));
const DATASET_PATH = fileURLToPath(new URL('datasets/golden/sfr-cases.jsonl.gz', ROOT));

const MODE = process.env['NCPL_GOLDEN'] ?? 'sample';
const LIMIT = Number(process.env['NCPL_LIMIT'] ?? (MODE === 'full' ? Infinity : 120));

const config = loadShippedSfrConfig(CONFIG_PATH);
const dataset = readGoldenDataset(DATASET_PATH);
const records = dataset.records.slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined);

interface Failure {
  id: string;
  strategy: string;
  fields: string[];
  detail: string;
}

function simulate(record: GoldenRecord) {
  const { reactor } = rebuildSfr(config, record);
  reactor.recalculate();
  return reactor;
}

describe(`golden: ${dataset.meta.reactorType} (datasetVersion ${dataset.meta.datasetVersion}, ${records.length}/${dataset.records.length} cases)`, () => {
  it('rebuilds every grid without unresolved templates', () => {
    const unresolved = new Set<string>();
    const ambiguous = new Set<string>();
    for (const record of records) {
      const result = rebuildSfr(config, record);
      for (const n of result.unresolved) unresolved.add(n);
      for (const a of result.ambiguous) ambiguous.add(`${a.name} (${a.chosen} candidates)`);
    }
    if (unresolved.size > 0) throw new Error(`unresolved templates: ${[...unresolved].join(', ')}`);
    // eslint-disable-next-line no-console
    if (ambiguous.size > 0) console.warn(`ambiguous template names: ${[...ambiguous].join(', ')}`);
    expect(unresolved.size).toBe(0);
  });

  it('matches every usable record', () => {
    const failures: Failure[] = [];
    const fieldCounts = new Map<string, number>();
    let usable = 0;
    let errored = 0;
    for (const record of records) {
      if (record.error) {
        errored++;
        const reactor = simulate(record);
        const stats = reactor.stats();
        for (const [k, v] of Object.entries(stats)) {
          if (!Number.isFinite(v)) {
            failures.push({ id: record.id, strategy: record.strategy, fields: [k], detail: `non-finite ${k}=${v}` });
            break;
          }
        }
        continue;
      }
      usable++;
      const reactor = simulate(record);
      const stats = reactor.stats() as unknown as Record<string, number>;
      const mismatches = compareStats(stats, record.editor, {
        relTolerance: 1e-5,
        integerFields: SFR_INTEGER_FIELDS,
      });
      if (mismatches.length > 0) {
        for (const m of mismatches) fieldCounts.set(m.field, (fieldCounts.get(m.field) ?? 0) + 1);
        const detail = mismatches
          .slice(0, 4)
          .map((m) => `${m.field}: expected ${m.expected} got ${m.actual}`)
          .join('; ');
        failures.push({
          id: record.id,
          strategy: record.strategy,
          fields: mismatches.map((m) => m.field),
          detail,
        });
      }
    }
    const passRate = usable === 0 ? 0 : (usable - failures.length) / usable;
    // eslint-disable-next-line no-console
    console.log(
      `golden SFR: ${usable} usable + ${errored} errored; failures=${failures.length} (pass ${(passRate * 100).toFixed(2)}%)`,
    );
    for (const [field, count] of [...fieldCounts].sort((a, b) => b[1] - a[1])) {
      // eslint-disable-next-line no-console
      console.log(`  field ${field}: ${count}`);
    }
    for (const f of failures.slice(0, 15)) {
      // eslint-disable-next-line no-console
      console.log(`  FAIL ${f.id} [${f.strategy}] ${f.detail}`);
    }
    expect(failures).toEqual([]);
  });

  it('is idempotent on a sample of records (TS analogue of R1.0a)', () => {
    // R1.0a measured that the frozen Java engine is bit-for-bit repeatable when
    // `recalculate()` runs again on the same object; the editor depends on that,
    // because every edit recalculates in place. This also catches forgotten state
    // resets (`hasPropogated`, `moderatorLines`, `wasActive`, clusters, `offOutput`).
    const failures: string[] = [];
    for (const record of records.slice(0, 200)) {
      const reactor = simulate(record);
      const first = reactor.stats();
      reactor.recalculate();
      const second = reactor.stats();
      for (const key of Object.keys(first) as (keyof typeof first)[]) {
        if (first[key] !== second[key]) {
          failures.push(`${record.id} ${String(key)}: ${first[key]} -> ${second[key]}`);
        }
      }
    }
    if (failures.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`non-repeatable: ${failures.slice(0, 10).join('; ')}`);
    }
    expect(failures).toEqual([]);
  });
});
