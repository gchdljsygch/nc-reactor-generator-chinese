import type { JsonObject } from './json.js';
import { booleanOf } from './json.js';

/**
 * `multiblock/symmetry/StandardSymmetry` — the six boolean symmetries the
 * mutators apply to every edit.
 *
 * Ported exactly, including the *order* of the mirror expansions and the
 * de-duplication: the sets grow one axis at a time (`mx`, `my`, `mz`, then the
 * three 180° rotations), each expanding the whole current set. Ordering matters
 * because a mutator writes the same random block into every returned cell, so a
 * different order only matters for *which* cells survive the bounds check — and it
 * does not here, because the transform is a pure function per axis.
 */

export interface Cell {
  x: number;
  y: number;
  z: number;
}

export interface SymmetryFlags {
  mx: boolean;
  my: boolean;
  mz: boolean;
  rx180: boolean;
  ry180: boolean;
  rz180: boolean;
}

export const NO_SYMMETRY: SymmetryFlags = {
  mx: false,
  my: false,
  mz: false,
  rx180: false,
  ry180: false,
  rz180: false,
};

/** Java `StandardSymmetry`, reduced to the plain data the mutators need. */
export class Symmetry implements SymmetryFlags {
  mx = false;
  my = false;
  mz = false;
  rx180 = false;
  ry180 = false;
  rz180 = false;

  set(flags: Partial<SymmetryFlags>): void {
    this.mx = flags.mx ?? false;
    this.my = flags.my ?? false;
    this.mz = flags.mz ?? false;
    this.rx180 = flags.rx180 ?? false;
    this.ry180 = flags.ry180 ?? false;
    this.rz180 = flags.rz180 ?? false;
  }

  get enabled(): boolean {
    return this.mx || this.my || this.mz || this.rx180 || this.ry180 || this.rz180;
  }

  /**
   * Java `StandardSymmetry.apply(pos, w, h, d, consumer)`.
   *
   * `w`/`h`/`d` are the **internal** dimensions the coordinates live in (the
   * generator grid is 0-based internal), so the mirror is `w - x - 1`.
   */
  apply(x: number, y: number, z: number, w: number, h: number, d: number, visit: (cell: Cell) => void): void {
    const seen = new Map<string, Cell>();
    const add = (cell: Cell): void => {
      seen.set(`${cell.x},${cell.y},${cell.z}`, cell);
    };
    add({ x, y, z });
    if (this.mx) for (const p of [...seen.values()]) add({ x: w - p.x - 1, y: p.y, z: p.z });
    if (this.my) for (const p of [...seen.values()]) add({ x: p.x, y: h - p.y - 1, z: p.z });
    if (this.mz) for (const p of [...seen.values()]) add({ x: p.x, y: p.y, z: d - p.z - 1 });
    if (this.rx180) for (const p of [...seen.values()]) add({ x: p.x, y: h - p.y - 1, z: d - p.z - 1 });
    if (this.ry180) for (const p of [...seen.values()]) add({ x: w - p.x - 1, y: p.y, z: d - p.z - 1 });
    if (this.rz180) for (const p of [...seen.values()]) add({ x: w - p.x - 1, y: h - p.y - 1, z: p.z });
    for (const p of seen.values()) {
      if (p.x < 0 || p.y < 0 || p.z < 0 || p.x >= w || p.y >= h || p.z >= d) continue;
      visit(p);
    }
  }

  toJson(): JsonObject {
    // Java `Symmetry.convertToObject`.
    return {
      mirror_x: this.mx,
      mirror_y: this.my,
      mirror_z: this.mz,
      rotate_180_x: this.rx180,
      rotate_180_y: this.ry180,
      rotate_180_z: this.rz180,
    };
  }

  static fromJson(json: JsonObject): Symmetry {
    const symmetry = new Symmetry();
    symmetry.mx = booleanOf(json.mirror_x);
    symmetry.my = booleanOf(json.mirror_y);
    symmetry.mz = booleanOf(json.mirror_z);
    symmetry.rx180 = booleanOf(json.rotate_180_x);
    symmetry.ry180 = booleanOf(json.rotate_180_y);
    symmetry.rz180 = booleanOf(json.rotate_180_z);
    return symmetry;
  }

  copy(): Symmetry {
    const copy = new Symmetry();
    copy.set(this);
    return copy;
  }
}
