import { CuboidGrid, type Pos } from './geometry.js';
import type {
  SfrConfig,
  SfrFuel,
  SfrIrradiatorRecipe,
  SfrTemplate,
} from './sfr/config.js';
import { OverhaulSfrReactor, SfrBlock, type SfrCoolantRecipe, type SfrStats } from './sfr/reactor.js';
import type { UsfrActiveCoolerRecipe, UsfrConfig, UsfrTemplate } from './usfr/config.js';
import { UnderhaulSfrReactor, UsfrBlock, type UsfrStats } from './usfr/reactor.js';

/**
 * `simulateFast()` — the generator's entry into **the same physics** as the
 * editor's `simulate()`.
 *
 * The rewrite plan (§7, "R4 的一个关键设计") requires the generator not to grow a
 * second engine. The frozen Java code violated that: `LiteOverhaulSFR` was a
 * hand-inlined reimplementation of `OverhaulSFR`'s physics, and R0 measured the two
 * disagreeing on 33.9% of random Overhaul SFR grids. This module keeps the single
 * implementation and only removes the *allocation* per iteration:
 *
 *  - every interior cell owns one long-lived `SfrBlock`/`UsfrBlock` object, bound
 *    by index rather than rebuilt;
 *  - `recalculate()` re-applies the bindings (the physics mutates `template` while
 *    it opens/closes neutron shields) and then calls the very same
 *    `OverhaulSfrReactor.recalculate()` the editor calls.
 *
 * So `simulateVerbose` (build objects, run the reactor once) and `simulateFast`
 * (reuse objects, run the reactor N times) differ only in object lifetime — the
 * numbers are identical by construction, not by convention.
 *
 * **Divergence from the frozen Java**, deliberately: the frozen *lite* engine ran
 * only the first of the editor's three calculation passes, so a "lite" reactor and
 * the same reactor opened in the editor reported different totals. Here the
 * generator optimises exactly the number the editor shows (plan §3.1.1: "取 editor
 * 字段。用户看到的就是它").
 */

/** Interior dimensions `[width, height, depth]`. */
export type Dims = readonly [number, number, number];

/**
 * A reusable Overhaul SFR simulator over a fixed interior size.
 *
 * Coordinates are **0-based interior** coordinates, matching
 * `multiblock/generator/lite/*` in the frozen Java and `CuboidGrid`'s interior
 * (`x ∈ 0..width-1`). The kernel reactor addresses the same cell as `x + 1`.
 */
export class SfrFastReactor {
  private config: SfrConfig;
  private dims: Dims;
  private coolant: SfrCoolantRecipe;
  private reactor!: OverhaulSfrReactor;
  private grid!: CuboidGrid<SfrBlock>;
  private blocks!: SfrBlock[];
  /** Per-cell binding, re-applied by every `recalculate()`. */
  private templates!: (SfrTemplate | null)[];
  private fuels!: (SfrFuel | null)[];
  private irradiators!: (SfrIrradiatorRecipe | null)[];

  constructor(config: SfrConfig, dims: Dims, coolant: SfrCoolantRecipe) {
    this.config = config;
    this.dims = dims;
    this.coolant = coolant;
    this.build();
  }

  private get volume(): number {
    return this.dims[0] * this.dims[1] * this.dims[2];
  }

  private index(x: number, y: number, z: number): number {
    return (x * this.dims[1] + y) * this.dims[2] + z;
  }

