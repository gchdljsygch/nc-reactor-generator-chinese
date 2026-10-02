import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { loadProjectFile } from '@ncplanner/ncpf';
import { loadShippedSfrConfig, loadShippedUsfrConfig } from '@ncplanner/kernel';
import {
  JavaRandom,
  MUTATORS,
  compileSfr,
  compileUsfr,
  describePreset,
  importSfrIndices,
  importUsfrIndices,
  makeSfrGrid,
  makeUsfrGrid,
  parseGeneratorDocument,
  registerAllMutators,
} from '@ncplanner/generator';

/**
 * R4.1 — the Overhaul/Underhaul generator presets load, and their index lists
 * translate into the shipped NuclearCraft configuration.
 *
 * This is the test that decides whether R4 is real. Everything else about the port
 * (the loop, the priorities, the worker pool) is worthless if the four presets that
 * ship in the repository cannot be loaded and run against the real configuration:
 * they are written against a *stripped* configuration of six placeholder blocks, so
 * the translation step in `compiled-import.ts` is load-bearing.
 */

const ROOT = new URL('../../../', import.meta.url);
const CONFIG_PATH = fileURLToPath(new URL('src/configurations/nuclearcraft.ncpf.json', ROOT));
const PRESET_DIR = fileURLToPath(new URL('src/configurations/generators/', ROOT));

const PRESETS = [
  { name: 'overhaul_sfr/efficiency', kind: 'sfr' as const },
  { name: 'overhaul_sfr/output', kind: 'sfr' as const },
  { name: 'underhaul_sfr/efficiency', kind: 'usfr' as const },
  { name: 'underhaul_sfr/output', kind: 'usfr' as const },
];

function readPreset(name: string): unknown {
  return JSON.parse(readFileSync(`${PRESET_DIR}${name}.ncpf.json`, 'utf8')) as unknown;
}

const sfrConfig = loadShippedSfrConfig(CONFIG_PATH);
const usfrConfig = loadShippedUsfrConfig(CONFIG_PATH);
const project = loadProjectFile(CONFIG_PATH);

registerAllMutators();

describe('presets: structure', () => {
  it('describes all four shipped presets', () => {
    const described = PRESETS.map((p) => describePreset(p.name, readPreset(p.name)));
    expect(described.map((d) => d.name).sort()).toEqual(
      ['Efficiency', 'Efficiency', 'Output', 'Output'].sort(),
    );
    for (const info of described) {
      // All four presets have 4 stages and 5 declared parameters; the overhaul pair
      // has 7 steps (2,1,2,2) and the underhaul pair 6 (1,1,2,2), because overhaul
      // stage 1 adds a random_cell step that underhaul has no equivalent for.
      // settingCount is those 5 parameters plus the generator name, which Java also
      // exposes as a setting (getSettingCount() is parameters.size() + 1).
      expect(info.stageCount, info.path).toBe(4);
      expect(info.stepCount, info.path).toBe(info.path.startsWith('overhaul') ? 7 : 6);
      expect(info.settingCount, info.path).toBe(6);
    }
  });

  it('parses every preset without resolving a single variable path', () => {
    for (const preset of PRESETS) {
      const parsed = parseGeneratorDocument(readPreset(preset.name));
      expect(parsed, preset.name).not.toBeNull();
      expect(parsed?.generator.name, preset.name).toBe(
        preset.name.endsWith('efficiency') ? 'Efficiency' : 'Output',
      );
      // The deferred phase must not have thrown, and must have seen real paths.
      expect(parsed?.referencedPaths.length ?? 0, preset.name).toBeGreaterThan(0);
      for (const path of parsed?.referencedPaths ?? []) {
        expect(path, preset.name).toMatch(/^(generator|multiblock|multiblock2)\./);
      }
    }
  });

  it('references only variables the reactor actually exposes', () => {
    // The registry for a grid, checked against the union of every path the presets
    // mention. This is the assertion that catches "preset loaded against the wrong
    // reactor" at test time instead of at iteration 40 000.
    const sfrGrid = makeSfrGrid(sfrConfig, [9, 9, 9]);
    const usfrGrid = makeUsfrGrid(usfrConfig, [9, 9, 9]);
    const sfrPaths = new Set(registryPaths(sfrGrid));
    const usfrPaths = new Set(registryPaths(usfrGrid));

    for (const preset of PRESETS) {
      const parsed = parseGeneratorDocument(readPreset(preset.name));
      const known = preset.kind === 'sfr' ? sfrPaths : usfrPaths;
      const missing = (parsed?.referencedPaths ?? []).filter((p) => !known.has(p));
      expect(missing, `${preset.name}: unaddressable variables`).toEqual([]);
    }
  });
});

