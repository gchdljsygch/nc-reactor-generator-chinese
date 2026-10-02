import { describe, expect, it } from 'vitest';
import { AIR, Editor, createGrid } from '@ncplanner/app';

/**
 * R3.5 — editor behaviour: tools, symmetry-aware edits, clipboard and undo/redo.
 */

const options = { recipeCountFor: () => 2 };

function editor(): Editor {
  return new Editor(createGrid([5, 5, 5]), options);
}

describe('editor tools', () => {
  it('places the current palette entry and preselects its first recipe', () => {
    const state = editor();
    state.setPalette(3);
    expect(state.paint(1, 1, 1)).toBe(true);
    const grid = state.current;
    expect(grid.blocks[1][1][1]).toBe(3);
    expect(grid.recipes[1][1][1]).toBe(0);
  });

  it('does not place a recipe on a block that has none', () => {
    const state = new Editor(createGrid([5, 5, 5]), { recipeCountFor: () => 0 });
    state.setPalette(2);
    state.paint(2, 2, 2);
    expect(state.current.recipes[2][2][2]).toBe(AIR);
  });

  it('erases and picks', () => {
    const state = editor();
    state.setPalette(5);
    state.paint(1, 1, 1);
    state.setPalette(0);
    state.setTool('pick');
    expect(state.paint(1, 1, 1)).toBe(true);
    // picking switches back to drawing with the picked entry
    expect(state.currentPalette).toBe(5);
    expect(state.currentTool).toBe('draw');
    state.setTool('erase');
    state.paint(1, 1, 1);
    expect(state.current.blocks[1][1][1]).toBe(AIR);
  });

  it('fills and clears a selection', () => {
    const state = editor();
    state.setPalette(1);
    state.beginSelection(1, 1, 1);
    state.updateSelection(3, 3, 3);
    expect(state.fillSelection()).toBe(true);
    let filled = 0;
    for (let x = 1; x <= 3; x++) {
      for (let y = 1; y <= 3; y++) {
        for (let z = 1; z <= 3; z++) if (state.current.blocks[x][y][z] === 1) filled++;
      }
    }
    expect(filled).toBe(27);
    expect(state.clearSelection()).toBe(true);
    expect(state.state.blocks).toBe(0);
  });

  it('paints through symmetry', () => {
    const state = editor();
    state.setSymmetry('x', true);
    state.setPalette(6);
    state.paint(1, 2, 2);
    // interior width 3 → mirror of 1 is 3
    expect(state.current.blocks[1][2][2]).toBe(6);
    expect(state.current.blocks[3][2][2]).toBe(6);
  });
});

describe('editor clipboard', () => {
  it('reports how many blocks the clipboard holds', () => {
    const state = editor();
    state.setPalette(1);
    state.paint(1, 1, 1);
    state.setPalette(2);
    state.paint(2, 1, 1);
    state.beginSelection(1, 1, 1);
    state.updateSelection(2, 1, 1);
    expect(state.clipboardCells).toBe(0);
    expect(state.copy()).toBe(true);
    // The empty cells of the bounding box are not "copied blocks".
    expect(state.clipboardCells).toBe(2);
    state.clearSelection();
    state.paste();
    expect(state.current.blocks[1][1][1]).toBe(1);
    expect(state.current.blocks[2][1][1]).toBe(2);
  });
});

describe('editor history', () => {
  it('undoes and redoes every edit', () => {
    const state = editor();
    state.setPalette(1);
    state.paint(1, 1, 1);
    state.setPalette(2);
    state.paint(2, 2, 2);
    expect(state.state.canUndo).toBe(true);
    state.undo();
    expect(state.current.blocks[2][2][2]).toBe(AIR);
    expect(state.current.blocks[1][1][1]).toBe(1);
    state.undo();
    expect(state.current.blocks[1][1][1]).toBe(AIR);
    expect(state.state.canUndo).toBe(false);
    state.redo();
    expect(state.current.blocks[1][1][1]).toBe(1);
  });

  it('drops the redo stack once a new edit lands', () => {
    const state = editor();
    state.setPalette(1);
    state.paint(1, 1, 1);
    state.undo();
    state.setPalette(4);
    state.paint(3, 3, 3);
    expect(state.state.canRedo).toBe(false);
  });

  it('does not record a no-op edit', () => {
    const state = editor();
    state.setPalette(1);
    state.paint(1, 1, 1);
    const before = state.state.canUndo;
    // painting on the casing changes nothing
    expect(state.paint(0, 0, 0)).toBe(false);
    expect(state.state.canUndo).toBe(before);
  });

  it('copies, cuts and pastes with history', () => {
    const state = editor();
    state.setPalette(9);
    state.paint(1, 1, 1);
    state.beginSelection(1, 1, 1);
    state.updateSelection(1, 1, 1);
    expect(state.copy()).toBe(true);
    expect(state.cut()).toBe(true);
    expect(state.current.blocks[1][1][1]).toBe(AIR);
    expect(state.paste([3, 3, 3])).toBe(true);
    expect(state.current.blocks[3][3][3]).toBe(9);
  });

  it('resizes and clips', () => {
    const state = editor();
    state.setPalette(1);
    state.paint(3, 3, 3);
    const result = state.resize([4, 4, 4]);
    expect(result.clipped).toBe(1);
    expect(state.current.dims).toEqual([4, 4, 4]);
    expect(state.state.blocks).toBe(0);
    state.undo();
    expect(state.current.dims).toEqual([5, 5, 5]);
    expect(state.current.blocks[3][3][3]).toBe(1);
  });

  it('loads a grid and clears the history', () => {
    const state = editor();
    state.setPalette(1);
    state.paint(1, 1, 1);
    state.load(createGrid([7, 7, 7]));
    expect(state.state.canUndo).toBe(false);
    expect(state.current.dims).toEqual([7, 7, 7]);
  });
});
