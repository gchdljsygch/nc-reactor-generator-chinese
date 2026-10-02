/**
 * The generator's multiblock interface (Java `LiteMultiblock<T>`).
 *
 * A *grid* is the mutable part of the generator: an interior integer array where
 * `0` means air and `i > 0` means "compiled entry `i - 1`" (see `compiled.ts`), plus
 * cached statistics refreshed by {@link GeneratorGrid.calculate}.
 *
 * Coordinates are **0-based interior** coordinates, exactly like the frozen
 * `multiblock/generator/lite` package and `CuboidGrid`'s interior. The kernel
 * addresses the same cell one step out (`x + 1`) because its ring is the casing.
 */

import { floatVariable, intVariable, longVariable, type Variable } from './variable.js';

/** One cell's stored value translated back to portable names. */
export interface PortableCell {
  /** NCPF four-segment identity of the *block*. */
  readonly identity: string;
  /** Recipe name (\`fuel=…\` payload name) or \`null\`. */
  readonly recipe: string | null;
}

/** Interior dimensions, `[width, height, depth]`. */
export type Dims = readonly [number, number, number];

export interface GeneratorGrid<TSelf> {
  /** Interior size. */
  readonly dims: Dims;
  /** Flat interior grid, `x * height * depth + y * depth + z`. `0` = air. */
  readonly blocks: Int32Array;
  /** Number of compiled entries; valid stored values are `0 .. entryCount`. */
  readonly entryCount: number;
  /**
   * True once a `calculate()` (or a `copyVarsFrom` of a calculated grid) has filled
   * the activity flags. Java's `LiteMultiblock` signalled the same thing with `null`
   * validity arrays, which `ClearInvalidMutator` checks before touching the grid —
   * without this flag the first clear-invalid would wipe an untouched grid.
   */
  calculated: boolean;

  index(x: number, y: number, z: number): number;
  getBlock(x: number, y: number, z: number): number;
  /** `entry <= 0` or `> entryCount` stores air, matching Java's `-1`/out-of-range. */
  setBlock(x: number, y: number, z: number, entry: number): void;

  /** Run the physics kernel once and refresh every statistic and variable. */
  calculate(): void;

  /**
   * Java `blockActive[x][y][z] > 0` — the cell holds something the last
   * `calculate()` considered active. Used by the clear-invalid mutator, which is
   * the generator's only consumer of per-cell validity.
   */
  isActiveAt(x: number, y: number, z: number): boolean;
  /** Java `moderatorValid[x][y][z] > 0` (Overhaul only; `false` for Underhaul). */
  isModeratorValidAt(x: number, y: number, z: number): boolean;

  /** Java `LiteMultiblock.getDimension(i)`; `0,1,2 → width,height,depth`. */
  dimension(i: number): number;

  /**
   * The raw statistics the last `calculate()` produced — the editor's own fields,
   * not a derived summary. Typed loosely because Overhaul and Underhaul have
   * different field sets; use the flavour-specific grid for a typed view.
   */
  rawStats(): Readonly<Record<string, number>>;

  /** The kernel object behind this grid, for callers that need the object model. */
  kernel(): unknown;

  /** Portable `(identity, recipe)` per cell, or `null` for air. */
  toPortable(): readonly (PortableCell | null)[];
  /** Load cells produced by {@link toPortable}; unknown cells become air. */
  assignPortable(cells: readonly (PortableCell | null)[]): void;

  variables(): readonly Variable[];
  tooltip(): string;

  copy(): TSelf;
  copyFrom(other: TSelf): void;
  /** Copy only the *calculated* values (Java `copyVarsFrom`) — no blocks. */
  copyVarsFrom(other: TSelf): void;
  clear(): void;
}

/** Java `LiteMultiblock.getVariable(i)` / `getVariableCount()` over an array. */
export function variableAt(variables: readonly Variable[], i: number): Variable {
  const variable = variables[i];
  if (variable === undefined) throw new RangeError(`no variable at index ${i}`);
  return variable;
}

/**
 * Java `genVariables()`'s `Block Count: <definition>` tail, in compiled-entry order.
 */
export function blockCountVariables(
  names: readonly string[],
  read: (i: number) => number,
): Variable[] {
  return names.map((name, i) => intVariable(`Block Count: ${name}`, () => read(i)));
}

export { intVariable, floatVariable, longVariable };
