import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import {
  AIR,
  applyOutcome,
  createGrid,
  describePresets,
  prepareRun,
  runPrepared,
  translateIndices,
} from '@ncplanner/app';
import { loadShippedSfrConfig, loadShippedUsfrConfig } from '@ncplanner/kernel';
import { registerAllMutators } from '@ncplanner/generator';

/**
 * R4.4 — the app-side generator wiring.
 *
 * The generator package's own tests prove the search works. These prove the *bridge*:
 * that an app grid becomes a generator grid with every cell in the right place, that a
 * result comes back the same way, and that the preset translation actually happens
 * (skipping it silently turns `random_cell` into a no-op — measured, not assumed).
 *
 * The round trip is tested *cell by cell* rather than by a summary statistic, because an
 * off-by-one in the casing offset still yields a plausible reactor with a plausible score.
 */

const ROOT = new URL('../../../', import.meta.url);
const CONFIG_PATH = fileURLToPath(new URL('datasets/configurations/nuclearcraft.ncpf.json', ROOT));

/** `Water Heat Sink` in the shipped overhaul configuration's block list. */
const WATER_HEAT_SINK = 12;
/** `Fuel Cell` in the shipped overhaul configuration's block list. */
const FUEL_CELL = 44;

function presetDocuments(): Record<string, unknown> {
  const read = (name: string): unknown =>
    JSON.parse(
      readFileSync(
        fileURLToPath(new URL(`datasets/configurations/generators/${name}.ncpf.json`, ROOT)),
        'utf8',
      ),
    ) as unknown;
  return {
    'overhaul_sfr/efficiency': read('overhaul_sfr/efficiency'),
    'overhaul_sfr/output': read('overhaul_sfr/output'),
    'underhaul_sfr/efficiency': read('underhaul_sfr/efficiency'),
    'underhaul_sfr/output': read('underhaul_sfr/output'),
  };
}

const sfrConfig = loadShippedSfrConfig(CONFIG_PATH);
const usfrConfig = loadShippedUsfrConfig(CONFIG_PATH);
const DOCUMENTS = presetDocuments();
const SFR_PRESETS = describePresets(DOCUMENTS, 'sfr');
const USFR_PRESETS = describePresets(DOCUMENTS, 'usfr');

registerAllMutators();

/**
 * A design the way a user would make one.
 *
 * `blocks[x][y][z]` is a **value** — an index into the configuration's block list
 * (`model/grid.ts`) — so the arrays are spatial and a cell holds whichever block the user
 * painted. `model/document.ts#gridOf` builds a real design the same way.
 *
 * The two cells land at app `(1,1,1)` and `(2,1,1)`, which are generator interior
 * `(0,0,0)` and `(1,0,0)`.
 */
function filledDesign(dims: readonly [number, number, number]) {
  const grid = createGrid([dims[0] + 2, dims[1] + 2, dims[2] + 2], { coolant_recipe: 0 });
  grid.blocks[1]![1]![1] = WATER_HEAT_SINK;
  grid.blocks[2]![1]![1] = WATER_HEAT_SINK;
  return grid;
}

function countFilled(blocks: readonly number[][][]): number {
  let filled = 0;
  for (const plane of blocks) {
    for (const row of plane) {
      for (const value of row) if (value !== AIR) filled++;
    }
  }
  return filled;
}

type Prepared = ReturnType<typeof prepareRun>;

describe('R4.4 presets', () => {
  it("describes each reactor's presets, and only that reactor's", () => {
    expect(SFR_PRESETS.map((p) => p.id)).toEqual([
      'overhaul_sfr/efficiency',
      'overhaul_sfr/output',
    ]);
    expect(USFR_PRESETS.map((p) => p.id)).toEqual([
      'underhaul_sfr/efficiency',
      'underhaul_sfr/output',
    ]);
  });

  it('carries the stripped configuration each preset was written against', () => {
    // The translation is meaningless without it: the preset's indices address *this*
    // six-block placeholder list, not the real configuration.
    for (const preset of SFR_PRESETS) {
      expect(preset.source, preset.id).toBeDefined();
      expect(preset.source?.blocks.length, preset.id).toBe(6);
    }
  });

  it('reports the structure a user reads in the picker', () => {
    expect(SFR_PRESETS[0]?.label).toBe('Efficiency');
    expect(SFR_PRESETS[0]?.detail).toBe('4 stages / 7 steps');
  });
});

