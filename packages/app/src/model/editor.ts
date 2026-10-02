/**
 * R3.5 — editor state: tools, selection, clipboard, symmetry and undo/redo.
 *
 * Deliberately free of the DOM: every operation is a pure mutation of
 * {@link GridState} routed through {@link Editor.apply}, which is what makes the
 * editor testable without a browser (`packages/app/test/editor.test.ts`) — and
 * what will let the R4 generator reuse the same editing primitives.
 *
 * History policy: snapshots, capped at {@link HISTORY_LIMIT}. A 32³ grid is
 * ~32k cells per snapshot, so a snapshot stack is a few MB at the cap — far
 * cheaper than the bugs a command-pattern undo brings when a tool changes in
 * more than one pass (symmetry, fill, paste).
 */

import {
  AIR,
  clearAll,
  clearBox,
  cloneGrid,
  copyBox,
  countBlocks,
  createGrid,
  eraseCell,
  fillBox,
  pasteClipboard,
  resizeGrid,
  selectionBounds,
  setCell,
  type BoxSelection,
  type Clipboard,
  type Dims,
  type GridState,
  type Symmetry,
} from './grid.js';

export type ToolId = 'draw' | 'erase' | 'pick' | 'select' | 'fill';

export const HISTORY_LIMIT = 100;

export interface EditorState {
  readonly grid: GridState;
  readonly tool: ToolId;
  /** Palette entry used by `draw` / `fill`. */
  readonly paletteIndex: number;
  readonly recipeIndex: number;
  readonly selection: BoxSelection | null;
  readonly clipboard: Clipboard | null;
  readonly dirty: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly blocks: number;
}

export interface EditorOptions {
  /** Recipe count of a block index — decides whether a placed block gets a recipe. */
  readonly recipeCountFor: (blockIndex: number) => number;
  readonly historyLimit?: number;
}

type Listener = (state: EditorState) => void;

export class Editor {
  private grid: GridState;
  private tool: ToolId = 'draw';
  private paletteIndex = 0;
  private recipeIndex = AIR;
  private selection: BoxSelection | null = null;
  private clipboard: Clipboard | null = null;
  private dirty = false;
  private readonly history: GridState[] = [];
  private future: GridState[] = [];
  private readonly listeners = new Set<Listener>();
  private readonly options: EditorOptions;
  private readonly historyLimit: number;

  constructor(grid: GridState, options: EditorOptions) {
    this.grid = grid;
    this.options = options;
    this.historyLimit = options.historyLimit ?? HISTORY_LIMIT;
  }

  static empty(dims: Dims, options: EditorOptions, scalars: Record<string, number> = {}): Editor {
    return new Editor(createGrid(dims, scalars), options);
  }

  get state(): EditorState {
    return {
      grid: this.grid,
      tool: this.tool,
      paletteIndex: this.paletteIndex,
      recipeIndex: this.recipeIndex,
      selection: this.selection,
      clipboard: this.clipboard,
      dirty: this.dirty,
      canUndo: this.history.length > 0,
      canRedo: this.future.length > 0,
      blocks: countBlocks(this.grid),
    };
  }

