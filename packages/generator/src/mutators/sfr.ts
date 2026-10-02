/**
 * The Overhaul SFR mutators — `overhaulSFR/mutators/**` of the frozen generator.
 *
 * Four mutators, and the warts they carry (all reproduced, all listed in the R4
 * report):
 *
 *  - `random_block` reads its index list in the `0 = air, k = block k - 1` domain
 *    and subtracts 1 to reach the grid's integer domain;
 *  - `random_cell` reads the *same* list but uses the values raw — no `- 1`. In
 *    Java's grid domain (`-1 = air, 0 = entry 0`) that is an off-by-one, and it is
 *    preserved: see {@link RandomCellMutator.run};
 *  - `random_cell`'s `add_moderators` and `use_reflectors` settings are never read
 *    by `run`, and its `reflectorBlocks` list is filled and never used;
 *  - `random_cell`'s corner loop computes `x`, `y`, `z` and then places the
 *    *target* cell, so the extremes of the cell are written more than once instead
 *    of the corners being filled.
 *
 * Each is a behaviour the shipped presets depend on, so "fixing" any of them
 * changes what the presets generate. They are documented rather than changed; the
 * only mutator behaviour we deliberately changed is `random_quantity`'s
 * serialization (see `mutator.ts`).
 */

import type { Configuration } from '@ncplanner/ncpf';
import type { SfrGeneratorGrid } from '../reactors/sfr.js';
import { importSfrIndices } from '../compiled-import.js';
import { currentRandom } from '../expression.js';
import { BaseMutator, registerMutator } from '../mutator.js';
import type { Setting } from '../setting.js';
import { SettingBoolean } from '../setting.js';
import type { JsonObject } from '../json.js';
import { booleanOf } from '../json.js';

/**
 * Java `BlockPos.forEachInCell` — walk the inclusive bounding box of two corners in
 * `x,y,z` ascending order and classify each cell by how many of its coordinates sit
 * on a box face (`cornerness`), dispatching to center/face/edge/corner.
 *
 * `cornerness` is computed against the *unextended* corner arguments, so a
 * degenerate axis (x1 === x2) contributes 1 to every cell.
 */
export function forEachInCell(
  x1: number,
  y1: number,
  z1: number,
  x2: number,
  y2: number,
  z2: number,
  onCorner: ((x: number, y: number, z: number) => void) | null,
  onEdge: ((x: number, y: number, z: number) => void) | null,
  onFace: ((x: number, y: number, z: number) => void) | null,
  onCenter: ((x: number, y: number, z: number) => void) | null,
): void {
  const consumers = [onCenter, onFace, onEdge, onCorner];
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  const minZ = Math.min(z1, z2);
  const maxZ = Math.max(z1, z2);
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        let cornerness = 0;
        if (x === x1 || x === x2) cornerness++;
        if (y === y1 || y === y2) cornerness++;
        if (z === z1 || z === z2) cornerness++;
        consumers[cornerness]?.(x, y, z);
      }
    }
  }
}

/**
 * Draw one entry from an index list.
 *
 * An **empty list returns 0 (air)** instead of drawing. Java's `rand.nextInt(0)`
 * throws, and an uncaught throw inside a generation thread kills that thread silently
 * — the user sees the search stop with no message. The situation is reachable from the
 * shipped data: the overhaul preset's `random_cell` list holds placeholder indices
 * `[1..5]`, which the frozen `importFrom` rule reads as `blocks[0..4]` (controller and
 * four casing variants), so the *fuel-cell* list it builds is genuinely empty. Rather
 * than crash, the call becomes a no-op and `reportEmptyList` says so once.
 */
function pick(list: readonly number[], what: string): number {
  if (list.length === 0) {
    reportEmptyList(what);
    return 0;
  }
  return list[currentRandom().nextIntBound(list.length)] ?? 0;
}

const reported = new Set<string>();

/** Say it once per mutator per process; a console line per call would be a flood. */
function reportEmptyList(what: string): void {
  if (reported.has(what)) return;
  reported.add(what);
  console.warn(
    `generator: ${what} has an empty index list, so it does nothing. ` +
      'Enable at least one entry in the generator settings.',
  );
}

/** `nuclearcraft:overhaul_sfr:random_block`. */
export class RandomBlockMutator extends BaseMutator<SfrGeneratorGrid> {
  readonly mutatorType = 'nuclearcraft:overhaul_sfr:random_block';
  readonly title = 'Random Block Mutator';
  readonly tooltip =
    'Changes a random block in the reactor to a random block from the list of allowed blocks';

  get settings(): readonly Setting[] {
    return [this.indicies, this.symmetry];
  }

  setIndicies(grid: SfrGeneratorGrid): void {
    this.indicies.init(
      grid.compiled.entries.map((e) => e.displayName),
      'Air',
    );
  }