describe('R4.4 bridge: the round trip', () => {
  it('sizes the generator grid from the interior, not the whole design', () => {
    const run = prepareRun({
      design: filledDesign([7, 7, 7]),
      config: sfrConfig,
      kind: 'sfr',
      preset: SFR_PRESETS[0]!,
    });
    // The app's dims include the casing ring; the generator's do not.
    expect([...run.grid.dims]).toEqual([7, 7, 7]);
  });

  it('places every interior cell where it was, with nothing added', () => {
    const run = prepareRun({
      design: filledDesign([7, 7, 7]),
      config: sfrConfig,
      kind: 'sfr',
      preset: SFR_PRESETS[0]!,
    });
    expect(run.grid.getBlock(0, 0, 0)).toBeGreaterThan(0);
    expect(run.grid.getBlock(1, 0, 0)).toBeGreaterThan(0);
    let filled = 0;
    const [w, h, d] = run.grid.dims;
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        for (let z = 0; z < d; z++) if (run.grid.getBlock(x, y, z) > 0) filled++;
      }
    }
    expect(filled, 'cells copied into the generator grid').toBe(2);
  });

  it('writes a result back without shifting it', () => {
    const design = filledDesign([7, 7, 7]);
    const run = prepareRun({ design, config: sfrConfig, kind: 'sfr', preset: SFR_PRESETS[0]! });
    const next = applyOutcome(design, {
      grid: run.grid,
      iterations: 0,
      upgrades: 0,
      stop: 'completed',
      best: '',
    });
    expect([...next.dims]).toEqual([...design.dims]);
    expect(countFilled(next.blocks), 'still exactly two cells').toBe(2);
    // The same app coordinates, not shifted by the casing offset.
    expect(next.blocks[1]![1]![1]).toBe(WATER_HEAT_SINK);
    expect(next.blocks[2]![1]![1]).toBe(WATER_HEAT_SINK);
  });

  it('resolves different blocks to different generator entries', () => {
    // Two blocks collapsing onto one entry would be an index-space bug that still
    // "works": the generator would silently place the wrong block.
    const design = createGrid([7, 7, 7], {});
    design.blocks[1]![1]![1] = WATER_HEAT_SINK;
    design.blocks[2]![1]![1] = FUEL_CELL;
    // A fuel cell carries 81 fuel recipes in the shipped configuration, so it is only
    // placeable *with* one. "Fuel cell, no recipe" is genuinely not one of the 81 entries.
    design.recipes[2]![1]![1] = 0;
    const run = prepareRun({ design, config: sfrConfig, kind: 'sfr', preset: SFR_PRESETS[0]! });
    const heatsink = run.grid.getBlock(0, 0, 0);
    const cell = run.grid.getBlock(1, 0, 0);
    expect(heatsink).toBeGreaterThan(0);
    expect(cell).toBeGreaterThan(0);
    expect(heatsink).not.toBe(cell);
    expect(run.grid.compiled.entries[heatsink - 1]?.blockListIndex).toBe(WATER_HEAT_SINK);
    expect(run.grid.compiled.entries[cell - 1]?.blockListIndex).toBe(FUEL_CELL);
    expect(run.grid.compiled.entries[cell - 1]?.recipeIndex).toBe(0);
  });

  it('leaves a recipe-bearing block as air when its recipe is missing', () => {
    // The complement of the case above: inventing a recipe would place a block the design
    // did not ask for.
    const design = createGrid([7, 7, 7], {});
    design.blocks[1]![1]![1] = FUEL_CELL;
    const run = prepareRun({ design, config: sfrConfig, kind: 'sfr', preset: SFR_PRESETS[0]! });
    expect(run.grid.getBlock(0, 0, 0)).toBe(0);
  });

  it('refuses a block index the configuration does not define', () => {
    // A design from another file would otherwise yield a plausible reactor with the wrong
    // blocks in it; refusing is the only safe answer.
    const design = createGrid([7, 7, 7], {});
    design.blocks[1]![1]![1] = 9999;
    expect(() =>
      prepareRun({ design, config: sfrConfig, kind: 'sfr', preset: SFR_PRESETS[0]! }),
    ).toThrow(/not loaded from the same file/);
  });

  it('skips a real block the generator cannot place, without complaining', () => {
    // Block 0 is the controller: defined by the configuration, but with no compiled entry,
    // because the generator never mutates structural blocks. It must be skipped silently —
    // reporting it would reject every design that contains a casing or a port.
    const design = createGrid([7, 7, 7], {});
    design.blocks[1]![1]![1] = 0;
    const run = prepareRun({ design, config: sfrConfig, kind: 'sfr', preset: SFR_PRESETS[0]! });
    expect(run.grid.getBlock(0, 0, 0)).toBe(0);
  });

  it('accepts an empty design', () => {
    // Air is `-1` on the app side; a guard that forgot that would reject every fresh
    // reactor with "unknown block index -1".
    const design = createGrid([7, 7, 7], {});
    expect(() =>
      prepareRun({ design, config: sfrConfig, kind: 'sfr', preset: SFR_PRESETS[0]! }),
    ).not.toThrow();
  });

  it('leaves an empty design empty', () => {
    const design = createGrid([7, 7, 7], {});
    const run = prepareRun({ design, config: sfrConfig, kind: 'sfr', preset: SFR_PRESETS[0]! });
    const next = applyOutcome(design, {
      grid: run.grid,
      iterations: 0,
      upgrades: 0,
      stop: 'completed',
      best: '',
    });
    expect(countFilled(next.blocks)).toBe(0);
  });

  it('clamps a degenerate design to a 1x1x1 interior instead of failing', () => {
    // `interiorDims` is `Math.max(1, dim - 2)` (see `model/grid.ts`), so a 2x2x2 grid
    // yields a one-cell interior. The generator follows the app's rule rather than
    // inventing a second one; the "no interior" guard covers an already-degenerate design,
    // which the editor cannot produce.
    const tiny = createGrid([2, 2, 2], {});
    const run = prepareRun({
      design: tiny,
      config: sfrConfig,
      kind: 'sfr',
      preset: SFR_PRESETS[0]!,
    });
    expect([...run.grid.dims]).toEqual([1, 1, 1]);
  });
});

