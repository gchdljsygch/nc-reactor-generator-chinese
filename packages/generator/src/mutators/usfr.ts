/**
 * The Underhaul SFR mutators — `underhaulSFR/mutators/**` of the frozen generator.
 *
 * Three mutators. Underhaul SFR has one reactor-wide fuel and no moderator-validity
 * arrays, so `clear_invalid`'s predicate collapses to "the cell is not active"
 * (Java `blockValid + blockEfficiency <= 0`, where `blockEfficiency` is zero for
 * every inactive cell).
 */

import type { Configuration } from '@ncplanner/ncpf';
import type { JsonObject } from '../json.js';
import type { UsfrGeneratorGrid } from '../reactors/usfr.js';
import { importUsfrIndices } from '../compiled-import.js';
import { currentRandom } from '../expression.js';
import { BaseMutator, registerMutator } from '../mutator.js';
import type { Setting } from '../setting.js';

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

/** `nuclearcraft:underhaul_sfr:random_block`. */
export class RandomBlockMutator extends BaseMutator<UsfrGeneratorGrid> {
  readonly mutatorType = 'nuclearcraft:underhaul_sfr:random_block';
  readonly title = 'Random Block Mutator';
  readonly tooltip =
    'Changes a random block in the reactor to a random block from the list of allowed blocks';

  get settings(): readonly Setting[] {
    return [this.indicies, this.symmetry];
  }

  setIndicies(grid: UsfrGeneratorGrid): void {
    this.indicies.init(
      grid.compiled.entries.map((e) => e.displayName),
      'Air',
    );
  }

  run(grid: UsfrGeneratorGrid): void {
    const random = currentRandom();
    const [w, h, d] = grid.dims;
    const stored = pick(this.indicies.get(), this.title);
    this.symmetry.get().apply(
      random.nextIntBound(w),
      random.nextIntBound(h),
      random.nextIntBound(d),
      w,
      h,
      d,
      (cell) => {
        grid.setBlock(cell.x, cell.y, cell.z, stored);
      },
    );
  }

  override importFrom(grid: UsfrGeneratorGrid, source: unknown): void {
    if (source) {
      this.indicies.set(
        importUsfrIndices(this.indicies.get(), source as Configuration, grid.compiled),
      );
    }
    this.setIndicies(grid);
  }
}

/** `nuclearcraft:underhaul_sfr:random_fuel`. */
export class RandomFuelMutator extends BaseMutator<UsfrGeneratorGrid> {
  readonly mutatorType = 'nuclearcraft:underhaul_sfr:random_fuel';
  readonly title = 'Random Fuel Mutator';
  readonly tooltip = "Changes the reactor's fuel to a random fuel from the list of allowed fuels";

  get settings(): readonly Setting[] {
    return [this.indicies];
  }

  protected override bodyJson(): JsonObject {
    return { indicies: [...this.indicies.get()], type: this.mutatorType };
  }

  protected override loadBody(json: JsonObject): void {
    const raw = json.indicies;
    this.indicies.set(
      Array.isArray(raw)
        ? raw.filter((v): v is number => typeof v === 'number').map((v) => Math.trunc(v))
        : [],
    );
  }

  setIndicies(grid: UsfrGeneratorGrid): void {
    this.indicies.init(grid.compiled.fuels.map((f) => f.displayName));
  }

  run(grid: UsfrGeneratorGrid): void {
    // Java stores the fuel *index* directly (no air entry, no `- 1`).
    grid.fuel = pick(this.indicies.get(), this.title);
  }
}

/**
 * `nuclearcraft:underhaul_sfr:clear_invalid`.
 *
 * See the module header: `blockValid + blockEfficiency <= 0` is `!isActive()`.
 */
export class ClearInvalidMutator extends BaseMutator<UsfrGeneratorGrid> {
  readonly mutatorType = 'nuclearcraft:underhaul_sfr:clear_invalid';
  readonly title = 'Clear Invalid Mutator';
  readonly tooltip = 'Replaces all invalid blocks in the reactor with air';

  get settings(): readonly Setting[] {
    return [];
  }

  protected override bodyJson(): JsonObject {
    return { type: this.mutatorType };
  }

  protected override loadBody(_json: JsonObject): void {}

  setIndicies(_grid: UsfrGeneratorGrid): void {}

  run(grid: UsfrGeneratorGrid): void {
    // Java `if(blockValid==null)return;` — nothing to clear before the first run.
    if (!grid.calculated) return;
    const [w, h, d] = grid.dims;
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        for (let z = 0; z < d; z++) {
          if (!grid.isActiveAt(x, y, z)) grid.setBlock(x, y, z, 0);
        }
      }
    }
  }
}

/** Register every Underhaul SFR mutator under its NCPF name. */
export function registerUsfrMutators(): void {
  registerMutator('nuclearcraft:underhaul_sfr:random_block', () => new RandomBlockMutator());
  registerMutator('nuclearcraft:underhaul_sfr:random_fuel', () => new RandomFuelMutator());
  registerMutator('nuclearcraft:underhaul_sfr:clear_invalid', () => new ClearInvalidMutator());
}
