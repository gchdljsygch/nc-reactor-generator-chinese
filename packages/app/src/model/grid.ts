/**
 * R3.5 — the block grid model.
 *
 * The editor works on the *same* coordinate system as the file format and the
 * kernel (`packages/kernel/src/geometry.ts`): `dims` are the **external**
 * dimensions, the outer shell at index `0` and `dim-1` is the casing, and the
 * editable region is `1..dim-2`. This is not a UI convenience — getting it wrong
 * would shift every reactor by one cell relative to the golden datasets.
 *
 * Cells hold **indices** into the configuration's `blocks` list (`-1` = air),
 * which is exactly what a design stores on the wire (`docs/r1/r1.4-ncpf-io.md`,
 * `packages/formats/src/designs.ts`). Recipes are indices into the block's own
 * `ncpf:block_recipes` list.
 *
 * Symmetry (R3.5) mirrors an edit about the interior centre: for interior width
 * `w = dims[0] - 2`, an interior coordinate `x ∈ [1, w]` maps to `w + 1 - x`.
 * Enabling an axis mirrors *every* edit, exactly like the Java editor.
 */

export type Dims = readonly [number, number, number];

export interface Symmetry {
  x: boolean;
  y: boolean;
  z: boolean;
}

export interface GridState {
  readonly dims: Dims;
  /** `blocks[x][y][z]` → index into the configuration's `blocks` list, `-1` = air. */
  readonly blocks: number[][][];
  /** `recipes[x][y][z]` → index into that block's recipe list, `-1` = none. */
  readonly recipes: number[][][];
  /** Scalar references (`coolant_recipe`, `fuel`, `recipe`) → index, `-1` = none. */
  readonly scalars: Record<string, number>;
  /**
   * Not `readonly`: toggling symmetry is a view setting, not a grid edit, so it
   * must not enter the undo history.
   */
  symmetry: Symmetry;
}

export const AIR = -1;
/** Smallest legal dimension: a 1×1×1 interior, i.e. a 3×3×3 external grid. */
export const MIN_DIM = 3;
export const MAX_DIM = 64;

export function createGrid(dims: Dims, scalars: Record<string, number> = {}): GridState {
  const [dx, dy, dz] = dims;
  const fill = (): number[][][] =>
    Array.from({ length: dx }, () =>
      Array.from({ length: dy }, () => new Array<number>(dz).fill(AIR)),
    );
  return {
    dims: [dx, dy, dz],
    blocks: fill(),
    recipes: fill(),
    scalars: { ...scalars },
    symmetry: { x: false, y: false, z: false },
  };
}

export function cloneGrid(grid: GridState): GridState {
  return {
    dims: [grid.dims[0], grid.dims[1], grid.dims[2]],
    blocks: grid.blocks.map((plane) => plane.map((row) => [...row])),
    recipes: grid.recipes.map((plane) => plane.map((row) => [...row])),
    scalars: { ...grid.scalars },
    symmetry: { ...grid.symmetry },
  };
}

export function gridEquals(a: GridState, b: GridState): boolean {
  if (a.dims[0] !== b.dims[0] || a.dims[1] !== b.dims[1] || a.dims[2] !== b.dims[2]) return false;
  for (let x = 0; x < a.dims[0]; x++) {
    for (let y = 0; y < a.dims[1]; y++) {
      for (let z = 0; z < a.dims[2]; z++) {
        if (a.blocks[x]![y]![z] !== b.blocks[x]![y]![z]) return false;
        if (a.recipes[x]![y]![z] !== b.recipes[x]![y]![z]) return false;
      }
    }
  }
  return true;
}

/** Interior dimensions (what the physics kernel calls width/height/depth). */
export function interiorDims(dims: Dims): Dims {
  return [Math.max(1, dims[0] - 2), Math.max(1, dims[1] - 2), Math.max(1, dims[2] - 2)];
}

export function inBounds(grid: GridState, x: number, y: number, z: number): boolean {
  return x >= 0 && y >= 0 && z >= 0 && x < grid.dims[0] && y < grid.dims[1] && z < grid.dims[2];
}

/** True for an *editable* cell: inside the casing shell. */
export function isInterior(grid: GridState, x: number, y: number, z: number): boolean {
  return (
    inBounds(grid, x, y, z) &&
    x >= 1 &&
    y >= 1 &&
    z >= 1 &&
    x <= grid.dims[0] - 2 &&
    y <= grid.dims[1] - 2 &&
    z <= grid.dims[2] - 2
  );
}

/**
 * Every coordinate an edit at `(x,y,z)` must also touch, given the enabled
 * symmetry axes. Returns the original cell first; duplicates (a cell on the
 * mirror plane) are removed, so a caller can act on the list directly.
 */