describe('R4.4 preset translation', () => {
  it('expands the placeholder lists into the real compiled entry space', () => {
    const run = prepareRun({
      design: filledDesign([7, 7, 7]),
      config: sfrConfig,
      kind: 'sfr',
      preset: SFR_PRESETS[1]!,
    });
    // The compiled list is the real configuration's: 58 blocks, with one entry per
    // (block, fuel) and (block, irradiator recipe) pair, so far more than six.
    expect(run.grid.entryCount).toBeGreaterThan(30);
  });

  it('leaves every translated index pointable at a real entry', () => {
    const run = prepareRun({
      design: filledDesign([7, 7, 7]),
      config: sfrConfig,
      kind: 'sfr',
      preset: SFR_PRESETS[1]!,
    });
    for (const list of mutatedIndexLists(run)) {
      for (const index of list) {
        if (index === 0) continue;
        expect(run.grid.compiled.entries[index - 1], `entry ${index}`).toBeDefined();
      }
    }
  });

  it('translates against the preset\'s own configuration, not the target', () => {
    // The whole point: reading the stored list against the *real* configuration would
    // address casings instead of the placeholder functions, and `random_cell` would end
    // up with no fuel cells to place.
    const run = prepareRun({
      design: filledDesign([7, 7, 7]),
      config: sfrConfig,
      kind: 'sfr',
      preset: SFR_PRESETS[1]!,
    });
    const lists = mutatedIndexLists(run);
    expect(lists.length, 'index lists the preset holds').toBeGreaterThan(0);
    // Every list must be non-empty after translation: an empty one means the function
    // flags matched nothing, which is exactly the silent no-op this guards against.
    for (const list of lists) {
      expect(list.length, JSON.stringify(list)).toBeGreaterThan(0);
    }
    // The preset's `random_cell` step stores `indicies [1, 2, 3, 4, 5]`, and the frozen
    // import rule reads that as `blocks[0..4]` of the preset's *own* placeholder list —
    // where `blocks[0]` is `FUEL CELL`. So after translation that step must still be able
    // to place fuel cells; if it cannot, the run reports iterations while changing nothing.
    expect(placeableFuelCells(run).length, 'fuel cells the preset can place').toBeGreaterThan(0);
  });
});