  private build(): void {
    const [w, h, d] = this.dims;
    this.reactor = new OverhaulSfrReactor(this.config, w, h, d, this.coolant);
    this.grid = this.reactor.grid;
    this.blocks = new Array<SfrBlock>(w * h * d);
    this.templates = new Array<SfrTemplate | null>(w * h * d).fill(null);
    this.fuels = new Array<SfrFuel | null>(w * h * d).fill(null);
    this.irradiators = new Array<SfrIrradiatorRecipe | null>(w * h * d).fill(null);
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        for (let z = 0; z < d; z++) {
          const i = this.index(x, y, z);
          const pos: Pos = { x: x + 1, y: y + 1, z: z + 1 };
          // A placeholder template keeps the object; `recalculate()` never runs
          // with `null` templates because air cells are removed from the grid.
          const block = new SfrBlock(pos, null as unknown as SfrTemplate);
          this.blocks[i] = block;
          this.grid.set(pos, null);
        }
      }
    }
  }

  /** Interior size and/or coolant recipe changed → rebuild the grid (rare). */
  configure(dims: Dims, coolant?: SfrCoolantRecipe): void {
    const same =
      dims[0] === this.dims[0] &&
      dims[1] === this.dims[1] &&
      dims[2] === this.dims[2] &&
      (coolant === undefined || coolant === this.coolant);
    if (same) return;
    this.dims = dims;
    if (coolant !== undefined) this.coolant = coolant;
    this.build();
  }

  get dimensions(): Dims {
    return this.dims;
  }

  /** Bind one interior cell. `template === null` means air. */
  bind(
    x: number,
    y: number,
    z: number,
    template: SfrTemplate | null,
    fuel: SfrFuel | null = null,
    irradiatorRecipe: SfrIrradiatorRecipe | null = null,
  ): void {
    if (x < 0 || y < 0 || z < 0 || x >= this.dims[0] || y >= this.dims[1] || z >= this.dims[2]) {
      throw new RangeError(`cell ${x},${y},${z} is outside ${this.dims.join('x')}`);
    }
    const i = this.index(x, y, z);
    this.templates[i] = template;
    this.fuels[i] = fuel;
    this.irradiators[i] = irradiatorRecipe;
  }

  /** Bind every cell from a flat interior index array (`-1` = air). */
  bindFromIndices(
    indices: Int32Array | readonly number[],
    resolve: (index: number) => {
      template: SfrTemplate;
      fuel?: SfrFuel | null;
      irradiatorRecipe?: SfrIrradiatorRecipe | null;
    } | null,
  ): void {
    const [w, h, d] = this.dims;
    let i = 0;
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        for (let z = 0; z < d; z++, i++) {
          const binding = resolve(indices[i] ?? -1);
          this.templates[i] = binding === null ? null : binding.template;
          this.fuels[i] = binding === null ? null : (binding.fuel ?? null);
          this.irradiators[i] = binding === null ? null : (binding.irradiatorRecipe ?? null);
        }
      }
    }
  }

  /** Drop every cell to air (bindings and the live grid). */
  clear(): void {
    this.templates.fill(null);
    this.fuels.fill(null);
    this.irradiators.fill(null);
    this.grid.forEachPosition((p) => this.grid.set(p, null));
    this.applyBindings();
  }

  private applyBindings(): void {
    const [w, h, d] = this.dims;
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        for (let z = 0; z < d; z++) {
          const i = this.index(x, y, z);
          const template = this.templates[i];
          const block = this.blocks[i];
          if (template === null) {
            this.grid.set(block.pos, null);
            continue;
          }
          // Re-apply the *design*; the physics may have toggled `template` while
          // opening/closing shields (Java `setToggled`).
          block.template = template;
          block.fuel = this.fuels[i];
          block.irradiatorRecipe = this.irradiators[i];
          this.grid.set(block.pos, block);
        }
      }
    }
  }

  /** Re-apply the bindings and run the one physics kernel. */
  recalculate(): void {
    this.applyBindings();
    this.reactor.recalculate();
  }

  /** Raw statistics (the editor's own fields). */
  stats(): SfrStats {
    return this.reactor.stats();
  }

  blockAt(x: number, y: number, z: number): SfrBlock | null {
    if (x < 0 || y < 0 || z < 0 || x >= this.dims[0] || y >= this.dims[1] || z >= this.dims[2]) {
      return null;
    }
    return this.templates[this.index(x, y, z)] === null ? null : this.blocks[this.index(x, y, z)];
  }

  /** The underlying reactor, for callers that need the full object model. */
  get underlying(): OverhaulSfrReactor {
    return this.reactor;
  }

  /** Cells holding a block (used by `export`/tests). */
  get cellCount(): number {
    let n = 0;
    for (let i = 0; i < this.volume; i++) if (this.templates[i] !== null) n++;
    return n;
  }
}

