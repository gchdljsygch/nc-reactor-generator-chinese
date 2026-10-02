/**
 * `LiteOverhaulSFR` — the Overhaul SFR generator grid.
 *
 * ## What this is not
 *
 * It is **not** a second reactor. The frozen `LiteOverhaulSFR.java` (982 lines) was
 * a hand-inlined copy of `OverhaulSFR`'s physics, and R0 measured the two
 * disagreeing on 33.9% of random grids. Here the grid owns *storage and index
 * bookkeeping* and delegates every number to `SfrFastReactor`, which calls the very
 * same `OverhaulSfrReactor.recalculate()` the editor calls. So a grid the generator
 * reports as `Total Output: X` and the same grid opened in the editor both read X
 * from one implementation.
 *
 * ## What is deliberately gone
 *
 * `CompiledOverhaulSFRConfiguration`'s cooling/flux/rule/cluster compile step
 * (heatsink rule layering, `heatsinkCalculationStepIndicies`, `hasRecursiveRules`)
 * existed purely to speed up the inlined loops. The kernel owns rules and
 * clustering; recompiling them here would be the second engine again.
 */

import type { SfrConfig, SfrFuel, SfrIrradiatorRecipe, SfrTemplate } from '@ncplanner/kernel';
import { SfrFastReactor, type SfrStats } from '@ncplanner/kernel';
import {
  compileSfr,
  type CompiledEntry,
  type CompiledSfrConfiguration,
  type CoolantRecipeEntry,
} from '../compiled.js';
import {
  blockCountVariables,
  type Dims,
  type GeneratorGrid,
  type PortableCell,
} from '../grid.js';
import { floatVariable, intVariable, type Variable } from '../variable.js';

export type { PortableCell };

export class SfrGeneratorGrid implements GeneratorGrid<SfrGeneratorGrid> {
  readonly dims: Dims;
  readonly blocks: Int32Array;
  readonly compiled: CompiledSfrConfiguration;
  /** Index into `compiled.coolantRecipes` (Java `LiteOverhaulSFR.coolantRecipe`). */
  coolantRecipe: number;
  /** See {@link GeneratorGrid.calculated}. */
  calculated = false;

  private readonly fast: SfrFastReactor;
  private readonly active: Uint8Array;
  private readonly moderators: Uint8Array;
  private readonly counts: Int32Array;
  private readonly stats: SfrStats;
  private readonly vars: Variable[];

  constructor(compiled: CompiledSfrConfiguration, dims: Dims, coolantRecipe = 0) {
    this.compiled = compiled;
    this.dims = dims;
    this.coolantRecipe = coolantRecipe;
    const volume = dims[0] * dims[1] * dims[2];
    this.blocks = new Int32Array(volume);
    this.active = new Uint8Array(volume);
    this.moderators = new Uint8Array(volume);
    this.counts = new Int32Array(compiled.entries.length);
    this.fast = new SfrFastReactor(compiled.config, dims, this.coolant().recipe);
    this.stats = this.fast.stats();
    this.vars = this.makeVariables();
  }

  // -- geometry ------------------------------------------------------------

  index(x: number, y: number, z: number): number {
    return (x * this.dims[1] + y) * this.dims[2] + z;
  }

  getBlock(x: number, y: number, z: number): number {
    return this.blocks[this.index(x, y, z)] ?? 0;
  }

  setBlock(x: number, y: number, z: number, entry: number): void {
    const i = this.index(x, y, z);
    const clamped = entry >= 1 && entry <= this.compiled.entries.length ? entry | 0 : 0;
    this.blocks[i] = clamped;
  }

  dimension(i: number): number {
    return this.dims[i] ?? 0;
  }

  get entryCount(): number {
    return this.compiled.entries.length;
  }

  /** Java `blockCount` — how many cells hold each compiled entry. */
  countOf(entryIndex: number): number {
    return this.counts[entryIndex - 1] ?? 0;
  }

  coolant(): CoolantRecipeEntry {
    const entry = this.compiled.coolantRecipes[this.coolantRecipe];
    if (entry !== undefined) return entry;
    // Java would throw an ArrayIndexOutOfBounds; a configuration with no coolant
    // recipes at all is degenerate, so fall back to ratio 1 / heat 1 rather than
    // crashing a background optimisation run.
    return {
      index: -1,
      heat: 1,
      ratio: 1,
      displayName: '',
      recipe: { heat: 1, ratio: 1 },
    };
  }

  /** The compiled entry that stores a given `(configuration.blocks, recipe)` pair. */
  entryFor(blockListIndex: number, recipeIndex = -1): number {
    for (const entry of this.compiled.entries) {
      if (entry.blockListIndex === blockListIndex && entry.recipeIndex === recipeIndex) {
        return entry.index;
      }
    }
    return 0;
  }

  // -- calculation ---------------------------------------------------------