  run(grid: SfrGeneratorGrid): void {
    const random = currentRandom();
    const [w, h, d] = grid.dims;
    // Java: `indicies.get()[rand.nextInt(len)] - 1`, i.e. list (air = 0) → grid
    // (air = -1). Our grid is 1-based with 0 = air, so the list value is used as is.
    const stored = pick(this.indicies.get(), this.title);
    this.symmetry.get().apply(random.nextIntBound(w), random.nextIntBound(h), random.nextIntBound(d), w, h, d, (cell) => {
      grid.setBlock(cell.x, cell.y, cell.z, stored);
    });
  }

  override importFrom(grid: SfrGeneratorGrid, source: unknown): void {
    if (source) {
      this.indicies.set(importSfrIndices(this.indicies.get(), source as Configuration, grid.compiled));
    }
    this.setIndicies(grid);
  }
}

/**
 * `nuclearcraft:overhaul_sfr:random_cell`.
 *
 * Adds a fuel cell (plus moderator cells between it and a second cell) so that a
 * brand-new random reactor has something valid to build from.
 */
export class RandomCellMutator extends BaseMutator<SfrGeneratorGrid> {
  readonly mutatorType = 'nuclearcraft:overhaul_sfr:random_cell';
  readonly title = 'Random Cell Mutator';
  readonly tooltip =
    'Adds a fuel cell at a random point in the reactor, optionally with moderator lines or other cells to ensure it can be valid';

  readonly addModerators = new SettingBoolean('Fill moderators to adjacent cells', true);
  readonly useReflectors = new SettingBoolean('Add reflectors', true);
  readonly additionalCells = new SettingBoolean('Add additional cells to produce a grid', true);

  get settings(): readonly Setting[] {
    return [
      this.indicies,
      this.addModerators,
      this.useReflectors,
      this.additionalCells,
      this.symmetry,
    ];
  }

  protected override bodyJson(): JsonObject {
    return {
      ...super.bodyJson(),
      add_moderators: this.addModerators.get(),
      use_reflectors: this.useReflectors.get(),
      additional_cells: this.additionalCells.get(),
    };
  }

  protected override loadBody(json: JsonObject): void {
    super.loadBody(json);
    this.addModerators.set(booleanOf(json.add_moderators, true));
    this.useReflectors.set(booleanOf(json.use_reflectors, true));
    this.additionalCells.set(booleanOf(json.additional_cells, true));
  }

  setIndicies(grid: SfrGeneratorGrid): void {
    this.indicies.init(
      grid.compiled.entries.map((e) => e.displayName),
      'Air',
    );
  }

  run(grid: SfrGeneratorGrid): void {
    const random = currentRandom();
    const entries = grid.compiled.entries;
    const list = this.indicies.get();

    // Java indexes `configuration.blockFuelCell[i]` with the *raw stored* value, so
    // an entry at list position k is classified as compiled entry k — one further
    // than the value means everywhere else. Reproduced below, together with the
    // `+ 1` that value needs to land in our grid's domain.
    const cellIndices: number[] = [];
    const moderatorIndices: number[] = [];
    const reflectorIndices: number[] = [];
    for (const i of list) {
      const classification = entries[i];
      if (classification?.template.fuelCell) cellIndices.push(i);
      if (classification?.template.moderator) moderatorIndices.push(i);
      if (classification?.template.reflector) reflectorIndices.push(i);
    }

    const [w, h, d] = grid.dims;
    const targetX = random.nextIntBound(w);
    const targetY = random.nextIntBound(h);
    const targetZ = random.nextIntBound(d);

    // "the number of moderators to be placed between this cell and the other one"
    let xOffset = 0;
    let yOffset = 0;
    let zOffset = 0;
    if (this.additionalCells.get()) {
      xOffset = random.nextIntBound(grid.compiled.neutronReach * 2 + 1) - grid.compiled.neutronReach;
      yOffset = random.nextIntBound(grid.compiled.neutronReach * 2 + 1) - grid.compiled.neutronReach;
      zOffset = random.nextIntBound(grid.compiled.neutronReach * 2 + 1) - grid.compiled.neutronReach;
      // Constrained so it never tries to place outside the reactor.
      xOffset = Math.min(w - targetX - 2, Math.max(xOffset, 1 - targetX));
      yOffset = Math.min(h - targetY - 2, Math.max(yOffset, 1 - targetY));
      zOffset = Math.min(d - targetZ - 2, Math.max(zOffset, 1 - targetZ));
    }

    let x1 = targetX;
    let y1 = targetY;
    let z1 = targetZ;
    let x2 = targetX;
    let y2 = targetY;
    let z2 = targetZ;
    if (xOffset < 0) x1 += xOffset - 1;
    if (xOffset > 0) x2 += xOffset + 1;
    if (yOffset < 0) y1 += yOffset - 1;
    if (yOffset > 0) y2 += yOffset + 1;
    if (zOffset < 0) z1 += zOffset - 1;
    if (zOffset > 0) z2 += zOffset + 1;

    const positions: number[][] = [];
    const blocks: number[] = [];
    const push = (x: number, y: number, z: number, stored: number): void => {
      positions.push([x, y, z]);
      blocks.push(stored);
    };

    forEachInCell(
      x1,
      y1,
      z1,
      x2,
      y2,
      z2,
      (x, y, z) => push(x, y, z, pick(cellIndices, this.title) + 1),
      (x, y, z) => push(x, y, z, pick(moderatorIndices, this.title) + 1),
      null,
      null,
    );

    // Java's corner loop: it computes `x`, `y`, `z` and then pushes the *target*
    // position anyway. Preserved verbatim.
    for (let X = 0; X <= (xOffset === 0 ? 0 : 1); X++) {
      for (let Y = 0; Y <= (yOffset === 0 ? 0 : 1); Y++) {
        for (let Z = 0; Z <= (zOffset === 0 ? 0 : 1); Z++) {
          push(targetX, targetY, targetZ, pick(cellIndices, this.title) + 1);
        }
      }
    }
    push(targetX, targetY, targetZ, pick(cellIndices, this.title) + 1);

    for (let i = 0; i < positions.length; i++) {
      const position = positions[i];
      const stored = blocks[i] ?? 0;
      if (position === undefined) continue;
      const [px, py, pz] = position as [number, number, number];
      this.symmetry.get().apply(px, py, pz, w, h, d, (cell) => {
        grid.setBlock(cell.x, cell.y, cell.z, stored);
      });
    }

    // `reflectorIndices` is intentionally unused: Java fills it and never reads it.
    void reflectorIndices;
  }

