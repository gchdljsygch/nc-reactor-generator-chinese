import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import {
  compareStats,
  loadShippedUsfrConfig,
  readGoldenDataset,
  rebuildUsfr,
  USFR_INTEGER_FIELDS,
  type GoldenRecord,
} from '@ncplanner/kernel';

/**
 * R1.6a — Underhaul SFR acceptance test.
 *
 * Same contract as the Overhaul SFR test (§3.1): field mapping per reactor type,
 * exact integers, 1e-5 relative tolerance on floats, `"NaN"` means "no reference
 * value", and error records only have to produce finite results.
 */

const ROOT = new URL('../../../', import.meta.url);
const CONFIG_PATH = fileURLToPath(new URL('src/configurations/nuclearcraft.ncpf.json', ROOT));
const DATASET_PATH = fileURLToPath(new URL('datasets/golden/usfr-cases.jsonl.gz', ROOT));

const MODE = process.env['NCPL_GOLDEN'] ?? 'sample';
const LIMIT = Number(process.env['NCPL_LIMIT'] ?? (MODE === 'full' ? Infinity : 120));

const config = loadShippedUsfrConfig(CONFIG_PATH);
const dataset = readGoldenDataset(DATASET_PATH);
const records = dataset.records.slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined);

function simulate(record: GoldenRecord) {
  const { reactor } = rebuildUsfr(config, record);
  reactor.recalculate();
  return reactor;
}

describe(`golden: ${dataset.meta.reactorType} (datasetVersion ${dataset.meta.datasetVersion}, ${records.length}/${dataset.records.length} cases)`, () => {
  it('rebuilds every grid without unresolved templates', () => {
    const unresolved = new Set<string>();
    const ambiguous = new Set<string>();
    for (const record of records) {
      const result = rebuildUsfr(config, record);
      for (const n of result.unresolved) unresolved.add(n);
      for (const a of result.ambiguous) ambiguous.add(`${a.name} (${a.chosen})`);
    }
    if (ambiguous.size > 0) {
      // eslint-disable-next-line no-console
      console.warn(`ambiguous template names: ${[...ambiguous].join(', ')}`);
    }
    expect([...unresolved]).toEqual([]);
  });

  it('matches every usable record', () => {
    const failures: { id: string; strategy: string; detail: string }[] = [];
    const fieldCounts = new Map<string, number>();
    const strategyTotals = new Map<string, { cases: number; failed: number }>();
    let usable = 0;
    for (const record of records) {
      const bucket = strategyTotals.get(record.strategy) ?? { cases: 0, failed: 0 };
      strategyTotals.set(record.strategy, bucket);
      bucket.cases++;
      if (record.error) {
        const stats = simulate(record).stats();
        for (const [k, v] of Object.entries(stats)) {
          if (!Number.isFinite(v)) {
            failures.push({ id: record.id, strategy: record.strategy, detail: `non-finite ${k}=${v}` });
            bucket.failed++;
            break;
          }
        }
        continue;
      }
      usable++;
      const stats = simulate(record).stats() as unknown as Record<string, number>;
      const mismatches = compareStats(stats, record.editor, {
        relTolerance: 1e-5,
        integerFields: USFR_INTEGER_FIELDS,
      });
      if (mismatches.length > 0) {
        for (const m of mismatches) fieldCounts.set(m.field, (fieldCounts.get(m.field) ?? 0) + 1);
        failures.push({
          id: record.id,
          strategy: record.strategy,
          detail: mismatches
            .slice(0, 4)
            .map((m) => `${m.field}: expected ${m.expected} got ${m.actual}`)
            .join('; '),
        });
        bucket.failed++;
      }
    }
    const passRate = usable === 0 ? 0 : (usable - failures.length) / usable;
    // eslint-disable-next-line no-console
    console.log(`golden USFR: ${usable} usable; failures=${failures.length} (pass ${(passRate * 100).toFixed(2)}%)`);
    for (const [field, count] of [...fieldCounts].sort((a, b) => b[1] - a[1])) {
      // eslint-disable-next-line no-console
      console.log(`  field ${field}: ${count}`);
    }
    for (const [strategy, t] of [...strategyTotals].sort((a, b) => b[1].failed - a[1].failed)) {
      // eslint-disable-next-line no-console
      console.log(`  strategy ${strategy}: ${t.failed}/${t.cases} failed`);
    }
    for (const f of failures.slice(0, 15)) {
      // eslint-disable-next-line no-console
      console.log(`  FAIL ${f.id} [${f.strategy}] ${f.detail}`);
    }
    expect(failures).toEqual([]);
  });

  it('is idempotent on a sample of records (TS analogue of R1.0a)', () => {
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
