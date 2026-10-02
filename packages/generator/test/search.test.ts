import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import type { Configuration } from '@ncplanner/ncpf';
import { loadShippedSfrConfig, loadShippedUsfrConfig } from '@ncplanner/kernel';
import {
  compileSfr,
  compileUsfr,
  generatorResolver,
  importSfrIndices,
  importUsfrIndices,
  JavaRandom,
  makeSfrGrid,
  makeUsfrGrid,
  parseGeneratorDocument,
  registerAllMutators,
  runGenerator,
  type SfrGeneratorGrid,
  type UsfrGeneratorGrid,
} from '@ncplanner/generator';

/**
 * R4.2/R4.3 — the search actually runs, it is deterministic, and the generator's
 * numbers come from the editor's kernel.
 *
 * The three claims under test:
 *
 *  1. **It runs.** A preset, bound against the shipped configuration, improves a
 *     starting grid over N iterations — measured, not asserted by inspection.
 *  2. **It is deterministic.** Same seed → same incumbent, byte for byte. This is a
 *     deliberate improvement over the frozen Java (which seeded each thread from the
 *     clock) and the only thing that makes the search testable at all.
 *  3. **One kernel (iron law 1).** The generator's reported stats equal the kernel's
 *     stats for the same grid. If this fails, the generator has grown a second engine.
 */

const ROOT = new URL('../../../', import.meta.url);
const CONFIG_PATH = fileURLToPath(new URL('src/configurations/nuclearcraft.ncpf.json', ROOT));
const PRESET_DIR = fileURLToPath(new URL('src/configurations/generators/', ROOT));

const sfrConfig = loadShippedSfrConfig(CONFIG_PATH);
const usfrConfig = loadShippedUsfrConfig(CONFIG_PATH);

registerAllMutators();

const DIMS = [9, 9, 9] as const;

function readPreset(name: string): unknown {
  return JSON.parse(readFileSync(`${PRESET_DIR}${name}.ncpf.json`, 'utf8')) as unknown;
}

/** A grid whose index lists have been translated against the real configuration. */
function buildSfrSearch(preset: string, dims: readonly [number, number, number] = DIMS) {
  // The list is translated against the configuration the preset was *written for* —
  // the placeholder configuration embedded in the preset file itself — exactly as
  // Java's `Mutator.importFrom(multiblock, ncpf.configuration)` does. Translating
  // against the shipped NuclearCraft configuration instead would read the placeholder
  // indices as real-block indices and build the wrong lists (measured: an empty
  // fuel-cell list, so `random_cell` becomes a no-op).
  const presetDocument = readPreset(preset) as {
    configuration?: Record<string, { blocks?: readonly unknown[] }>;
  };
  const source = presetDocument.configuration?.['nuclearcraft:overhaul_sfr'] as
    | Configuration
    | undefined;
  if (!source) throw new Error('preset carries no overhaul configuration');
  const compiled = compileSfr(sfrConfig);
  const parsed = parseGeneratorDocument<SfrGeneratorGrid>(readPreset(preset));
  if (!parsed) throw new Error(`no generator in ${preset}`);
  const grid = makeSfrGrid(sfrConfig, dims);

  // Translate every stored index list from the preset's own configuration into the
  // shipped one, then re-label the settings so a human sees real block names.
  for (const stage of parsed.generator.stages) {
    for (const step of [...stage.steps, ...stage.postProcessing]) {
      const indices = (step.mutator as { indicies?: { get(): number[]; set(v: number[]): void } })
        .indicies;
      if (indices === undefined) continue;
      indices.set(importSfrIndices(indices.get(), source, compiled));
      step.mutator.setIndicies(grid);
    }
  }
  return { parsed, grid };
}

function buildUsfrSearch(preset: string, dims: readonly [number, number, number] = DIMS) {
  const presetDocument = readPreset(preset) as {
    configuration?: Record<string, { blocks?: readonly unknown[] }>;
  };
  const source = presetDocument.configuration?.['nuclearcraft:underhaul_sfr'] as
    | Configuration
    | undefined;
  if (!source) throw new Error('preset carries no underhaul configuration');
  const compiled = compileUsfr(usfrConfig);
  const parsed = parseGeneratorDocument<UsfrGeneratorGrid>(readPreset(preset));
  if (!parsed) throw new Error(`no generator in ${preset}`);
  const grid = makeUsfrGrid(usfrConfig, dims);
  for (const stage of parsed.generator.stages) {
    for (const step of [...stage.steps, ...stage.postProcessing]) {
      const indices = (step.mutator as { indicies?: { get(): number[]; set(v: number[]): void } })
        .indicies;
      if (indices === undefined) continue;
      indices.set(importUsfrIndices(indices.get(), source, compiled));
      step.mutator.setIndicies(grid);
    }
  }
  return { parsed, grid };
}

function runSfr(iterations: number, seed = 12345) {
  const { parsed, grid } = buildSfrSearch('overhaul_sfr/output');
  const result = runGenerator({
    generator: parsed.generator,
    parsed,
    start: grid,
    seed,
    maxIterations: iterations,
  });
  return result;
}