describe('R4.4 running', () => {
  it("improves a real design and reports the kernel's own tooltip", () => {
    const run = prepareRun({
      design: filledDesign([7, 7, 7]),
      config: sfrConfig,
      kind: 'sfr',
      preset: SFR_PRESETS[1]!,
    });
    const outcome = runPrepared({
      prepared: run,
      start: run.grid,
      seed: 4242,
      iterations: 2_000,
      signal: { cancelled: false },
      onProgress: () => {},
    });
    expect(outcome.stop).toBe('completed');
    expect(outcome.iterations).toBe(2_000);
    expect(outcome.upgrades, 'the search accepted at least one result').toBeGreaterThan(0);
    expect(outcome.best).toContain('Total Output');
  });

  it('is reproducible for a fixed seed', () => {
    const runOnce = () => {
      const run = prepareRun({
        design: filledDesign([7, 7, 7]),
        config: sfrConfig,
        kind: 'sfr',
        preset: SFR_PRESETS[1]!,
      });
      return runPrepared({
        prepared: run,
        start: run.grid,
        seed: 99,
        iterations: 300,
        signal: { cancelled: false },
        onProgress: () => {},
      });
    };
    const a = runOnce();
    const b = runOnce();
    expect(b.iterations).toBe(a.iterations);
    expect(b.upgrades).toBe(a.upgrades);
    expect([...b.grid.toIndices()]).toEqual([...a.grid.toIndices()]);
  });

  it('stops when the signal is raised and says so', () => {
    const run = prepareRun({
      design: filledDesign([7, 7, 7]),
      config: sfrConfig,
      kind: 'sfr',
      preset: SFR_PRESETS[1]!,
    });
    const signal = { cancelled: false };
    let ticks = 0;
    const outcome = runPrepared({
      prepared: run,
      start: run.grid,
      seed: 1,
      iterations: 1_000_000,
      signal,
      onProgress: () => {
        ticks++;
        // Cancel from inside the progress callback, the way the Stop button does.
        signal.cancelled = true;
      },
    });
    expect(outcome.stop).toBe('cancelled');
    // Throttled progress means the signal is observed at the next callback, not
    // instantly — but the loop must stop well short of a million.
    expect(outcome.iterations).toBeLessThan(1_000_000);
  });

  it('runs the underhaul preset against an underhaul design', () => {
    const design = createGrid([7, 7, 7], { fuel: 0 });
    // Underhaul SFR block index 0 is the FUEL CELL (the fuel itself is reactor-wide,
    // `grid.fuel`, not a per-cell recipe).
    design.blocks[1]![1]![1] = 0;
    const run = prepareRun({
      design,
      config: usfrConfig,
      kind: 'usfr',
      preset: USFR_PRESETS[1]!,
    });
    const outcome = runPrepared({
      prepared: run,
      start: run.grid,
      seed: 7,
      iterations: 500,
      signal: { cancelled: false },
      onProgress: () => {},
    });
    expect(outcome.iterations).toBe(500);
    expect(outcome.best).toContain('Total Output');
  });
});

/**
 * The index lists a prepared run's mutators actually hold.
 *
 * Read through the mutator objects (not the file), because what matters is whether the
 * *translation* reached them — a translated list that never got written back into the
 * mutator would leave the search working on placeholder indices.
 */
function mutatedIndexLists(run: Prepared): number[][] {
  const out: number[][] = [];
  for (const stage of run.parsed?.generator.stages ?? []) {
    for (const step of [...stage.steps, ...stage.postProcessing]) {
      const mutator = step.mutator as {
        mutatorType?: string;
        indicies?: { get(): number[] };
      };
      // `clear_invalid` takes no index list at all, so an empty list there is correct and
      // not a translation failure. Only the mutators that *have* a list are interesting.
      if (mutator.mutatorType?.endsWith(':clear_invalid') === true) continue;
      if (mutator.indicies !== undefined) out.push([...mutator.indicies.get()]);
    }
  }
  return out;
}

/**
 * The fuel-cell entries the prepared generator's steps can place.
 *
 * The shipped overhaul preset stores `indicies [1, 2, 3, 4, 5]` for its `random_cell`
 * step, which the frozen import rule reads as `blocks[0..4]` of the preset's **own**
 * placeholder list — and `blocks[0]` there is `FUEL CELL`. So the step does have a fuel
 * cell to place, and this is what proves the translation preserved it.
 */
function placeableFuelCells(run: Prepared): number[] {
  const out: number[] = [];
  for (const list of mutatedIndexLists(run)) {
    for (const index of list) {
      if (index === 0) continue;
      if (run.grid.compiled.entries[index - 1]?.template.fuelCell === true) out.push(index);
    }
  }
  return out;
}

void translateIndices;
