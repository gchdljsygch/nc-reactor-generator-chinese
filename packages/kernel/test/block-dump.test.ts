import { describe, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import {
  loadShippedMsrConfig,
  loadShippedSfrConfig,
  loadShippedTurbineConfig,
  readGoldenDataset,
  rebuildMsr,
  rebuildSfr,
  rebuildTurbine,
  type GoldenRecord,
} from '@ncplanner/kernel';

/**
 * Debugging utility: print the kernel's per-block state in the same format as
 * `GoldenGen --dump-blocks`, so a divergence can be diffed block by block
 * against the frozen Java engine.
 *
 *   NCPL_DUMP_ID=sfr-000001 npx vitest run packages/kernel/test/block-dump.test.ts
 *   NCPL_DUMP_ID=msr-000000 NCPL_DUMP_DATASET=datasets/golden/msr-cases.jsonl.gz \
 *     npx vitest run packages/kernel/test/block-dump.test.ts
 *
 * `NCPL_DUMP_TYPE` (`sfr` | `msr` | `turbine`) selects the reactor type; it
 * defaults to the type implied by `NCPL_DUMP_DATASET` when that is given, and to
 * `sfr` otherwise. Skipped unless `NCPL_DUMP_ID` (or `NCPL_DUMP_INDEX`) is set.
 */
const ID = process.env['NCPL_DUMP_ID'];
const INDEX = process.env['NCPL_DUMP_INDEX'];
const DATASET = process.env['NCPL_DUMP_DATASET'] ?? 'datasets/golden/sfr-cases.jsonl.gz';
const TYPE = process.env['NCPL_DUMP_TYPE'] ?? inferType(DATASET);
const ROOT = new URL('../../../', import.meta.url);
const CONFIG_PATH = fileURLToPath(new URL('datasets/configurations/nuclearcraft.ncpf.json', ROOT));

function inferType(dataset: string): string {
  if (dataset.includes('msr')) return 'msr';
  if (dataset.includes('turbine')) return 'turbine';
  if (dataset.includes('usfr') || dataset.includes('underhaul')) return 'usfr';
  return 'sfr';
}

describe('block dump (debugging utility)', () => {
  it.skipIf(!ID && INDEX === undefined)('prints per-block state', () => {
    const dataset = readGoldenDataset(fileURLToPath(new URL(DATASET, ROOT)));
    const record = ID
      ? dataset.records.find((r) => r.id === ID)
      : dataset.records[Number(INDEX ?? 0)];
    if (!record) throw new Error(`record not found: ${ID ?? INDEX}`);
    const lines: string[] = [];
    let interior = '';
    let stats: Record<string, number> = {};
    if (TYPE === 'msr') {
      const reactor = rebuildMsr(loadShippedMsrConfig(CONFIG_PATH), record).reactor;
      reactor.recalculate();
      interior = `${reactor.width}x${reactor.height}x${reactor.depth}`;
      const clusters = new Map<unknown, number>();
      for (let x = 0; x < reactor.grid.externalWidth; x++) {
        for (let y = 0; y < reactor.grid.externalHeight; y++) {
          for (let z = 0; z < reactor.grid.externalDepth; z++) {
            const b = reactor.grid.get({ x, y, z });
            if (!b) continue;
            lines.push(msrBlockLine(b, clusters));
          }
        }
      }
      stats = reactor.stats() as unknown as Record<string, number>;
    } else if (TYPE === 'turbine') {
      const reactor = rebuildTurbine(loadShippedTurbineConfig(CONFIG_PATH), record).reactor;
      reactor.recalculate();
      interior = `${reactor.width}x${reactor.height}x${reactor.depth}`;
      for (let x = 0; x < reactor.grid.externalWidth; x++) {
        for (let y = 0; y < reactor.grid.externalHeight; y++) {
          for (let z = 0; z < reactor.grid.externalDepth; z++) {
            const b = reactor.grid.get({ x, y, z });
            if (!b) continue;
            lines.push(`${b.pos.x},${b.pos.y},${b.pos.z} ${b.template.identity} valid=${b.valid}`);
          }
        }
      }
      stats = reactor.stats() as unknown as Record<string, number>;
    } else {
      const reactor = rebuildSfr(loadShippedSfrConfig(CONFIG_PATH), record).reactor;
      reactor.recalculate();
      interior = `${reactor.width}x${reactor.height}x${reactor.depth}`;
      const clusters = new Map<unknown, number>();
      for (let x = 0; x < reactor.grid.externalWidth; x++) {
        for (let y = 0; y < reactor.grid.externalHeight; y++) {
          for (let z = 0; z < reactor.grid.externalDepth; z++) {
            const b = reactor.grid.get({ x, y, z });
            if (!b) continue;
            lines.push(sfrBlockLine(b, clusters));
          }
        }
      }
      stats = reactor.stats() as unknown as Record<string, number>;
      if (process.env['NCPL_DUMP_CLUSTERS']) {
        let accFloat = 0;
        let accTrunc = 0;
        reactor.clusters.forEach((c, i) => {
          accFloat = Math.fround(accFloat + c.totalOutput);
          accTrunc = Math.trunc(Math.fround(accTrunc + c.totalOutput));
          lines.push(
            `cluster ${i}: blocks=${c.blocks.length} totalOutput=${c.totalOutput} coolingPenalty=${c.coolingPenaltyMult} totalHeat=${c.totalHeat} totalCooling=${c.totalCooling} irradiation=${c.irradiation} created=${c.isCreated()} wall=${c.isConnectedToWall} cumFloat=${accFloat} cumTrunc=${accTrunc}`,
          );
        });
        lines.push(
          `recomputed cumulative truncation: ${accTrunc}, reactor.rawOutput=${reactor.rawOutput}`,
        );
      }
      if (process.env['NCPL_DUMP_EFFICIENCY']) {
        for (const b of reactor.getBlocks()) {
          if (!b.fuel) continue;
          const critMod = Math.fround(
            1 / (1 + Math.exp(2 * (b.neutronFlux - 2 * b.fuel.stats.criticality))),
          );
          const src = b.source === null ? 1 : (b.source.template.neutronSource?.efficiency ?? 1);
          const expected = Math.fround(
            Math.fround(Math.fround(b.fuel.stats.efficiency * b.positionalEfficiency) * src) *
              critMod,
          );
          if (expected !== b.efficiency) {
            lines.push(
              `EFF MISMATCH ${b.pos.x},${b.pos.y},${b.pos.z} stored=${b.efficiency} recomputed=${expected} fuelEff=${b.fuel.stats.efficiency} posEff=${b.positionalEfficiency} src=${src} critMod=${critMod} crit=${b.fuel.stats.criticality} flux=${b.neutronFlux}`,
            );
          }
        }
      }
    }
    const out = [
      `=== BLOCK DUMP ${record.id} (interior ${interior}) ===`,
      ...lines,
      `=== END BLOCK DUMP ${record.id} ===`,
      `stats ${JSON.stringify(stats)}`,
      `golden ${JSON.stringify(record.editor)}`,
    ];
    // Report as a test failure so vitest surfaces the text; the utility is only
    // ever run manually.
    throw new Error(out.join('\n'));
  });
});

type SfrBlock = ReturnType<typeof rebuildSfr>['reactor']['getBlocks'] extends (infer _B)[]
  ? never
  : never;

function sfrBlockLine(b: unknown, clusters: Map<unknown, number>): string {
  const block = b as {
    pos: { x: number; y: number; z: number };
    template: { identity: string };
    fuel: { name: string } | null;
    irradiatorRecipe: { name: string } | null;
    source: unknown;
    cluster: unknown;
    neutronFlux: number;
    moderatorLines: number;
    positionalEfficiency: number;
    efficiency: number;
    hadFlux: number;
    wasActive: boolean;
    hasPropogated: boolean;
    moderatorValid: boolean;
    moderatorActive: boolean;
    heatsinkValid: boolean;
    reflectorActive: boolean;
    shieldActive: boolean;
    casingValid: boolean;
  };
  let cluster = '-';
  if (block.cluster) {
    if (!clusters.has(block.cluster)) clusters.set(block.cluster, clusters.size + 1);
    cluster = `c${clusters.get(block.cluster)}`;
  }
  const parts = [
    `${block.pos.x},${block.pos.y},${block.pos.z} ${block.template.identity}`,
    block.fuel ? `fuel=${block.fuel.name}` : '',
    block.irradiatorRecipe ? `irradiatorRecipe=${block.irradiatorRecipe.name}` : '',
    `source=${block.source ? 'yes' : '-'}`,
    `cluster=${cluster}`,
    `neutronFlux=${block.neutronFlux}`,
    `moderatorLines=${block.moderatorLines}`,
    `positionalEfficiency=${block.positionalEfficiency}`,
    `efficiency=${block.efficiency}`,
    `hadFlux=${block.hadFlux}`,
    `wasActive=${block.wasActive}`,
    `hasPropogated=${block.hasPropogated}`,
    `moderatorValid=${block.moderatorValid}`,
    `moderatorActive=${block.moderatorActive}`,
    `heatsinkValid=${block.heatsinkValid}`,
    `reflectorActive=${block.reflectorActive}`,
    `shieldActive=${block.shieldActive}`,
    `casingValid=${block.casingValid}`,
  ];
  return parts.filter(Boolean).join(' ');
}

/**
 * MSR block line. The Java `dumpBlockStates` reflection set covers the same
 * fields, but for MSR `neutronFlux` / `moderatorLines` / `positionalEfficiency`
 * live on the *vessel group* (`OverhaulMSR.VesselGroup`), so they are printed
 * from there (with the per-block copy alongside).
 */
function msrBlockLine(b: unknown, clusters: Map<unknown, number>): string {
  const block = b as {
    pos: { x: number; y: number; z: number };
    template: { identity: string };
    fuel: { name: string } | null;
    irradiatorRecipe: { name: string } | null;
    heaterRecipe: { name: string } | null;
    source: unknown;
    cluster: unknown;
    vesselGroup: {
      neutronFlux: number;
      moderatorLines: number;
      positionalEfficiency: number;
      criticality: number;
      size(): number;
      getBunchingFactor(): number;
      getOpenFaces(): number;
      getSurfaceFactor(): number;
      getHeatMult(): number;
      isPrimed(): boolean;
    } | null;
    neutronFlux: number;
    efficiency: number;
    hasPropogated: boolean;
    moderatorValid: boolean;
    moderatorActive: boolean;
    heaterValid: boolean;
    reflectorActive: boolean;
    shieldActive: boolean;
    casingValid: boolean;
  };
  let cluster = '-';
  if (block.cluster) {
    if (!clusters.has(block.cluster)) clusters.set(block.cluster, clusters.size + 1);
    cluster = `c${clusters.get(block.cluster)}`;
  }
  const g = block.vesselGroup;
  const parts = [
    `${block.pos.x},${block.pos.y},${block.pos.z} ${block.template.identity}`,
    block.fuel ? `fuel=${block.fuel.name}` : '',
    block.irradiatorRecipe ? `irradiatorRecipe=${block.irradiatorRecipe.name}` : '',
    block.heaterRecipe ? `heaterRecipe=${block.heaterRecipe.name}` : '',
    `source=${block.source ? 'yes' : '-'}`,
    `cluster=${cluster}`,
    g
      ? `group(size=${g.size()},flux=${g.neutronFlux},crit=${g.criticality},openFaces=${g.getOpenFaces()},surfaceFactor=${g.getSurfaceFactor()})`
      : 'group=-',
    `neutronFlux=${block.neutronFlux}`,
    `moderatorLines=${g ? g.moderatorLines : 0}`,
    `positionalEfficiency=${g ? g.positionalEfficiency : 0}`,
    `bunchingFactor=${g ? g.getBunchingFactor() : 0}`,
    `heatMult=${g ? g.getHeatMult() : 0}`,
    `primed=${g ? g.isPrimed() : false}`,
    `efficiency=${block.efficiency}`,
    `hasPropogated=${block.hasPropogated}`,
    `moderatorValid=${block.moderatorValid}`,
    `moderatorActive=${block.moderatorActive}`,
    `heaterValid=${block.heaterValid}`,
    `reflectorActive=${block.reflectorActive}`,
    `shieldActive=${block.shieldActive}`,
    `casingValid=${block.casingValid}`,
  ];
  return parts.filter(Boolean).join(' ');
}