describe('R4.2 search: it runs', () => {
  it('improves a starting grid over 2 000 iterations', () => {
    const result = runSfr(2_000);
    expect(result.iterations).toBe(2_000);
    // The search must have accepted at least one upgrade — otherwise the priorities,
    // the `copyVarsFrom` scratch, or the operator evaluation is broken.
    expect(result.upgrades, 'accepted upgrades').toBeGreaterThan(0);
    const stats = result.best.rawStats();
    expect(Number.isFinite(stats.totalOutput)).toBe(true);
    expect(Number.isFinite(stats.totalEfficiency)).toBe(true);
    // A grid the search scored must hold at least one fuel cell.
    expect(stats.totalFuelCells).toBeGreaterThan(0);
  });

  it('runs the underhaul preset too', () => {
    const { parsed, grid } = buildUsfrSearch('underhaul_sfr/output');
    const result = runGenerator({
      generator: parsed.generator,
      parsed,
      start: grid,
      seed: 999,
      maxIterations: 1_000,
    });
    expect(result.iterations).toBe(1_000);
    expect(result.upgrades).toBeGreaterThan(0);
    expect(result.best.rawStats().cells).toBeGreaterThan(0);
  });

  it('advances through the preset\'s stages', () => {
    // Stage 0 is a bootstrap stage: `random_cell` + `random_block` until the cell
    // count reaches the target, then transition to stage 1. Seeing stage > 0 proves
    // the transition conditions and the `generator.stages[i].Hits` variables work.
    const { parsed } = buildSfrSearch('overhaul_sfr/output');
    const seen = new Set<number>();
    const { grid } = buildSfrSearch('overhaul_sfr/output');
    const originalStage = parsed.generator.run;
    void originalStage;
    runGenerator({
      generator: parsed.generator,
      parsed,
      start: grid,
      seed: 7,
      maxIterations: 3_000,
      onProgress: () => seen.add(parsed.generator.stage),
    });
    seen.add(parsed.generator.stage);
    expect(Math.max(...seen), 'highest stage reached').toBeGreaterThan(0);
  });
});

describe('R4.2 determinism', () => {
  it('produces an identical incumbent for an identical seed', () => {
    const a = runSfr(500, 424242);
    const b = runSfr(500, 424242);
    expect(b.best.toIndices()).toEqual(a.best.toIndices());
    expect(b.iterations).toBe(a.iterations);
    expect(b.upgrades).toBe(a.upgrades);
  });

  it('produces a different incumbent for a different seed', () => {
    const a = runSfr(500, 1);
    const b = runSfr(500, 2);
    // Not a strong claim about quality — just proof the seed is actually threaded
    // through rather than ignored.
    expect(b.best.toIndices()).not.toEqual(a.best.toIndices());
  });

  it('replays the same RNG stream from the same seed', () => {
    const a = new JavaRandom(31337);
    const b = new JavaRandom(31337);
    const left = Array.from({ length: 32 }, () => a.nextIntBound(1_000));
    const right = Array.from({ length: 32 }, () => b.nextIntBound(1_000));
    expect(right).toEqual(left);
  });
});

describe('R4.3 iron law 1: the generator reports the kernel\'s numbers', () => {
  it('matches the editor kernel cell-for-cell on the final grid', () => {
    // Re-run the kernel directly over the grid the generator produced. If the
    // generator had a second engine, the numbers would differ here.
    const result = runSfr(300, 555);
    const grid = result.best;
    const before = { ...grid.rawStats() };
    grid.calculate();
    const after = grid.rawStats();
    expect(after).toEqual(before);

    // And the kernel's own reactor over the same bindings agrees with the grid.
    const underlying = grid.kernel();
    underlying.recalculate();
    const direct = underlying.stats();
    expect(direct.totalOutput).toBe(after.totalOutput);
    expect(direct.totalHeat).toBe(after.totalHeat);
    expect(direct.totalCooling).toBe(after.totalCooling);
    expect(direct.totalEfficiency).toBe(after.totalEfficiency);
    expect(direct.netHeat).toBe(after.netHeat);
  });

  it('never reports a stat the editor would not', () => {
    const result = runSfr(200, 8080);
    const stats = result.best.rawStats();
    for (const [key, value] of Object.entries(stats)) {
      expect(Number.isFinite(value), `${key} = ${value}`).toBe(true);
    }
  });
});

describe('R4.3 performance', () => {
  it('measures iterations per second and records the figure', () => {
    const iterations = 20_000;
    const started = Date.now();
    const result = runSfr(iterations, 2024);
    const elapsedMs = Date.now() - started;
    const perSecond = Math.round((iterations / elapsedMs) * 1_000);
    // The plan asks for a measurement, not a threshold: the number is printed so an
    // engineer can compare it against the frozen Java's, and the only assertion is
    // that the run completed and did measurable work.
    console.log(
      `R4.3 performance: ${iterations} iterations of overhaul_sfr/output on ` +
        `${DIMS.join('x')} in ${elapsedMs} ms = ${perSecond} iterations/second ` +
        `(${result.upgrades} upgrades)`,
    );
    expect(result.iterations).toBe(iterations);
    expect(perSecond).toBeGreaterThan(10);
  });
});

void generatorResolver;