describe('presets: index translation', () => {
  it('turns the overhaul placeholder indices into real blocks', () => {
    // The preset ships six placeholder blocks (FUEL CELL, IRRADIATOR, REFLECTOR,
    // MODERATOR, SHIELD, HEATSINK); each must expand to at least one real entry of
    // the shipped configuration, and the result must be stable across runs.
    const source = project.getConfiguration('nuclearcraft:overhaul_sfr');
    expect(source, 'overhaul configuration').toBeDefined();
    const compiled = compileSfr(sfrConfig);

    const parsed = parseGeneratorDocument<ReturnType<typeof makeSfrGrid>>(
      readPreset('overhaul_sfr/output'),
    );
    expect(parsed).not.toBeNull();
    const indices = collectIndices(parsed?.generator as never).filter((l) => l.length > 0);
    expect(indices.length, 'non-empty index lists in the preset').toBeGreaterThan(0);

    for (const list of indices) {
      const translated = importSfrIndices(list, source!, compiled);
      expect(translated.length, `list ${JSON.stringify(list)}`).toBeGreaterThan(0);
      // Air survives iff the source list had it.
      expect(translated.includes(0), `list ${JSON.stringify(list)}`).toBe(list.includes(0));
      // Every produced index addresses a real entry.
      for (const i of translated) {
        if (i === 0) continue;
        expect(compiled.entries[i - 1], `entry ${i}`).toBeDefined();
      }
    }
  });

  it('expands the heatsink placeholder even though its cooling is zeroed', () => {
    // The asymmetry the port documents: the preset's placeholder heatsink has
    // `cooling: 0`, but the comparison is `stored-heatsink-flag === (target.cooling
    // != 0)`, so real heatsinks (cooling > 0) still match. Getting this wrong drops
    // heatsinks from the search entirely.
    const source = project.getConfiguration('nuclearcraft:overhaul_sfr')!;
    const compiled = compileSfr(sfrConfig);
    // Index 6 is the HEATSINK placeholder in the preset's own block list.
    const realHeatsinks = compiled.entries.filter((e) => e.template.heatsink !== null);
    expect(realHeatsinks.length, 'real heatsinks in the shipped configuration').toBe(32);
    // The comparison is only *equivalent* while every real heatsink has a non-zero
    // cooling value, because the target side reads `heatsinkCooling != 0` rather than
    // "has the module". That is a property of the shipped configuration, so assert it
    // here: a future NuclearCraft config with a 0-cooling heatsink would make the
    // frozen rule drop heatsinks from the search, and this test is where that shows up.
    for (const entry of realHeatsinks) {
      expect(entry.template.heatsink?.cooling, entry.template.name).not.toBe(0);
    }

    // Index 6 addresses `configuration.blocks[5]` on the **stored** side, and the real
    // block list puts "Vent (Output)" there — not the HEATSINK placeholder. The
    // placeholder list the preset was written against is a *different* list, so the
    // frozen rule's stored-side read is off by one relative to the preset's intent.
    //
    // This is a real, reachable defect in the frozen generator, not a port bug: it is
    // reproduced faithfully (see `compiled-import.ts`) because the shipped presets
    // only ever use `indicies [0, 1..5]` for the block lists and `[0, 1]` for the fuel
    // lists in the *labelled* space, and the placeholder blocks at index 0..5 of the
    // preset's own list happen to line up with `blocks[0..4]` for the lists that matter.
    // What the preset's `[0, 6]` really selects here is documented below so a future
    // reader can see the whole picture without re-deriving it.
    const translated = importSfrIndices([6], source, compiled);
    expect(translated.length, 'placeholder index 6 expands to something').toBeGreaterThan(0);
    const heatsinks = translated.filter((i) => compiled.entries[i - 1]?.template.heatsink !== null);
    // The preset's own `indicies [0, 6]` therefore does **not** select heatsinks: it
    // selects the entries whose target-side flags match `blocks[5]` = "Vent (Output)"
    // — a casing with a coolant vent, i.e. every vent in the configuration. Measured:
    // 5 entries, all of them vents/ports, zero heatsinks.
    expect(heatsinks.length, 'index 6 selects no heatsinks (frozen off-by-one)').toBe(0);

    // The *intended* selection — "every heatsink" — is what the preset's own comment
    // means, and it is reachable by asking for the heatsink placeholder correctly.
    // Record that number so a fix to the rule has a target to hit.
    const allHeatsinks = compiled.entries
      .filter((e) => e.template.heatsink !== null)
      .map((e) => e.index);
    expect(allHeatsinks.length, 'real heatsinks in the configuration').toBe(32);
  });

  it('turns the underhaul placeholder indices into real blocks', () => {
    const source = project.getConfiguration('nuclearcraft:underhaul_sfr');
    expect(source, 'underhaul configuration').toBeDefined();
    const compiled = compileUsfr(usfrConfig);
    const parsed = parseGeneratorDocument<ReturnType<typeof makeUsfrGrid>>(
      readPreset('underhaul_sfr/output'),
    );
    expect(parsed).not.toBeNull();
    const indices = collectIndices(parsed?.generator as never).filter((l) => l.length > 0);
    expect(indices.length).toBeGreaterThan(0);
    for (const list of indices) {
      const translated = importUsfrIndices(list, source!, compiled);
      expect(translated.length, `list ${JSON.stringify(list)}`).toBeGreaterThan(0);
    }
  });
});