/** The Underhaul SFR twin of {@link SfrFastReactor}. */
export class UsfrFastReactor {
  private config: UsfrConfig;
  private dims: Dims;
  private fuelIndex = 0;
  private reactor!: UnderhaulSfrReactor;
  private grid!: CuboidGrid<UsfrBlock>;
  private blocks!: UsfrBlock[];
  private templates!: (UsfrTemplate | null)[];
  private recipes!: (UsfrActiveCoolerRecipe | null)[];

  constructor(config: UsfrConfig, dims: Dims, fuelIndex = 0) {
    this.config = config;
    this.dims = dims;
    this.fuelIndex = fuelIndex;
    this.build();
  }

  private index(x: number, y: number, z: number): number {
    return (x * this.dims[1] + y) * this.dims[2] + z;
  }

  /**
   * `UnderhaulSFR` carries one fuel for the whole multiblock, so changing it means
   * changing the reactor's fuel list. Rotating the list keeps one physics path
   * (the same trick `packages/app/src/model/simulate.ts` uses for the editor).
   */
  private fuelConfig(): UsfrConfig {
    const fuels = this.config.fuels;
    if (this.fuelIndex <= 0 || this.fuelIndex >= fuels.length) return this.config;
    const selected = fuels[this.fuelIndex];
    return { ...this.config, fuels: [selected, ...fuels.filter((f) => f !== selected)] };
  }

  private build(): void {
    const [w, h, d] = this.dims;
    this.reactor = new UnderhaulSfrReactor(this.fuelConfig(), w, h, d);
    this.grid = this.reactor.grid;
    this.blocks = new Array<UsfrBlock>(w * h * d);
    this.templates = new Array<UsfrTemplate | null>(w * h * d).fill(null);
    this.recipes = new Array<UsfrActiveCoolerRecipe | null>(w * h * d).fill(null);
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        for (let z = 0; z < d; z++) {
          const pos: Pos = { x: x + 1, y: y + 1, z: z + 1 };
          const block = new UsfrBlock(pos, null as unknown as UsfrTemplate);
          this.blocks[this.index(x, y, z)] = block;
          this.grid.set(pos, null);
        }
      }
    }
  }

  configure(dims: Dims, fuelIndex?: number): void {
    const same =
      dims[0] === this.dims[0] &&
      dims[1] === this.dims[1] &&
      dims[2] === this.dims[2] &&
      (fuelIndex === undefined || fuelIndex === this.fuelIndex);
    if (same) return;
    this.dims = dims;
    if (fuelIndex !== undefined) this.fuelIndex = fuelIndex;
    this.build();
  }

  get dimensions(): Dims {
    return this.dims;
  }

  get fuel(): number {
    return this.fuelIndex;
  }

  bind(
    x: number,
    y: number,
    z: number,
    template: UsfrTemplate | null,
    recipe: UsfrActiveCoolerRecipe | null = null,
  ): void {
    if (x < 0 || y < 0 || z < 0 || x >= this.dims[0] || y >= this.dims[1] || z >= this.dims[2]) {
      throw new RangeError(`cell ${x},${y},${z} is outside ${this.dims.join('x')}`);
    }
    const i = this.index(x, y, z);
    this.templates[i] = template;
    this.recipes[i] = recipe;
  }

  clear(): void {
    this.templates.fill(null);
    this.recipes.fill(null);
    this.grid.forEachPosition((p) => this.grid.set(p, null));
    this.applyBindings();
  }

  private applyBindings(): void {
    const [w, h, d] = this.dims;
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        for (let z = 0; z < d; z++) {
          const i = this.index(x, y, z);
          const template = this.templates[i];
          const block = this.blocks[i];
          if (template === null) {
            this.grid.set(block.pos, null);
            continue;
          }
          block.template = template;
          block.recipe = this.recipes[i];
          this.grid.set(block.pos, block);
        }
      }
    }
  }

  recalculate(): void {
    this.applyBindings();
    this.reactor.recalculate();
  }

  stats(): UsfrStats {
    return this.reactor.stats();
  }

  blockAt(x: number, y: number, z: number): UsfrBlock | null {
    if (x < 0 || y < 0 || z < 0 || x >= this.dims[0] || y >= this.dims[1] || z >= this.dims[2]) {
      return null;
    }
    return this.templates[this.index(x, y, z)] === null ? null : this.blocks[this.index(x, y, z)];
  }

  get underlying(): UnderhaulSfrReactor {
    return this.reactor;
  }
}
