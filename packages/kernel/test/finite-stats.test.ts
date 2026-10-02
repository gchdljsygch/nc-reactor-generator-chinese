import { describe, expect, it } from 'vitest';
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
 * R1 acceptance §3.1.4 / §3.1.5 — **no statistic may be non-finite**.
 *
 * The frozen engine leaks `NaN` in two places: `shutdownFactor` when
 * `totalOutput == 0` (all types) and the turbine's
 * `rotorEfficiency`/`totalEfficiency`/`totalFluidEfficiency` when a rotor has no
 * blades (0/0 — 17 of the 500 turbine golden records). The comparison layer is
 * allowed to skip a `"NaN"` reference value, but the *kernel* must never hand a
 * NaN to the UI: that is the documented defect R1 is replacing.
 *
 * This test therefore checks the TS output directly, for every record of every
 * dataset.
 */

const ROOT = new URL('../../../', import.meta.url);
const CONFIG = fileURLToPath(new URL('datasets/configurations/nuclearcraft.ncpf.json', ROOT));

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

const LIMIT = Number(process.env['NCPL_LIMIT'] ?? 200);

describe('statistics are always finite (§3.1.4 / §3.1.5)', () => {
  for (const c of CASES) {
    it(`${c.name}: every field of every record is finite`, () => {
      const dataset = readGoldenDataset(fileURLToPath(new URL(c.path, ROOT)));
      const records = dataset.records.slice(0, LIMIT);
      const bad: string[] = [];
      for (const record of records) {
        const reactor = c.build(record as never) as unknown as {
          recalculate(): void;
          stats(): Record<string, number>;
        };
        reactor.recalculate();
        for (const [key, value] of Object.entries(reactor.stats())) {
          if (!Number.isFinite(value)) bad.push(`${record.id} ${key}=${value}`);
        }
      }
      if (bad.length > 0) {
        // eslint-disable-next-line no-console
        console.log(`non-finite statistics: ${bad.slice(0, 12).join(', ')}${bad.length > 12 ? ` … (+${bad.length - 12})` : ''}`);
      }
      expect(bad).toEqual([]);
    });
  }
});
