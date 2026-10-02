/**
 * R3.6 — the 2D layer view (top view) and the editing surface.
 *
 * One slice of the grid is drawn per layer: horizontal = the first remaining
 * axis, vertical = the second, matching Java's top view (X→Z for the default
 * Y-slice). The casing is drawn as a ring, because it is implicit in the format
 * and a user who cannot see it cannot tell an interior cell from a shell cell.
 *
 * The canvas is the input surface: left drag paints with the current tool, and
 * any drag with the `select` tool drags a box. All coordinates are grid
 * coordinates (external, casing included) — no pixel math leaks into the model.
 */

import { AIR, isInterior, type GridState } from '../model/grid.js';
import type { Editor } from '../model/editor.js';
import { clear, h } from './dom.js';

export interface PaletteLike {
  readonly index: number;
  readonly canonicalName: string;
}

export interface GridViewOptions {
  readonly editor: Editor;
  readonly palette: () => readonly PaletteLike[];
  /** Localized label for a palette index (falls back to the canonical name). */
  readonly labelFor: (index: number) => string;
  readonly onHover: (info: { x: number; y: number; z: number; block: number } | null) => void;
  /** Called after any edit so the shell can refresh panels. */
  readonly onEdited: () => void;
  /** Slice axis (0=x, 1=y, 2=z) and index. */
  readonly slice: () => { axis: 0 | 1 | 2; index: number };
}

export interface GridView {
  readonly element: HTMLElement;
  render(): void;
}