  calculate(): void {
    const [w, h, d] = this.dims;
    const entries = this.compiled.entries;
    // A coolant change rebuilds the reactor (its recipe is a constructor field).
    this.fast.configure(this.dims, this.coolant().recipe);
    let i = 0;
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        for (let z = 0; z < d; z++, i++) {
          const stored = this.blocks[i] ?? 0;
          const entry =
            stored >= 1
              ? (entries[stored - 1] as CompiledEntry<SfrTemplate> | undefined)
              : undefined;
          if (entry === undefined) {
            this.fast.bind(x, y, z, null);
            continue;
          }
          const recipe = entry.recipe;
          if (entry.template.fuelCell) {
            this.fast.bind(x, y, z, entry.template, (recipe as SfrFuel | null) ?? null, null);
          } else if (entry.template.irradiator) {
            this.fast.bind(
              x,
              y,
              z,
              entry.template,
              null,
              (recipe as SfrIrradiatorRecipe | null) ?? null,
            );
          } else {
            this.fast.bind(x, y, z, entry.template);
          }
        }
      }
    }
    this.fast.recalculate();

    this.counts.fill(0);
    i = 0;
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        for (let z = 0; z < d; z++, i++) {
          const stored = this.blocks[i] ?? 0;
          if (stored >= 1) this.counts[stored - 1]++;
          const block = this.fast.blockAt(x, y, z);
          this.active[i] = block !== null && block.isActive() ? 1 : 0;
          this.moderators[i] = block !== null && block.moderatorValid ? 1 : 0;
        }
      }
    }
    Object.assign(this.stats, this.fast.stats());
    this.calculated = true;
  }

  rawStats(): Readonly<Record<string, number>> {
    return this.stats as unknown as Record<string, number>;
  }

  kernel(): SfrFastReactor {
    return this.fast;
  }

  isActiveAt(x: number, y: number, z: number): boolean {
    return this.active[this.index(x, y, z)] === 1;
  }

  isModeratorValidAt(x: number, y: number, z: number): boolean {
    return this.moderators[this.index(x, y, z)] === 1;
  }

  // -- copied values -------------------------------------------------------

  copy(): SfrGeneratorGrid {
    const clone = new SfrGeneratorGrid(this.compiled, this.dims, this.coolantRecipe);
    clone.copyFrom(this);
    return clone;
  }

  copyFrom(other: SfrGeneratorGrid): void {
    this.blocks.set(other.blocks);
    this.coolantRecipe = other.coolantRecipe;
    this.copyVarsFrom(other);
  }

  copyVarsFrom(other: SfrGeneratorGrid): void {
    this.active.set(other.active);
    this.moderators.set(other.moderators);
    this.counts.set(other.counts);
    Object.assign(this.stats, other.stats);
    this.calculated = other.calculated;
  }

  clear(): void {
    this.blocks.fill(0);
    this.active.fill(0);
    this.moderators.fill(0);
    this.counts.fill(0);
  }

  // -- export --------------------------------------------------------------

  /**
   * Raw stored indices, one per interior cell in `x,y,z` order (`0` = air).
   *
   * Deliberately **unpruned**: re-simulating these indices reproduces exactly the
   * numbers this grid reported. `pruneInactive()` is the opt-in lossy variant (the
   * frozen Java's lite export always pruned, which is why its exported grid could
   * measure differently from the one the generator had just scored).
   */
  toIndices(): number[] {
    return Array.from(this.blocks);
  }

  /** {@link toIndices} with every inactive cell blanked (Java's lite export). */
  pruneInactive(): number[] {
    const out = Array.from(this.blocks);
    for (let i = 0; i < out.length; i++) {
      if (this.active[i] !== 1 && this.moderators[i] !== 1) out[i] = 0;
    }
    return out;
  }

  /** Portable `(identity, recipe)` per cell, or `null` for air. */
  toPortable(): (PortableCell | null)[] {
    return Array.from(this.blocks, (stored) => {
      if (stored < 1) return null;
      const entry = this.compiled.entries[stored - 1];
      if (entry === undefined) return null;
      return { identity: entry.template.identity, recipe: entry.recipe?.name ?? null };
    });
  }

  /** Load a cell list produced by {@link toPortable} (unknown cells become air). */
  assignPortable(cells: readonly (PortableCell | null)[]): void {
    for (let i = 0; i < this.blocks.length; i++) {
      const cell = cells[i];
      if (!cell) {
        this.blocks[i] = 0;
        continue;
      }
      const entry = this.compiled.entries.find(
        (e) =>
          e.template.identity === cell.identity &&
          (cell.recipe === null || e.recipe?.name === cell.recipe),
      );
      this.blocks[i] = entry?.index ?? 0;
    }
  }

  // -- variables -----------------------------------------------------------

  private makeVariables(): Variable[] {
    const stats = this.stats;
    const names = this.compiled.entries.map((e) => e.template.name);
    return [
      intVariable('Net Heat', () => stats.netHeat),
      floatVariable('Total Output', () => stats.totalOutput),
      intVariable('Total Heat', () => stats.totalHeat),
      intVariable('Total Cooling', () => stats.totalCooling),
      intVariable('Cell Count', () => stats.totalFuelCells),
      floatVariable('Total Efficiency', () => stats.totalEfficiency),
      floatVariable('Heat Multiplier', () => stats.totalHeatMult),
      ...blockCountVariables(names, (i) => this.counts[i] ?? 0),
    ];
  }

  variables(): readonly Variable[] {
    return this.vars;
  }

  tooltip(): string {
    const s = this.stats;
    return [
      `Net Heat: ${s.netHeat}`,
      `Total Output: ${s.totalOutput}`,
      `Total Heat: ${s.totalHeat}`,
      `Total Cooling: ${s.totalCooling}`,
      `Cell Count: ${s.totalFuelCells}`,
      `Total Efficiency: ${s.totalEfficiency}`,
      `Heat Multiplier: ${s.totalHeatMult}`,
      `Total Irradiation: ${s.totalIrradiation}`,
      `Shutdown Factor: ${s.shutdownFactor}`,
      `Sparsity Multiplier: ${s.sparsityMult}`,
    ].join('\n');
  }
}

/** Build an Overhaul SFR grid from a kernel `SfrConfig`. */
export function makeSfrGrid(config: SfrConfig, dims: Dims, coolantRecipe = 0): SfrGeneratorGrid {
  return new SfrGeneratorGrid(compileSfr(config), dims, coolantRecipe);
}
