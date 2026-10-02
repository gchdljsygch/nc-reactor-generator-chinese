/**
 * R4.4 — the bridge between the app's grid model and `@ncplanner/generator`.
 *
 * ## Why a bridge and not a direct import
 *
 * The app addresses a cell as `blocks[x][y][z]` → **index into
 * `configuration.blocks`**, with `dims` including the casing ring. The generator
 * addresses a cell as a flat `Int32Array` → **index into its compiled entry list**,
 * with interior `dims`. Those are three separate conversions (nesting, casing offset,
 * index space) and getting any of them wrong shifts or scrambles the reactor. They live
 * here, in one file, so there is exactly one place to get right and one place to test.
 *
 * ## Index-space conversion
 *
 * `configuration.blocks[i]` is a block *element*. The generator's entry list holds one
 * entry per (block, recipe) pair, so `entryFor(blockListIndex, recipeIndex)` is the
 * whole conversion. A block with no recipes has `recipeIndex === -1` on both sides.
 *
 * ## Interior vs exterior
 *
 * The generator runs on the **interior** (`dims - 2`): its compiled entry list excludes
 * casings, and its physics treats the shell as structural. The bridge therefore copies
 * `[1 .. dim-2]` in and writes it back out, leaving the casing ring alone.
 */

import type { GridState } from '../model/grid.js';
import { AIR, interiorDims } from '../model/grid.js';
import type { SfrGeneratorGrid, UsfrGeneratorGrid } from '@ncplanner/generator';
import { compileSfr, compileUsfr, SfrGeneratorGrid as SfrGridCtor, UsfrGeneratorGrid as UsfrGridCtor } from '@ncplanner/generator';
import type { SfrConfig, SfrTemplate, UsfrConfig, UsfrTemplate } from '@ncplanner/kernel';

/** A generator grid for either supported reactor. */
export type GeneratorGrid = SfrGeneratorGrid | UsfrGeneratorGrid;

/**
 * Which configuration the generator can run for a given app configuration id.
 *
 * The generator covers the two fission reactors. MSR and Turbine are *not* covered —
 * they ship no generator preset, so offering the panel for them would promise something
 * that cannot run. `docs/r4/README.md` records this.
 */
export type GeneratorKind = 'sfr' | 'usfr';

export function generatorKindFor(configId: string): GeneratorKind | null {
  if (configId === 'nuclearcraft:overhaul_sfr') return 'sfr';
  if (configId === 'nuclearcraft:underhaul_sfr') return 'usfr';
  return null;
}

export interface BuiltGrid<TGrid extends GeneratorGrid> {
  readonly grid: TGrid;
  /** The compiled entry list, for reporting and for the UI's block names. */
  readonly entries: readonly { index: number; displayName: string }[];
}

/** Build a generator grid at the app grid's interior size and copy the design in. */
export function toGeneratorGrid(
  state: GridState,
  config: SfrConfig | UsfrConfig,
  kind: GeneratorKind,
): BuiltGrid<GeneratorGrid> {
  // The app's dims include the casing ring; the generator runs on the interior.
  const interior = interiorDims(state.dims);
  if (interior[0] <= 0 || interior[1] <= 0 || interior[2] <= 0) {
    throw new Error(
      `the design is ${state.dims.join('x')}, which has no interior to generate in ` +
        '(a reactor needs at least a 3x3x3 grid)',
    );
  }

  const grid =
    kind === 'sfr'
      ? (new SfrGridCtor(
          compileSfr(config as SfrConfig),
          interior,
          Math.max(0, state.scalars['coolant_recipe'] ?? 0),
        ) as GeneratorGrid)
      : (new UsfrGridCtor(
          compileUsfr(config as UsfrConfig),
          interior,
          Math.max(0, state.scalars['fuel'] ?? 0),
        ) as GeneratorGrid);

  const compiled = grid.compiled;
  /**
   * The highest block index the *configuration* defines.
   *
   * `compiled.entries` only covers placeable blocks (casings, controllers and ports are
   * excluded by design), so it cannot answer "is this a real block?". The configuration's
   * own block list does, and it is the same list the design's cell values index into.
   */
  const knownBlocks = config.configuration.blocks.length;
  const unknown: number[] = [];

  for (let x = 0; x < interior[0]; x++) {
    for (let y = 0; y < interior[1]; y++) {
      for (let z = 0; z < interior[2]; z++) {
        const block = state.blocks[x + 1]?.[y + 1]?.[z + 1] ?? AIR;
        if (block === AIR || block < 0) continue;
        // A block index outside the configuration's own list means the design came from a
        // different file, and every subsequent index would be misread. Say so once, below.
        if (block >= knownBlocks) {
          unknown.push(block);
          continue;
        }
        const recipe = state.recipes[x + 1]?.[y + 1]?.[z + 1] ?? -1;
        const entry = grid.entryFor(block, recipe);
        // `entry === 0` is the ordinary "the generator does not place this" case: a casing,
        // a controller, a port, or a recipe-bearing block with no recipe selected. Silently
        // skipping is right — reporting it would reject nearly every real design.
        if (entry === 0) continue;
        grid.setBlock(x, y, z, entry);
      }
    }
  }

  if (unknown.length > 0) {
    const distinct = [...new Set(unknown)].sort((a, b) => a - b);
    throw new Error(
      `generator bridge: the design uses block index ${distinct.slice(0, 4).join(', ')}` +
        `${distinct.length > 4 ? ' (and more)' : ''}, but the configuration defines only ` +
        `${knownBlocks} blocks; the design and the configuration were not loaded from the ` +
        'same file',
    );
  }

  return {
    grid,
    entries: compiled.entries.map((e) => ({ index: e.index, displayName: e.displayName })),
  };
}

/** Write a generator grid back into an app grid, in place. */
export function fromGeneratorGrid(target: GridState, source: GeneratorGrid): void {
  const [w, h, d] = source.dims;
  for (let x = 0; x < w; x++) {
    const plane = target.blocks[x + 1];
    const recipes = target.recipes[x + 1];
    if (plane === undefined || recipes === undefined) continue;
    for (let y = 0; y < h; y++) {
      const row = plane[y + 1];
      const recipeRow = recipes[y + 1];
      if (row === undefined || recipeRow === undefined) continue;
      for (let z = 0; z < d; z++) {
        const stored = source.getBlock(x, y, z);
        const entry = stored >= 1 ? source.compiled.entries[stored - 1] : undefined;
        if (entry === undefined) {
          row[z + 1] = AIR;
          recipeRow[z + 1] = -1;
          continue;
        }
        row[z + 1] = entry.blockListIndex;
        recipeRow[z + 1] = entry.recipeIndex;
      }
    }
  }
}

/** The block names the generator can place, for a palette preview. */
export function placeableNames(grid: GeneratorGrid): string[] {
  return grid.compiled.entries.map((e: { displayName: string }) => e.displayName);
}

export type { SfrTemplate, UsfrTemplate };
