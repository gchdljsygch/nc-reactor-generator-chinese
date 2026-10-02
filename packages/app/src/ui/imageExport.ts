/**
 * R2.12 — PNG export, the **painting** half.
 *
 * Consumes the pure {@link ImageExportPlan} and draws it on a canvas, then hands
 * the canvas back for encoding. Everything visual here mirrors Java's
 * `PNGWriter` draw loop:
 *
 *  - background, then the header text, then the parts list, then the layer grid,
 *    then the 3D inset (`PNGWriter:92-157`);
 *  - the casing ring is drawn as a distinct colour rather than as a texture,
 *    because the app has no migrated textures (R3.5/R3.6 use a deterministic
 *    palette colour per block instead, and the image must match the editor);
 *  - a cell with a selected recipe gets the same white tick the 2D view draws.
 *
 * There is no string building for user-visible text: the plan already carries
 * i18n-resolved strings.
 */
import { AIR } from '../model/grid.js';
import type { ImageExportPlan } from '../model/imageExport.js';
import { paletteColor } from './grid2d.js';

export interface ImageExportTheme {
  readonly background: string;
  readonly text: string;
  readonly casing: string;
  readonly empty: string;
  readonly gridLine: string;
}

export const DEFAULT_IMAGE_THEME: ImageExportTheme = {
  background: '#14171d',
  text: '#e8ecf2',
  casing: '#3a3f4b',
  empty: '#20242c',
  gridLine: '#2b303a',
};

export function paintImageExport(
  context: CanvasRenderingContext2D,
  plan: ImageExportPlan,
  theme: ImageExportTheme = DEFAULT_IMAGE_THEME,
): void {
  context.save();
  context.fillStyle = theme.background;
  context.fillRect(0, 0, plan.width, plan.height);

  context.fillStyle = theme.text;
  context.font = `${plan.textHeight}px system-ui, sans-serif`;
  context.textBaseline = 'top';
  for (const line of plan.header) context.fillText(line.text, line.x, line.y);

  for (const part of plan.parts) {
    context.fillStyle = part.color;
    context.fillRect(part.swatchX, part.y, plan.textHeight, plan.textHeight);
    context.fillStyle = theme.text;
    context.fillText(part.text, part.x, part.y);
  }

  for (const cell of plan.cells) {
    if (!cell.interior) {
      context.fillStyle = theme.casing;
      context.fillRect(cell.px, cell.py, plan.blockSize, plan.blockSize);
      context.strokeStyle = '#20242c';
      context.strokeRect(cell.px + 0.5, cell.py + 0.5, plan.blockSize - 1, plan.blockSize - 1);
      continue;
    }
    context.fillStyle = cell.block === AIR ? theme.empty : paletteColor(cell.block);
    context.fillRect(cell.px, cell.py, plan.blockSize, plan.blockSize);
    if (cell.block === AIR) {
      context.strokeStyle = theme.gridLine;
      context.strokeRect(cell.px + 0.5, cell.py + 0.5, plan.blockSize - 1, plan.blockSize - 1);
      continue;
    }
    if (cell.recipe !== AIR) {
      context.fillStyle = 'rgba(255,255,255,0.65)';
      context.fillRect(cell.px + 4, cell.py + 4, plan.blockSize - 8, 6);
    }
  }
  context.restore();
}

/** Render a plan to a fresh canvas (detached; the caller decides what to do with it). */
export function renderImageExport(
  plan: ImageExportPlan,
  theme: ImageExportTheme = DEFAULT_IMAGE_THEME,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(plan.width));
  canvas.height = Math.max(1, Math.ceil(plan.height));
  const context = canvas.getContext('2d');
  if (context !== null) paintImageExport(context, plan, theme);
  return canvas;
}

/** Canvas → PNG blob; the caller downloads it (see `dom.downloadBlob`). */
export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}

/** Font metric for the pure planner: `measureText` at the plan's text size. */
export function canvasTextMeasurer(): (text: string, textHeight: number) => number {
  const context = document.createElement('canvas').getContext('2d');
  return (text, textHeight) => {
    if (context === null) return text.length * textHeight * 0.5;
    context.font = `${textHeight}px system-ui, sans-serif`;
    return context.measureText(text).width;
  };
}