export function mirrorCells(grid: GridState, x: number, y: number, z: number): [number, number, number][] {
  const out: [number, number, number][] = [[x, y, z]];
  const [dx, dy, dz] = grid.dims;
  // Interior mirror: index i ↔ (dim - 1 - i), which keeps 1..dim-2 inside.
  const mirror = (axis: 0 | 1 | 2, cx: number, cy: number, cz: number): [number, number, number] => {
    if (axis === 0) return [dx - 1 - cx, cy, cz];
    if (axis === 1) return [cx, dy - 1 - cy, cz];
    return [cx, cy, dz - 1 - cz];
  };
  const axes: (0 | 1 | 2)[] = [];
  if (grid.symmetry.x) axes.push(0);
  if (grid.symmetry.y) axes.push(1);
  if (grid.symmetry.z) axes.push(2);
  for (const axis of axes) {
    // A mirrored copy of every cell already in `out` (so X+Y produce 4 cells).
    for (const [cx, cy, cz] of [...out]) out.push(mirror(axis, cx, cy, cz));
  }
  const seen = new Set<string>();
  return out.filter(([cx, cy, cz]) => {
    const key = `${cx},${cy},${cz}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Set one cell (plus its symmetry images). An edit on the shell is ignored: the
 * casing is implicit, and letting a tool write there would produce a grid the
 * kernel's `forEachInternalPosition` never visits.
 *
 * `recipeIndex` defaults to the first recipe of the placed block when `undefined`
 * (a fuel cell must carry a fuel, exactly like the Java editor, which pre-selects
 * the first recipe of the chosen block).
 */
export function setCell(
  grid: GridState,
  x: number,
  y: number,
  z: number,
  blockIndex: number,
  recipeIndex: number | undefined,
  recipeCountFor: (blockIndex: number) => number,
): boolean {
  let changed = false;
  for (const [cx, cy, cz] of mirrorCells(grid, x, y, z)) {
    if (!isInterior(grid, cx, cy, cz)) continue;
    const previous = grid.blocks[cx]![cy]![cz]!;
    const recipe =
      recipeIndex !== undefined
        ? recipeIndex
        : previous === blockIndex
          ? grid.recipes[cx]![cy]![cz]!
          : recipeCountFor(blockIndex) > 0
            ? 0
            : AIR;
    if (previous === blockIndex && grid.recipes[cx]![cy]![cz] === recipe) continue;
    grid.blocks[cx]![cy]![cz] = blockIndex;
    grid.recipes[cx]![cy]![cz] = blockIndex === AIR ? AIR : recipe;
    changed = true;
  }
  return changed;
}

/** Erase a cell (plus symmetry images). */
export function eraseCell(grid: GridState, x: number, y: number, z: number): boolean {
  return setCell(grid, x, y, z, AIR, AIR, () => 0);
}

export interface BoxSelection {
  readonly from: readonly [number, number, number];
  readonly to: readonly [number, number, number];
}

export function selectionBounds(selection: BoxSelection): {
  min: [number, number, number];
  max: [number, number, number];
} {
  const min: [number, number, number] = [
    Math.min(selection.from[0], selection.to[0]),
    Math.min(selection.from[1], selection.to[1]),
    Math.min(selection.from[2], selection.to[2]),
  ];
  const max: [number, number, number] = [
    Math.max(selection.from[0], selection.to[0]),
    Math.max(selection.from[1], selection.to[1]),
    Math.max(selection.from[2], selection.to[2]),
  ];
  return { min, max };
}

/** Fill a box (clipped to the interior), with symmetry applied per cell. */
export function fillBox(
  grid: GridState,
  selection: BoxSelection,
  blockIndex: number,
  recipeIndex: number | undefined,
  recipeCountFor: (blockIndex: number) => number,
): boolean {
  const { min, max } = selectionBounds(selection);
  let changed = false;
  for (let x = min[0]; x <= max[0]; x++) {
    for (let y = min[1]; y <= max[1]; y++) {
      for (let z = min[2]; z <= max[2]; z++) {
        if (setCell(grid, x, y, z, blockIndex, recipeIndex, recipeCountFor)) changed = true;
      }
    }
  }
  return changed;
}

export function clearBox(grid: GridState, selection: BoxSelection): boolean {
  return fillBox(grid, selection, AIR, AIR, () => 0);
}

/** Empty every interior cell (leaves the dimensions and scalars alone). */
export function clearAll(grid: GridState): boolean {
  return clearBox(grid, {
    from: [1, 1, 1],
    to: [grid.dims[0] - 2, grid.dims[1] - 2, grid.dims[2] - 2],
  });
}

export function countBlocks(grid: GridState): number {
  let n = 0;
  for (let x = 1; x <= grid.dims[0] - 2; x++) {
    for (let y = 1; y <= grid.dims[1] - 2; y++) {
      for (let z = 1; z <= grid.dims[2] - 2; z++) {
        if (grid.blocks[x]![y]![z]! !== AIR) n++;
      }
    }
  }
  return n;
}

export interface ResizeResult {
  readonly grid: GridState;
  /** Cells that fell outside the new interior and were dropped. */
  readonly clipped: number;
}

/**
 * Resize keeping the **minimum corner** anchored (Java's `MenuResize` keeps
 * blocks in place and only drops what falls outside). Growth fills with air.
 */
export function resizeGrid(grid: GridState, dims: Dims): ResizeResult {
  const [dx, dy, dz] = clampDims(dims);
  const out = createGrid([dx, dy, dz], grid.scalars);
  out.symmetry = { ...grid.symmetry };
  let clipped = 0;
  for (let x = 1; x <= grid.dims[0] - 2; x++) {
    for (let y = 1; y <= grid.dims[1] - 2; y++) {
      for (let z = 1; z <= grid.dims[2] - 2; z++) {
        const block = grid.blocks[x]![y]![z]!;
        if (block === AIR) continue;
        if (x > dx - 2 || y > dy - 2 || z > dz - 2) {
          clipped++;
          continue;
        }
        out.blocks[x]![y]![z] = block;
        out.recipes[x]![y]![z] = grid.recipes[x]![y]![z]!;
      }
    }
  }
  return { grid: out, clipped };
}

export function clampDims(dims: Dims): Dims {
  return [
    Math.min(MAX_DIM, Math.max(MIN_DIM, Math.trunc(dims[0]))),
    Math.min(MAX_DIM, Math.max(MIN_DIM, Math.trunc(dims[1]))),
    Math.min(MAX_DIM, Math.max(MIN_DIM, Math.trunc(dims[2]))),
  ];
}

export interface Clipboard {
  readonly dims: Dims;
  readonly blocks: number[][][];
  readonly recipes: number[][][];
}

/** Copy a box out of the grid (an empty box yields `null`). */
export function copyBox(grid: GridState, selection: BoxSelection): Clipboard | null {
  const { min, max } = selectionBounds(selection);
  const dims: Dims = [max[0] - min[0] + 1, max[1] - min[1] + 1, max[2] - min[2] + 1];
  const blocks: number[][][] = [];
  const recipes: number[][][] = [];
  let any = false;
  for (let x = min[0]; x <= max[0]; x++) {
    const planeB: number[][] = [];
    const planeR: number[][] = [];
    for (let y = min[1]; y <= max[1]; y++) {
      const rowB: number[] = [];
      const rowR: number[] = [];
      for (let z = min[2]; z <= max[2]; z++) {
        const block = inBounds(grid, x, y, z) ? grid.blocks[x]![y]![z]! : AIR;
        rowB.push(block);
        rowR.push(block === AIR ? AIR : grid.recipes[x]![y]![z]!);
        if (block !== AIR) any = true;
      }
      planeB.push(rowB);
      planeR.push(rowR);
    }
    blocks.push(planeB);
    recipes.push(planeR);
  }
  return any ? { dims, blocks, recipes } : null;
}

/** Paste a clipboard with its minimum corner at `(x,y,z)`; out-of-range cells drop. */
export function pasteClipboard(
  grid: GridState,
  clipboard: Clipboard,
  at: readonly [number, number, number],
): boolean {
  let changed = false;
  for (let x = 0; x < clipboard.dims[0]; x++) {
    for (let y = 0; y < clipboard.dims[1]; y++) {
      for (let z = 0; z < clipboard.dims[2]; z++) {
        const block = clipboard.blocks[x]![y]![z]!;
        const tx = at[0] + x;
        const ty = at[1] + y;
        const tz = at[2] + z;
        if (!isInterior(grid, tx, ty, tz)) continue;
        if (block === AIR) {
          if (grid.blocks[tx]![ty]![tz]! !== AIR) {
            grid.blocks[tx]![ty]![tz] = AIR;
            grid.recipes[tx]![ty]![tz] = AIR;
            changed = true;
          }
          continue;
        }
        const recipe = clipboard.recipes[x]![y]![z]!;
        if (grid.blocks[tx]![ty]![tz] !== block || grid.recipes[tx]![ty]![tz] !== recipe) {
          grid.blocks[tx]![ty]![tz] = block;
          grid.recipes[tx]![ty]![tz] = recipe;
          changed = true;
        }
      }
    }
  }
  return changed;
}

/** Distinct block indices used, with their cell counts (for the parts list). */
export function partsCounts(grid: GridState): Map<number, number> {
  const counts = new Map<number, number>();
  for (let x = 1; x <= grid.dims[0] - 2; x++) {
    for (let y = 1; y <= grid.dims[1] - 2; y++) {
      for (let z = 1; z <= grid.dims[2] - 2; z++) {
        const block = grid.blocks[x]![y]![z]!;
        if (block === AIR) continue;
        counts.set(block, (counts.get(block) ?? 0) + 1);
      }
    }
  }
  return counts;
}
