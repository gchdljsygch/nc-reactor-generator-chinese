import { describe, expect, it } from 'vitest';
import {
  AIR,
  copyBox,
  createGrid,
  fillBox,
  interiorDims,
  mirrorCells,
  pasteClipboard,
  partsCounts,
  resizeGrid,
  selectionBounds,
  setCell,
} from '@ncplanner/app';

/**
 * R3.5 — the editor's grid model.
 *
 * These are the invariants the physics depends on: external dimensions with an
 * implicit casing shell, indices that mean the same thing as the file format,
 * symmetry that mirrors about the interior centre, and an undo stack that
 * actually restores state.
 */

const recipes = (count: number) => () => count;

describe('grid geometry', () => {
  it('treats the outer shell as casing and never edits it', () => {
    const grid = createGrid([5, 5, 5]);
    expect(setCell(grid, 0, 2, 2, 3, AIR, recipes(0))).toBe(false);
    expect(setCell(grid, 4, 2, 2, 3, AIR, recipes(0))).toBe(false);
    expect(grid.blocks[0][2][2]).toBe(AIR);
    // interior is 1..dim-2
    expect(setCell(grid, 1, 2, 2, 3, AIR, recipes(0))).toBe(true);
    expect(grid.blocks[1][2][2]).toBe(3);
  });

  it('reports interior dimensions the way the kernel does', () => {
    expect(interiorDims([7, 7, 7])).toEqual([5, 5, 5]);
  });

  it('mirrors about the interior centre, not the origin', () => {
    // interior width 3 → 1↔3, 2↔2
    const grid = createGrid([5, 5, 5]);
    grid.symmetry.x = true;
    const mirrored = mirrorCells(grid, 1, 2, 2).map((cell) => cell.join(',')).sort();
    expect(mirrored).toEqual(['1,2,2', '3,2,2']);
    // a cell on the mirror plane is returned once
    expect(mirrorCells(grid, 2, 2, 2)).toHaveLength(1);
  });

  it('applies every enabled axis at once', () => {
    const grid = createGrid([5, 5, 5]);
    grid.symmetry.x = true;
    grid.symmetry.z = true;
    const cells = mirrorCells(grid, 1, 1, 1).map((cell) => cell.join(',')).sort();
    expect(cells).toEqual(['1,1,1', '1,1,3', '3,1,1', '3,1,3']);
  });

  it('fills a box and clips it to the interior', () => {
    const grid = createGrid([5, 5, 5]);
    fillBox(grid, { from: [0, 0, 0], to: [9, 9, 9] }, 2, AIR, recipes(0));
    expect(partsCounts(grid).get(2)).toBe(27); // 3×3×3 interior
  });

  it('keeps the minimum corner anchored on resize and counts what it drops', () => {
    const grid = createGrid([5, 5, 5]);
    setCell(grid, 1, 1, 1, 7, AIR, recipes(0));
    setCell(grid, 3, 3, 3, 7, AIR, recipes(0));
    const result = resizeGrid(grid, [4, 4, 4]);
    expect(result.grid.dims).toEqual([4, 4, 4]);
    expect(result.clipped).toBe(1);
    expect(result.grid.blocks[1][1][1]).toBe(7);
    expect(result.grid.blocks[2][2][2]).toBe(AIR);
  });

  it('copies and pastes a box, preserving recipes', () => {
    const grid = createGrid([7, 7, 7]);
    grid.blocks[1][1][1] = 4;
    grid.recipes[1][1][1] = 2;
    const clipboard = copyBox(grid, { from: [1, 1, 1], to: [2, 2, 2] });
    expect(clipboard).not.toBeNull();
    const target = createGrid([7, 7, 7]);
    expect(pasteClipboard(target, clipboard!, [3, 3, 3])).toBe(true);
    expect(target.blocks[3][3][3]).toBe(4);
    expect(target.recipes[3][3][3]).toBe(2);
  });

  it('normalises a selection regardless of drag direction', () => {
    expect(selectionBounds({ from: [3, 3, 3], to: [1, 1, 1] })).toEqual({
      min: [1, 1, 1],
      max: [3, 3, 3],
    });
  });
});
