import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  compareStats,
  loadShippedTurbineConfig,
  readGoldenDataset,
  rebuildTurbine,
  TURBINE_INTEGER_FIELDS,
  type GoldenRecord,
} from '@ncplanner/kernel';

/**
 * R1.6c — Overhaul Turbine acceptance test.
 *
 * Same contract as the Overhaul SFR test (§3.1): field mapping per reactor type,
 * exact integers, 1e-5 relative tolerance on floats, `"NaN"` means "no reference
 * value", and error records only have to produce finite results.
 *
 * The dataset is produced by the parallel R1.0c workstream; when it is absent the
 * suite skips (the port still type-checks and the SFR/USFR suites still run).
 */

const ROOT = new URL('../../../', import.meta.url);
const CONFIG_PATH = fileURLToPath(new URL('src/configurations/nuclearcraft.ncpf.json', ROOT));
/** The dataset may be delivered plain (`datasetVersion 3`) or gzipped. */
const DATASET_PATH = fileURLToPath(
  existsSync(new URL('datasets/golden/turbine-cases.jsonl.gz', ROOT))
    ? new URL('datasets/golden/turbine-cases.jsonl.gz', ROOT)
    : new URL('datasets/golden/turbine-cases.jsonl', ROOT),
);
const HAS_DATASET = existsSync(DATASET_PATH);

const MODE = process.env['NCPL_GOLDEN'] ?? 'sample';
const LIMIT = Number(process.env['NCPL_LIMIT'] ?? (MODE === 'full' ? Infinity : 120));

const config = HAS_DATASET ? loadShippedTurbineConfig(CONFIG_PATH) : null;
const dataset = HAS_DATASET ? readGoldenDataset(DATASET_PATH) : null;
const records = dataset
  ? dataset.records.slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined)
  : [];

function simulate(record: GoldenRecord) {
  const { reactor } = rebuildTurbine(config!, record);
  reactor.recalculate();
  return reactor;
}

describe.skipIf(!HAS_DATASET)(
  `golden: Overhaul Turbine (datasetVersion ${dataset?.meta.datasetVersion}, ${records.length}/${dataset?.records.length} cases)`,
  () => {
    it('rebuilds every grid without unresolved templates', () => {
      const unresolved = new Set<string>();
      const ambiguous = new Set<string>();
      for (const record of records) {
        const result = rebuildTurbine(config!, record);
        for (const n of result.unresolved) unresolved.add(n);
        for (const a of result.ambiguous) ambiguous.add(`${a.name} (${a.chosen})`);
      }
      if (ambiguous.size > 0) {
        // eslint-disable-next-line no-console
        console.warn(`ambiguous template names: ${[...ambiguous].join(', ')}`);
      }
      expect([...unresolved]).toEqual([]);
    });

    it('runs one record twice and produces bit-identical statistics', () => {
      // TS analogue of R1.0a's in-place repeatability check.
      for (const record of records.slice(0, 25)) {
        const reactor = simulate(record);
        const first = JSON.stringify(reactor.stats());
        reactor.recalculate();
        expect(JSON.stringify(reactor.stats())).toBe(first);
      }
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
              failures.push({
                id: record.id,
                strategy: record.strategy,
                detail: `non-finite ${k}=${v}`,
              });
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
          integerFields: TURBINE_INTEGER_FIELDS,
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
      console.log(
        `golden Turbine: ${usable} usable; failures=${failures.length} (pass ${(passRate * 100).toFixed(2)}%)`,
      );
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
  },
);