  override importFrom(grid: SfrGeneratorGrid, source: unknown): void {
    if (source) {
      this.indicies.set(importSfrIndices(this.indicies.get(), source as Configuration, grid.compiled));
    }
    this.setIndicies(grid);
  }
}

/** `nuclearcraft:overhaul_sfr:random_coolant_recipe`. */
export class RandomCoolantRecipeMutator extends BaseMutator<SfrGeneratorGrid> {
  readonly mutatorType = 'nuclearcraft:overhaul_sfr:random_coolant_recipe';
  readonly title = 'Random Coolant Recipe Mutator';
  readonly tooltip =
    "Changes the reactor's coolant recipe to a random one from the list of allowed recipes";

  get settings(): readonly Setting[] {
    return [this.indicies];
  }

  protected override bodyJson(): JsonObject {
    return { indicies: [...this.indicies.get()], type: this.mutatorType };
  }

  protected override loadBody(json: JsonObject): void {
    this.indicies.set(
      Array.isArray(json.indicies)
        ? json.indicies.filter((v): v is number => typeof v === 'number').map((v) => Math.trunc(v))
        : [],
    );
  }

  setIndicies(grid: SfrGeneratorGrid): void {
    this.indicies.init(grid.compiled.coolantRecipes.map((r) => r.displayName));
  }

  run(grid: SfrGeneratorGrid): void {
    // Java stores the coolant *index* directly here (no `- 1`, no air entry).
    grid.coolantRecipe = pick(this.indicies.get(), this.title);
  }
}

/**
 * `nuclearcraft:overhaul_sfr:clear_invalid` — "Replaces all invalid blocks in the
 * reactor with air".
 *
 * Java's predicate was `blockActive + moderatorValid <= 0` over integer counters the
 * lite engine filled while it propagated clusters. The kernel has no such counters;
 * it exposes the same predicate per block (`SfrBlock.isActive()` and
 * `SfrBlock.moderatorValid`), which is what the editor's own block rendering reads.
 * The one case the counters covered and the predicate does not is a block that is
 * active *only* by virtue of cluster membership; see the R4 report's 未验证 list.
 */
export class ClearInvalidMutator extends BaseMutator<SfrGeneratorGrid> {
  readonly mutatorType = 'nuclearcraft:overhaul_sfr:clear_invalid';
  readonly title = 'Clear Invalid Mutator';
  readonly tooltip = 'Replaces all invalid blocks in the reactor with air';

  get settings(): readonly Setting[] {
    return [];
  }

  protected override bodyJson(): JsonObject {
    return { type: this.mutatorType };
  }

  protected override loadBody(_json: JsonObject): void {}

  setIndicies(_grid: SfrGeneratorGrid): void {}

  run(grid: SfrGeneratorGrid): void {
    // Java `if(blockActive==null)return;` — nothing to clear before the first run.
    if (!grid.calculated) return;
    const [w, h, d] = grid.dims;
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        for (let z = 0; z < d; z++) {
          if (!grid.isActiveAt(x, y, z) && !grid.isModeratorValidAt(x, y, z)) {
            grid.setBlock(x, y, z, 0);
          }
        }
      }
    }
  }
}

/** Register every Overhaul SFR mutator under its NCPF name. */
export function registerSfrMutators(): void {
  registerMutator('nuclearcraft:overhaul_sfr:random_block', () => new RandomBlockMutator());
  registerMutator('nuclearcraft:overhaul_sfr:random_cell', () => new RandomCellMutator());
  registerMutator(
    'nuclearcraft:overhaul_sfr:random_coolant_recipe',
    () => new RandomCoolantRecipeMutator(),
  );
  registerMutator('nuclearcraft:overhaul_sfr:clear_invalid', () => new ClearInvalidMutator());
}