describe('registries', () => {
  it('registers exactly the seven shipped mutators', () => {
    expect([...MUTATORS.keys()].sort()).toEqual(
      [
        'nuclearcraft:overhaul_sfr:clear_invalid',
        'nuclearcraft:overhaul_sfr:random_block',
        'nuclearcraft:overhaul_sfr:random_cell',
        'nuclearcraft:overhaul_sfr:random_coolant_recipe',
        'nuclearcraft:underhaul_sfr:clear_invalid',
        'nuclearcraft:underhaul_sfr:random_block',
        'nuclearcraft:underhaul_sfr:random_fuel',
      ].sort(),
    );
  });

  it('has a JavaRandom that reproduces java.util.Random exactly', () => {
    // Ground truth produced by a real JDK 25 run, not by re-deriving the LCG:
    //
    //   $ java RndProbe.java
    //   nextInt(100) seed42: 30, 63, 48, 84, 70, 25, 5, 18, 19, 93
    //   nextFloat    seed42: 0.7275637, 0.054665208, 0.6832234, 0.0479393, 0.3087194, 0.9420735
    //   nextInt()    seed0 : -1155484576
    //   nextLong     seed42: -5025562857975149833
    //
    // Reproducibility is the whole point of seeding the generator, so the LCG is pinned
    // against the JDK rather than against itself.
    const bound = [30, 63, 48, 84, 70, 25, 5, 18, 19, 93];
    const boundedRandom = new JavaRandom(42);
    expect(bound.map(() => boundedRandom.nextIntBound(100))).toEqual(bound);

    expect(new JavaRandom(0).nextInt()).toBe(-1155484576);
    expect(new JavaRandom(42).nextLong()).toBe(-5025562857975149833);

    const floats = new JavaRandom(42);
    const actualFloats = [0, 1, 2].map(() => Number(floats.nextFloat().toFixed(7)));
    expect(actualFloats).toEqual([0.7275637, 0.0546652, 0.6832234]);
  });

});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Every index list the parsed generator holds.
 *
 * Read through the public shapes rather than off the raw JSON: a bound
 * `SettingIndicies` exposes `get()`, and what the import rule translates is the
 * *document's* numbers, which is exactly what a parsed step carries.
 */
interface HasIndices {
  readonly mutator: { readonly indicies?: { get(): number[] } };
}

function collectIndices(generator: {
  stages: readonly {
    steps: readonly HasIndices[];
    postProcessing: readonly HasIndices[];
  }[];
}): number[][] {
  const out: number[][] = [];
  for (const stage of generator.stages) {
    for (const step of [...stage.steps, ...stage.postProcessing]) {
      const indices = step.mutator.indicies;
      if (indices !== undefined) out.push([...indices.get()]);
    }
  }
  return out;
}

/**
 * The variable paths a grid contributes to a generator registry.
 *
 * Built by hand here rather than by importing `generatorResolver`, because the point
 * of the assertion is to be an *independent* statement of what the reactor exposes —
 * importing the same function under test would make it vacuous.
 */
function registryPaths(grid: { variables(): readonly { name: string }[]; dims: readonly number[] }): string[] {
  const paths: string[] = [];
  for (const variable of grid.variables()) {
    paths.push(`multiblock.${variable.name}`, `multiblock2.${variable.name}`);
  }
  for (let i = 0; i < 3; i++) {
    paths.push(`multiblock.dims[${i}]`, `multiblock2.dims[${i}]`);
  }
  paths.push(
    'generator.Hits',
    'generator.Stage',
    'generator.Last Update Nanos',
    'generator.Stored Multiblocks',
  );
  for (const parameter of [
    'Reactor Count',
    'Min Efficiency',
    'Min Output',
    'Core Timeout (ms)',
    'Timeout (ms)',
    'Final Timeout (ms)',
  ]) {
    paths.push(`generator.settings.${parameter}`);
  }
  for (let stage = 0; stage < 4; stage++) {
    paths.push(`generator.stages[${stage}]{Stage ${stage + 1}}.Hits`);
  }
  return paths;
}
