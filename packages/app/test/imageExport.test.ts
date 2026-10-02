/**
 * R2.12 — PNG export layout.
 *
 * The layout is a port of `PNGWriter.write` (`:36-90` + the `:130-156` draw
 * loop), and its arithmetic is what can be wrong invisibly: a wrong
 * `multisPerRow` still produces a plausible image, just a different one from
 * Java's. These tests pin the numbers Java's code computes, using a deterministic
 * stand-in for the font metric so they are reproducible without a canvas.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BLOCK_SIZE,
  DEFAULT_BORDER_SIZE,
  exportBounds,
  isCasingPart,
  planImageExport,
  type ImageExportInput,
} from '../src/model/imageExport.js';
import { AIR, createGrid } from '../src/model/grid.js';

/** 0.5 * textHeight per character — Java's `getStringWidth` is proportional too. */
const measure = (text: string, textHeight: number): number => text.length * textHeight * 0.5;

function base(overrides: Partial<ImageExportInput> = {}): ImageExportInput {
  const grid = createGrid([5, 5, 5]);
  grid.blocks[2]![2]![2] = 7;
  return {
    dims: grid.dims,
    grid,
    bounds: { x1: 2, y1: 2, z1: 2, x2: 2, y2: 2, z2: 2 },
    headerLines: ['NuclearCraft 2.1.7'],
    parts: [{ name: 'Fuel Cell', label: '1x Fuel Cell', count: 1, color: '#fff' }],
    includeCasingParts: true,
    view3D: false,
    includeCasing: true,
    ...overrides,
  };
}

describe('r2.12 image export layout', () => {
  it('scales the text with the block size like PNGWriter:29/:49', () => {
    const plan = planImageExport(base(), measure);
    expect(plan.blockSize).toBe(DEFAULT_BLOCK_SIZE);
    // 20 * 32 / 16
    expect(plan.textHeight).toBe(40);
    expect(plan.borderSize).toBe(DEFAULT_BORDER_SIZE);
  });

  it('sizes a 1x1x1 design from the header/parts widths, not the layer', () => {
    const plan = planImageExport(base(), measure);
    // `NuclearCraft 2.1.7` = 18 chars → textWidth = 18 * 40 * 0.5 = 360
    // `1x Fuel Cell`      = 12 chars → partsWidth = 40 + 12 * 40 * 0.5 = 280
    // width = max(360 + 280, 1 * 32 + 16) = 640
    expect(plan.headerWidth).toBe(360 + DEFAULT_BORDER_SIZE);
    expect(plan.partsWidth).toBe(280 + DEFAULT_BORDER_SIZE);
    expect(plan.width).toBe(640);
    // one layer: height = max(40, 40) + 1 * (32 + 16) + 8 = 96
    expect(plan.multisPerRow).toBe(Math.floor(640 / (32 + DEFAULT_BORDER_SIZE)));
    expect(plan.height).toBe(96);
  });

  it('lays layers out column-major, wrapping at multisPerRow', () => {
    const grid = createGrid([9, 9, 9]);
    for (let y = 1; y < 8; y++) grid.blocks[1]![y]![1] = 3;
    const plan = planImageExport(
      {
        ...base(),
        grid,
        dims: grid.dims,
        bounds: { x1: 1, y1: 1, z1: 1, x2: 1, y2: 7, z2: 1 },
        headerLines: ['x'],
        parts: [],
      },
      measure,
    );
    expect(plan.rowCount).toBe(Math.ceil(7 / plan.multisPerRow));
    const first = plan.cells.filter((cell) => cell.y === 1)[0]!;
    const second = plan.cells.filter((cell) => cell.y === 2)[0]!;
    // Consecutive layers advance by one whole layer *column*, never by a row,
    // while they still fit in the first row (`PNGWriter:131-132`).
    expect(second.px - first.px).toBe(plan.blockSize + DEFAULT_BORDER_SIZE);
    expect(second.py).toBe(first.py);
  });

  it('drops the structural blocks from the parts list like PNGWriter:52-63', () => {
    const parts = [
      { name: 'Casing', label: 'Casing', count: 10, color: '#fff' },
      { name: 'Fuel Cell', label: 'Fuel Cell', count: 1, color: '#fff' },
      { name: 'Reactor Glass', label: 'Reactor Glass', count: 2, color: '#fff' },
      { name: 'Inlet', label: 'Inlet', count: 1, color: '#fff' },
    ];
    const kept = planImageExport(base({ parts, includeCasingParts: false }), measure);
    expect(kept.parts.map((part) => part.name)).toEqual(['Fuel Cell']);
    const all = planImageExport(base({ parts, includeCasingParts: true }), measure);
    expect(all.parts).toHaveLength(4);
  });

  it('classifies casing parts by lowercased substring', () => {
    for (const name of ['Casing', 'PORT', 'Controller', 'Vent', 'Glass', 'inlet', 'Outlet']) {
      expect(isCasingPart(name)).toBe(true);
    }
    expect(isCasingPart('Fuel Cell')).toBe(false);
    expect(isCasingPart('Moderator')).toBe(false);
  });

  it('reserves inset width only when the 3D view is on', () => {
    const off = planImageExport(base(), measure);
    const on = planImageExport(base({ view3D: true }), measure);
    // textWidth + partsWidth = 640 either way, and the inset needs totalTextHeight.
    expect(on.width).toBeGreaterThanOrEqual(off.width);
    expect(off.inset).toBeNull();
    expect(on.inset).not.toBeNull();
    expect(on.inset!.y).toBe(on.totalTextHeight / 2);
  });

  it('places every cell inside the image', () => {
    const grid = createGrid([6, 4, 6]);
    for (let x = 1; x < 5; x++) {
      for (let y = 1; y < 3; y++) {
        for (let z = 1; z < 5; z++) grid.blocks[x]![y]![z] = (x + y + z) % 5;
      }
    }
    const plan = planImageExport(
      { ...base(), grid, dims: grid.dims, bounds: exportBounds(grid, false), headerLines: ['a', 'b'], parts: [] },
      measure,
    );
    for (const cell of plan.cells) {
      expect(cell.px).toBeGreaterThanOrEqual(0);
      expect(cell.py).toBeGreaterThanOrEqual(0);
      expect(cell.px + plan.blockSize).toBeLessThanOrEqual(plan.width);
      expect(cell.py + plan.blockSize).toBeLessThanOrEqual(plan.height);
    }
    // Every non-air cell of the interior is drawn exactly once.
    const drawn = plan.cells.filter((cell) => cell.interior && cell.block !== AIR);
    expect(drawn).toHaveLength(4 * 2 * 4);
  });

  it('computes the bounding box over non-air cells, widening it for the casing', () => {
    const grid = createGrid([5, 5, 5]);
    grid.blocks[2]![3]![1] = 2;
    const tight = exportBounds(grid, false);
    expect(tight).toEqual({ x1: 2, y1: 3, z1: 1, x2: 2, y2: 3, z2: 1 });
    const wide = exportBounds(grid, true);
    expect(wide).toEqual({ x1: 0, y1: 0, z1: 0, x2: 4, y2: 4, z2: 4 });
    // An empty design still has a box: the whole grid.
    expect(exportBounds(createGrid([4, 4, 4]), false)).toEqual({ x1: 0, y1: 0, z1: 0, x2: 3, y2: 3, z2: 3 });
  });
});
