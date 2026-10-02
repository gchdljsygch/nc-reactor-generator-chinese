/**
 * `LiteUnderhaulSFR` — the Underhaul SFR generator grid.
 *
 * The same shape as `reactors/sfr.ts`, over `UsfrFastReactor`. One structural
 * difference: Underhaul SFR has a **single reactor-wide fuel** rather than a
 * per-cell fuel, so the grid carries a `fuel` index and changing it rebuilds the
 * kernel reactor (`UsfrFastReactor.configure(dims, fuelIndex)`), which is what the
 * `nuclearcraft:underhaul_sfr:random_fuel` mutator drives.
 *
 * There is no `moderatorValid` array in Underhaul SFR — the lite engine's
 * clear-invalid predicate was `blockValid + blockEfficiency <= 0`, and the kernel's
 * `UsfrBlock.isActive()` is exactly `fuelCell || moderatorActive || coolerValid ||
 * casingValid`, with `blockEfficiency` zero for every cell that is not active. So
 * {@link UsfrGeneratorGrid.isModeratorValidAt} always answers `false` and
 * clear-invalid reads `isActiveAt` alone.
 */

import type { UsfrActiveCoolerRecipe, UsfrConfig, UsfrTemplate } from '@ncplanner/kernel';
import { UsfrFastReactor, type UsfrStats } from '@ncplanner/kernel';
import {
  compileUsfr,
  type CompiledEntry,
  type CompiledUsfrConfiguration,
} from '../compiled.js';
import { blockCountVariables, type Dims, type GeneratorGrid } from '../grid.js';
import { floatVariable, intVariable, type Variable } from '../variable.js';
import type { PortableCell } from './sfr.js';

export class UsfrGeneratorGrid implements GeneratorGrid<UsfrGeneratorGrid> {
  readonly dims: Dims;
  readonly blocks: Int32Array;
  readonly compiled: CompiledUsfrConfiguration;
  /** Index into `compiled.fuels` (Java `LiteUnderhaulSFR.fuel`). */
  fuel: number;
  /** See {@link GeneratorGrid.calculated}. */
  calculated = false;

  private readonly fast: UsfrFastReactor;
  private readonly active: Uint8Array;
  private readonly counts: Int32Array;
  private readonly stats: UsfrStats;
  private readonly vars: Variable[];

  constructor(compiled: CompiledUsfrConfiguration, dims: Dims, fuel = 0) {
    this.compiled = compiled;
    this.dims = dims;
    this.fuel = fuel;
    const volume = dims[0] * dims[1] * dims[2];
    this.blocks = new Int32Array(volume);
    this.active = new Uint8Array(volume);
    this.counts = new Int32Array(compiled.entries.length);
    this.fast = new UsfrFastReactor(compiled.config, dims, fuel);
    this.stats = this.fast.stats();
    this.vars = this.makeVariables();
  }

  index(x: number, y: number, z: number): number {
    return (x * this.dims[1] + y) * this.dims[2] + z;
  }

  getBlock(x: number, y: number, z: number): number {
    return this.blocks[this.index(x, y, z)] ?? 0;
  }

  setBlock(x: number, y: number, z: number, entry: number): void {
    const i = this.index(x, y, z);
    this.blocks[i] = entry >= 1 && entry <= this.compiled.entries.length ? entry | 0 : 0;
  }

  dimension(i: number): number {
    return this.dims[i] ?? 0;
  }

  get entryCount(): number {
    return this.compiled.entries.length;
  }

  countOf(entryIndex: number): number {
    return this.counts[entryIndex - 1] ?? 0;
  }

  entryFor(blockListIndex: number, recipeIndex = -1): number {
    for (const entry of this.compiled.entries) {
      if (entry.blockListIndex === blockListIndex && entry.recipeIndex === recipeIndex) {
        return entry.index;
      }
    }
    return 0;
  }

  calculate(): void {
    const [w, h, d] = this.dims;
    const entries = this.compiled.entries;
    this.fast.configure(this.dims, this.fuel);
    let i = 0;
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        for (let z = 0; z < d; z++, i++) {
          const stored = this.blocks[i] ?? 0;
          const entry =
            stored >= 1
              ? (entries[stored - 1] as CompiledEntry<UsfrTemplate> | undefined)
              : undefined;
          if (entry === undefined) {
            this.fast.bind(x, y, z, null);
            continue;
          }
          if (entry.template.activeCooler) {
            this.fast.bind(
              x,
              y,
              z,
              entry.template,
              (entry.recipe as UsfrActiveCoolerRecipe | null) ?? null,
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
        }
      }
    }
    Object.assign(this.stats, this.fast.stats());
    this.calculated = true;
  }

  rawStats(): Readonly<Record<string, number>> {
    return this.stats as unknown as Record<string, number>;
  }

  kernel(): UsfrFastReactor {
    return this.fast;
  }

  isActiveAt(x: number, y: number, z: number): boolean {
    return this.active[this.index(x, y, z)] === 1;
  }

  /** Underhaul SFR has no moderator-validity array — always `false`. */
  isModeratorValidAt(): boolean {
    return false;
  }

  copy(): UsfrGeneratorGrid {
    const clone = new UsfrGeneratorGrid(this.compiled, this.dims, this.fuel);
    clone.copyFrom(this);
    return clone;
  }

  copyFrom(other: UsfrGeneratorGrid): void {
    this.blocks.set(other.blocks);
    this.fuel = other.fuel;
    this.copyVarsFrom(other);
  }

  copyVarsFrom(other: UsfrGeneratorGrid): void {
    this.active.set(other.active);
    this.counts.set(other.counts);
    Object.assign(this.stats, other.stats);
    this.calculated = other.calculated;
  }

  clear(): void {
    this.blocks.fill(0);
    this.active.fill(0);
    this.counts.fill(0);
  }

  toIndices(): number[] {
    return Array.from(this.blocks);
  }

  pruneInactive(): number[] {
    const out = Array.from(this.blocks);
    for (let i = 0; i < out.length; i++) if (this.active[i] !== 1) out[i] = 0;
    return out;
  }

  toPortable(): (PortableCell | null)[] {
    return Array.from(this.blocks, (stored) => {
      if (stored < 1) return null;
      const entry = this.compiled.entries[stored - 1];
      if (entry === undefined) return null;
      return { identity: entry.template.identity, recipe: entry.recipe?.name ?? null };
    });
  }

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

  private makeVariables(): Variable[] {
    const stats = this.stats;
    const names = this.compiled.entries.map((e) => e.template.name);
    return [
      intVariable('Net Heat', () => stats.netHeat),
      floatVariable('Total Output', () => stats.power),
      intVariable('Total Heat', () => stats.heat),
      intVariable('Total Cooling', () => stats.cooling),
      intVariable('Cell Count', () => stats.cells),
      floatVariable('Total Efficiency', () => stats.efficiency),
      floatVariable('Heat Multiplier', () => stats.heatMult),
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
      `Total Output: ${s.power}`,
      `Total Heat: ${s.heat}`,
      `Total Cooling: ${s.cooling}`,
      `Cell Count: ${s.cells}`,
      `Total Efficiency: ${s.efficiency}`,
      `Heat Multiplier: ${s.heatMult}`,
    ].join('\n');
  }
}

/** Build an Underhaul SFR grid from a kernel `UsfrConfig`. */
export function makeUsfrGrid(config: UsfrConfig, dims: Dims, fuel = 0): UsfrGeneratorGrid {
  return new UsfrGeneratorGrid(compileUsfr(config), dims, fuel);
}
