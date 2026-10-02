import { describe, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import {
  loadShippedMsrConfig,
  loadShippedSfrConfig,
  loadShippedTurbineConfig,
  loadShippedUsfrConfig,
  readGoldenDataset,
  rebuildMsr,
  rebuildSfr,
  rebuildTurbine,
  rebuildUsfr,
} from '@ncplanner/kernel';

/**
 * ULP census (analysis utility, gated): how bit-identical is the kernel to the
 * frozen engine, per reactor type? This is the evidence behind the per-type
 * claims in `docs/r1/float-fidelity.md` §8 and the R1.6 report.
 *
 *   NCPL_ULP_CENSUS=1 npx vitest run packages/kernel/test/zz-ulp-census.test.ts
 *
 * Skipped unless `NCPL_ULP_CENSUS` is set.
 */
const ROOT = new URL('../../../', import.meta.url);
const CONFIG = fileURLToPath(new URL('datasets/configurations/nuclearcraft.ncpf.json', ROOT));

const ENABLED = process.env['NCPL_ULP_CENSUS'] === '1';

const sfr = loadShippedSfrConfig(CONFIG);
const usfr = loadShippedUsfrConfig(CONFIG);
const msr = loadShippedMsrConfig(CONFIG);
const turbine = loadShippedTurbineConfig(CONFIG);

const CASES = [
  { name: 'sfr', path: 'datasets/golden/sfr-cases.jsonl.gz', build: (r: never) => rebuildSfr(sfr, r).reactor },
  { name: 'usfr', path: 'datasets/golden/usfr-cases.jsonl.gz', build: (r: never) => rebuildUsfr(usfr, r).reactor },
  { name: 'msr', path: 'datasets/golden/msr-cases.jsonl.gz', build: (r: never) => rebuildMsr(msr, r).reactor },
  { name: 'turbine', path: 'datasets/golden/turbine-cases.jsonl.gz', build: (r: never) => rebuildTurbine(turbine, r).reactor },
] as const;

describe('ULP census', () => {
  it.skipIf(!ENABLED)('reports bit-identity per reactor type', () => {
    for (const c of CASES) {
      const dataset = readGoldenDataset(fileURLToPath(new URL(c.path, ROOT)));
      let comparable = 0;
      let exact = 0;
      const byField = new Map<string, { exact: number; total: number; maxRel: number }>();
      for (const record of dataset.records) {
        const reactor = c.build(record as never) as unknown as {
          recalculate(): void;
          stats(): Record<string, number>;
        };
        reactor.recalculate();
        const stats = reactor.stats();
        for (const [key, goldenValue] of Object.entries(record.editor)) {
          if (typeof goldenValue !== 'number') continue;
          const actual = stats[key];
          if (actual === undefined) continue;
          comparable++;
          const bucket = byField.get(key) ?? { exact: 0, total: 0, maxRel: 0 };
          bucket.total++;
          const scale = Math.max(1e-9, Math.abs(goldenValue), Math.abs(actual));
          const rel = Math.abs(goldenValue - actual) / scale;
          if (rel > bucket.maxRel) bucket.maxRel = rel;
          // Compare as float32: JSON carries the shortest decimal repr, so the
          // double from JSON.parse is *not* the float the engine held.
          if (Object.is(Math.fround(goldenValue), Math.fround(actual))) {
            exact++;
            bucket.exact++;
          }
          byField.set(key, bucket);
        }
      }
      // eslint-disable-next-line no-console
      console.log(
        `${c.name}: ${exact}/${comparable} fields bit-identical (${((100 * exact) / comparable).toFixed(2)}%)`,
      );
      for (const [field, b] of [...byField].sort(
        (a, z) => a[1].exact / a[1].total - z[1].exact / z[1].total,
      )) {
        if (b.exact === b.total) continue;
        // eslint-disable-next-line no-console
        console.log(`   ${field}: ${b.exact}/${b.total} exact, max rel ${b.maxRel.toExponential(2)}`);
      }
    }
  });
});