/** Deterministic, high-contrast colour per palette index (shared with the 3D view). */
export function paletteColor(index: number): string {
  if (index === AIR) return 'transparent';
  const hue = (index * 47) % 360;
  const saturation = 52 + (index % 3) * 12;
  const lightness = 42 + ((index * 13) % 4) * 6;
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

const CELL = 22;

export function createGridView(options: GridViewOptions): GridView {
  const canvas = h('canvas', { class: 'grid-canvas' }) as HTMLCanvasElement;
  const status = h('div', { class: 'grid-status' });
  const element = h('div', { class: 'grid-view' }, [canvas, status]);
  const context = canvas.getContext('2d');

  let dragging: 'paint' | 'select' | 'erase' | null = null;
  let hover: { x: number; y: number; z: number } | null = null;

  /** Map (column, row) on screen to grid coordinates for the current slice. */
  const coordsFor = (column: number, row: number): [number, number, number] => {
    const { axis, index } = options.slice();
    if (axis === 0) return [index, column, row];
    if (axis === 1) return [column, index, row];
    return [column, row, index];
  };

  const cellFromEvent = (event: MouseEvent): [number, number, number] | null => {
    const rect = canvas.getBoundingClientRect();
    const column = Math.floor((event.clientX - rect.left) / CELL);
    const row = Math.floor((event.clientY - rect.top) / CELL);
    const grid = options.editor.current;
    const { axis } = options.slice();
    const width = axis === 0 ? grid.dims[1] : grid.dims[0];
    const height = axis === 2 ? grid.dims[1] : grid.dims[2];
    if (column < 0 || row < 0 || column >= width || row >= height) return null;
    return coordsFor(column, row);
  };

  const onPointerDown = (event: MouseEvent): void => {
    const cell = cellFromEvent(event);
    if (cell === null) return;
    const tool = options.editor.currentTool;
    if (tool === 'select') {
      dragging = 'select';
      options.editor.beginSelection(cell[0], cell[1], cell[2]);
      return;
    }
    dragging = 'paint';
    options.editor.paint(cell[0], cell[1], cell[2]);
    options.onEdited();
  };

  const onPointerMove = (event: MouseEvent): void => {
    const cell = cellFromEvent(event);
    if (cell === null) {
      if (hover !== null) {
        hover = null;
        options.onHover(null);
        render();
      }
      return;
    }
    if (hover === null || hover.x !== cell[0] || hover.y !== cell[1] || hover.z !== cell[2]) {
      hover = { x: cell[0], y: cell[1], z: cell[2] };
      options.onHover({ ...hover, block: options.editor.current.blocks[cell[0]]?.[cell[1]]?.[cell[2]] ?? AIR });
      render();
    }
    if (dragging === 'select') {
      options.editor.updateSelection(cell[0], cell[1], cell[2]);
      render();
      return;
    }
    if (dragging === 'paint') {
      options.editor.paint(cell[0], cell[1], cell[2]);
      options.onEdited();
    }
  };

  const onPointerUp = (): void => {
    dragging = null;
  };

  canvas.addEventListener('mousedown', onPointerDown);
  canvas.addEventListener('mousemove', onPointerMove);
  window.addEventListener('mouseup', onPointerUp);
  canvas.addEventListener('mouseleave', () => {
    hover = null;
    options.onHover(null);
    render();
  });

  const render = (): void => {
    if (context === null) return;
    const grid: GridState = options.editor.current;
    const { axis, index } = options.slice();
    const width = axis === 0 ? grid.dims[1] : grid.dims[0];
    const height = axis === 2 ? grid.dims[1] : grid.dims[2];
    canvas.width = width * CELL;
    canvas.height = height * CELL;
    context.clearRect(0, 0, canvas.width, canvas.height);

    const palette = options.palette();
    const bounds = options.editor.bounds;

    for (let column = 0; column < width; column++) {
      for (let row = 0; row < height; row++) {
        const [x, y, z] = coordsFor(column, row);
        const interior = isInterior(grid, x, y, z);
        const block = grid.blocks[x]?.[y]?.[z] ?? AIR;
        const left = column * CELL;
        const top = row * CELL;
        if (!interior) {
          // The casing shell: implicit in the file format, so it must be visible.
          context.fillStyle = '#3a3f4b';
          context.fillRect(left, top, CELL, CELL);
          context.strokeStyle = '#20242c';
          context.strokeRect(left + 0.5, top + 0.5, CELL - 1, CELL - 1);
          continue;
        }
        context.fillStyle = block === AIR ? '#20242c' : paletteColor(block);
        context.fillRect(left, top, CELL, CELL);
        if (block === AIR) {
          context.strokeStyle = '#2b303a';
          context.strokeRect(left + 0.5, top + 0.5, CELL - 1, CELL - 1);
        } else {
          const recipe = grid.recipes[x]?.[y]?.[z] ?? AIR;
          if (recipe !== AIR) {
            context.fillStyle = 'rgba(255,255,255,0.65)';
            context.fillRect(left + 4, top + 4, CELL - 8, 4);
          }
          const entry = palette[block];
          context.fillStyle = 'rgba(0,0,0,0.55)';
          context.font = '10px system-ui, sans-serif';
          context.fillText(shortLabel(entry?.canonicalName ?? String(block)), left + 3, top + CELL - 4);
        }
        if (bounds !== null && within(bounds, x, y, z)) {
          context.strokeStyle = '#f2c14e';
          context.lineWidth = 2;
          context.strokeRect(left + 1, top + 1, CELL - 2, CELL - 2);
          context.lineWidth = 1;
        }
        if (hover !== null && hover.x === x && hover.y === y && hover.z === z) {
          context.strokeStyle = '#7fd1ff';
          context.strokeRect(left + 0.5, top + 0.5, CELL - 1, CELL - 1);
        }
      }
    }
    status.textContent = hoverText(grid, hover, options.labelFor);
  };

  function hoverText(
    grid: GridState,
    cell: { x: number; y: number; z: number } | null,
    labelFor: (index: number) => string,
  ): string {
    if (cell === null) return '';
    const interior = isInterior(grid, cell.x, cell.y, cell.z);
    const block = grid.blocks[cell.x]?.[cell.y]?.[cell.z] ?? AIR;
    const name = !interior ? 'casing' : block === AIR ? 'air' : labelFor(block);
    return `${cell.x},${cell.y},${cell.z}  ${name}`;
  }

  return { element, render };
}

function within(
  bounds: { min: [number, number, number]; max: [number, number, number] },
  x: number,
  y: number,
  z: number,
): boolean {
  return (
    x >= bounds.min[0] &&
    y >= bounds.min[1] &&
    z >= bounds.min[2] &&
    x <= bounds.max[0] &&
    y <= bounds.max[1] &&
    z <= bounds.max[2]
  );
}

function shortLabel(name: string): string {
  const tail = name.includes(':') ? (name.split(':').pop() ?? name) : name;
  const trimmed = tail.replace(/_/g, ' ');
  return trimmed.length > 10 ? `${trimmed.slice(0, 9)}…` : trimmed;
}

/** Rebuild a view in place (used when the palette or configuration changes). */
export function refreshView(view: GridView, container: HTMLElement): void {
  clear(container);
  container.append(view.element);
  view.render();
}