  get current(): GridState {
    return this.grid;
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Replaces the whole grid (loading a design) and clears the history. */
  load(grid: GridState, options: { dirty?: boolean } = {}): void {
    this.grid = grid;
    this.history.length = 0;
    this.future.length = 0;
    this.selection = null;
    this.clipboard = null;
    this.dirty = options.dirty ?? false;
    this.emit();
  }

  /**
   * Runs `mutator` against a copy of the grid; the result becomes the new state
   * only when it actually changed something. Returns whether it did.
   */
  apply(mutator: (grid: GridState) => boolean): boolean {
    const next = cloneGrid(this.grid);
    const changed = mutator(next);
    if (!changed) return false;
    this.history.push(this.grid);
    if (this.history.length > this.historyLimit) this.history.shift();
    this.future = [];
    this.grid = next;
    this.dirty = true;
    this.emit();
    return true;
  }

  // ------------------------------------------------------------------ tools

  setTool(tool: ToolId): void {
    if (this.tool === tool) return;
    this.tool = tool;
    this.emit();
  }

  get currentTool(): ToolId {
    return this.tool;
  }

  /** Palette entry + which of its recipes is placed (`-1` = none). */
  setPalette(index: number, recipeIndex = AIR): void {
    this.paletteIndex = index;
    this.recipeIndex = recipeIndex;
    this.emit();
  }

  get currentPalette(): number {
    return this.paletteIndex;
  }

  // ------------------------------------------------------------- primitives

  /**
   * The recipe to place together with the palette entry. `AIR` means "none
   * selected", which is passed to `setCell` as `undefined` so *it* applies the
   * default: the first recipe of a block that has recipes, none for a block that
   * does not (`model/grid.ts`). Handing `AIR` through instead would store "no
   * recipe" on a fuel cell, and the Java editor pre-selects the first recipe of
   * the chosen block.
   */
  private get selectedRecipe(): number | undefined {
    return this.recipeIndex === AIR ? undefined : this.recipeIndex;
  }

  /** One cell of the active tool; `pick` copies the cell's palette entry. */
  paint(x: number, y: number, z: number): boolean {
    if (this.tool === 'pick') {
      const block = this.grid.blocks[x]?.[y]?.[z];
      if (block === undefined || block === AIR) return false;
      this.paletteIndex = block;
      this.recipeIndex = this.grid.recipes[x]![y]![z]!;
      this.tool = 'draw';
      this.emit();
      return true;
    }
    if (this.tool === 'erase') {
      return this.apply((grid) => eraseCell(grid, x, y, z));
    }
    return this.apply(
      (grid) =>
        setCell(grid, x, y, z, this.paletteIndex, this.selectedRecipe, this.options.recipeCountFor),
    );
  }

  fillSelection(): boolean {
    if (this.selection === null) return false;
    return this.apply((grid) =>
      fillBox(
        grid,
        this.selection!,
        this.paletteIndex,
        this.selectedRecipe,
        this.options.recipeCountFor,
      ),
    );
  }

  clearSelection(): boolean {
    if (this.selection === null) return false;
    return this.apply((grid) => clearBox(grid, this.selection!));
  }

  clearAll(): boolean {
    return this.apply((grid) => clearAll(grid));
  }

  setSymmetry(axis: keyof Symmetry, enabled: boolean): void {
    if (this.grid.symmetry[axis] === enabled) return;
    const next = cloneGrid(this.grid);
    next.symmetry[axis] = enabled;
    this.grid = next;
    this.emit();
  }

  setScalar(key: string, index: number): boolean {
    if (this.grid.scalars[key] === index) return false;
    return this.apply((grid) => {
      grid.scalars[key] = index;
      return true;
    });
  }

  // -------------------------------------------------------------- selection

  beginSelection(x: number, y: number, z: number): void {
    this.selection = { from: [x, y, z], to: [x, y, z] };
    this.emit();
  }

  updateSelection(x: number, y: number, z: number): void {
    if (this.selection === null) return;
    this.selection = { from: this.selection.from, to: [x, y, z] };
    this.emit();
  }

  /** Selects the whole interior (the Java editor's "select all"). */
  selectAll(): void {
    this.selection = {
      from: [1, 1, 1],
      to: [this.grid.dims[0] - 2, this.grid.dims[1] - 2, this.grid.dims[2] - 2],
    };
    this.emit();
  }

  deselect(): void {
    if (this.selection === null) return;
    this.selection = null;
    this.emit();
  }

  get bounds(): { min: [number, number, number]; max: [number, number, number] } | null {
    return this.selection === null ? null : selectionBounds(this.selection);
  }

  // --------------------------------------------------------------- clipboard

  /** Non-air cells currently held by the clipboard (for the UI's "copied N" note). */
  get clipboardCells(): number {
    const clipboard = this.clipboard;
    if (clipboard === null) return 0;
    let cells = 0;
    for (const plane of clipboard.blocks) {
      for (const row of plane) {
        for (const block of row) if (block !== -1) cells++;
      }
    }
    return cells;
  }

  copy(): boolean {
    if (this.selection === null) return false;
    const clipboard = copyBox(this.grid, this.selection);
    if (clipboard === null) return false;
    this.clipboard = clipboard;
    this.emit();
    return true;
  }

  cut(): boolean {
    if (!this.copy()) return false;
    return this.clearSelection();
  }

  /**
   * Paste at the selection's minimum corner by default (or an explicit target).
   * Overlapping paste preserves the symmetry flags of the loaded clipboard by
   * re-applying them cell by cell — `pasteClipboard` restores raw indices.
   */
  paste(at?: readonly [number, number, number]): boolean {
    const clipboard = this.clipboard;
    if (clipboard === null) return false;
    const target =
      at ??
      (this.selection === null
        ? ([1, 1, 1] as const)
        : (selectionBounds(this.selection).min as [number, number, number]));
    return this.apply((grid) => pasteClipboard(grid, clipboard, target));
  }

  // ---------------------------------------------------------------- history

  undo(): boolean {
    const previous = this.history.pop();
    if (previous === undefined) return false;
    this.future.push(this.grid);
    this.grid = previous;
    this.dirty = true;
    this.emit();
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (next === undefined) return false;
    this.history.push(this.grid);
    this.grid = next;
    this.dirty = true;
    this.emit();
    return true;
  }

  // ----------------------------------------------------------------- resize

  resize(dims: Dims): { clipped: number } {
    const result = resizeGrid(this.grid, dims);
    const same =
      result.grid.dims[0] === this.grid.dims[0] &&
      result.grid.dims[1] === this.grid.dims[1] &&
      result.grid.dims[2] === this.grid.dims[2];
    if (same) return { clipped: 0 };
    this.history.push(this.grid);
    if (this.history.length > this.historyLimit) this.history.shift();
    this.future = [];
    this.grid = result.grid;
    this.dirty = true;
    this.emit();
    return { clipped: result.clipped };
  }

  markSaved(): void {
    this.dirty = false;
    this.emit();
  }

  private emit(): void {
    const state = this.state;
    for (const listener of [...this.listeners]) listener(state);
  }
}

export { AIR, countBlocks, createGrid, cloneGrid };
