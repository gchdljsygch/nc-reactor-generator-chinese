/**
 * Grid geometry, ported from `net.ncplanner.plannerator.multiblock`.
 *
 * The layout is a cuboid grid of **external** dimensions `(x+2, y+2, z+2)`: the
 * casing occupies the outer shell (indices 0 and dim-1) and the interior is
 * `1..x`. Positions iterate in `x`, then `y`, then `z` order, which is the order
 * the Java engine uses for every block scan — and therefore the order in which
 * `float` sums accumulate. That order is part of the port's contract.
 */

/** Java `Direction.values()` order: PX, PY, PZ, NX, NY, NZ. */
export const DIRECTION_VECTORS: readonly (readonly [number, number, number])[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [-1, 0, 0],
  [0, -1, 0],
  [0, 0, -1],
];

export type DirectionIndex = 0 | 1 | 2 | 3 | 4 | 5;

/** Java `Axis.axes` = X, Y, Z. */
export const AXES: readonly (readonly [number, number, number])[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

export interface Pos {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export function pos(x: number, y: number, z: number): Pos {
  return { x, y, z };
}

export function offset(p: Pos, x: number, y: number, z: number): Pos {
  return { x: p.x + x, y: p.y + y, z: p.z + z };
}

export function offsetDir(p: Pos, d: readonly [number, number, number], n = 1): Pos {
  return { x: p.x + d[0] * n, y: p.y + d[1] * n, z: p.z + d[2] * n };
}

export function posEquals(a: Pos, b: Pos): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

export function oppositeDir(d: readonly [number, number, number]): readonly [number, number, number] {
  return [-d[0], -d[1], -d[2]];
}

/** Java `Edge` pairs (used by placement rules). */
export const EDGES: readonly (readonly [number, number])[] = [
  [0, 1],
  [0, 4],
  [3, 1],
  [3, 4],
  [0, 2],
  [0, 5],
  [3, 2],
  [3, 5],
  [1, 2],
  [1, 5],
  [4, 2],
  [4, 5],
];

/** Java `Vertex` triples (used by placement rules). */
export const VERTICES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [0, 1, 5],
  [0, 4, 2],
  [0, 4, 5],
  [3, 1, 2],
  [3, 1, 5],
  [3, 4, 2],
  [3, 4, 5],
];

/**
 * A cuboidal grid holding `(x+2)*(y+2)*(z+2)` slots, where `x/y/z` are the
 * *interior* dimensions.
 */
export class CuboidGrid<T extends { pos: Pos }> {
  /** Interior width / height / depth. */
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly externalWidth: number;
  readonly externalHeight: number;
  readonly externalDepth: number;
  private readonly cells: (T | null)[];

  constructor(width: number, height: number, depth: number) {
    this.width = width;
    this.height = height;
    this.depth = depth;
    this.externalWidth = width + 2;
    this.externalHeight = height + 2;
    this.externalDepth = depth + 2;
    this.cells = new Array(this.externalWidth * this.externalHeight * this.externalDepth).fill(
      null,
    );
  }

  contains(p: Pos): boolean {
    return (
      p.x >= 0 &&
      p.y >= 0 &&
      p.z >= 0 &&
      p.x < this.externalWidth &&
      p.y < this.externalHeight &&
      p.z < this.externalDepth
    );
  }

  private index(p: Pos): number {
    return p.x * this.externalHeight * this.externalDepth + p.y * this.externalDepth + p.z;
  }

  /** Java `BlockGrid.getBlock` — `undefined` outside, `null` for air inside. */
  get(p: Pos): T | null | undefined {
    if (!this.contains(p)) return undefined;
    return this.cells[this.index(p)] ?? null;
  }

  set(p: Pos, block: T | null): void {
    if (!this.contains(p)) return;
    this.cells[this.index(p)] = block;
  }

  /** Java `Multiblock.getBlocks()` — every non-air block, in x,y,z order. */
  blocks(): T[] {
    const out: T[] = [];
    for (let x = 0; x < this.externalWidth; x++) {
      for (let y = 0; y < this.externalHeight; y++) {
        for (let z = 0; z < this.externalDepth; z++) {
          const b = this.cells[x * this.externalHeight * this.externalDepth + y * this.externalDepth + z];
          if (b) out.push(b);
        }
      }
    }
    return out;
  }

  /** Java `forEachPosition`. */
  forEachPosition(fn: (p: Pos) => void): void {
    for (let x = 0; x < this.externalWidth; x++) {
      for (let y = 0; y < this.externalHeight; y++) {
        for (let z = 0; z < this.externalDepth; z++) {
          fn({ x, y, z });
        }
      }
    }
  }

  /** Java `forEachInternalPosition`. */
  forEachInternalPosition(fn: (p: Pos) => void): void {
    for (let x = 1; x <= this.width; x++) {
      for (let y = 1; y <= this.height; y++) {
        for (let z = 1; z <= this.depth; z++) {
          fn({ x, y, z });
        }
      }
    }
  }

  /** Java `forEachCasingPosition` — any coordinate on the outer shell. */
  forEachCasingPosition(fn: (p: Pos) => void): void {
    this.forEachPosition((p) => {
      if (
        p.x === 0 ||
        p.y === 0 ||
        p.z === 0 ||
        p.x === this.width + 1 ||
        p.y === this.height + 1 ||
        p.z === this.depth + 1
      ) {
        fn(p);
      }
    });
  }

  /** Java `getInternalVolume`. */
  internalVolume(): number {
    return this.width * this.height * this.depth;
  }
}
