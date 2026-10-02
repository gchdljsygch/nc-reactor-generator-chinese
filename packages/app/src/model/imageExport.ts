/**
 * R2.12 — PNG export, the **pure** half.
 *
 * Java's `planner/file/writer/PNGWriter.java` renders a design as one image: a
 * text header (`configuration name + version`, one line per addon, then the
 * design's save tooltip), a parts list with each part's count and swatch, and the
 * design's layers laid out as a grid of `blockSize`-pixel cells, optionally with
 * a 3D inset.
 *
 * The layout arithmetic is the part that can be wrong silently, so it lives here
 * as a pure function — no DOM, no canvas, no fonts — and is unit-tested against
 * the numbers Java's code produces. The painter (`ui/imageExport.ts`) only draws
 * what this returns.
 *
 * Faithful to Java, including the parts that look odd:
 *
 *  - `textHeight = 20 * blockSize / 16` scales the 20 px text with the block size
 *    (`PNGWriter:29`, `:49`), so a 32 px block gives 40 px text;
 *  - the layer grid is laid out **column-major**: layer `y` sits at column
 *    `y % multisPerRow`, row `floor(y / multisPerRow)` (`:131-132`);
 *  - the width/height fixpoint loop (`:85-90`) *drops* the `borderSize/2` that the
 *    first height calculation added — mirrored deliberately, because otherwise the
 *    image is a different shape than Java's;
 *  - with `imageExport3DView` the header reserves `totalTextHeight` of extra width
 *    for the inset.
 */
import { AIR, type Dims, type GridState } from './grid.js';

export interface ImageExportPart {
  /** Canonical part name — used only for the casing filter, never for display. */
  readonly name: string;
  /** Fully formatted line for the image (`t('image.partLine', {0: count, 1: name})`). */
  readonly label: string;
  readonly count: number;
  /** CSS colour for the swatch — the app has no textures (R3.5/R3.6 palette). */
  readonly color: string;
}

export interface ImageExportBounds {
  readonly x1: number;
  readonly y1: number;
  readonly z1: number;
  readonly x2: number;
  readonly y2: number;
  readonly z2: number;
}

export interface ImageExportInput {
  readonly dims: Dims;
  readonly grid: GridState;
  /** Bounding box of what should be drawn (Java `mb.getBoundingBox(casing)`). */
  readonly bounds: ImageExportBounds;
  /** Header lines, top to bottom (configuration, addons, stats). */
  readonly headerLines: readonly string[];
  readonly parts: readonly ImageExportPart[];
  /** `Core.imageExportCasing` — keep the casing/port/vent lines in the parts list. */
  readonly includeCasingParts: boolean;
  /** `Core.imageExport3DView` — reserve and draw the 3D inset. */
  readonly view3D: boolean;
  /** `Core.imageExportCasing` — draw the implicit shell cells. */
  readonly includeCasing: boolean;
}

export interface ImageExportPlan {
  readonly width: number;
  readonly height: number;
  /** Java's `100*20*blockSize/16`-scaled metrics, for the painter. */
  readonly blockSize: number;
  readonly textHeight: number;
  readonly borderSize: number;
  readonly totalTextHeight: number;
  readonly headerWidth: number;
  readonly partsWidth: number;
  readonly multisPerRow: number;
  readonly rowCount: number;
  readonly header: readonly { text: string; x: number; y: number }[];
  readonly parts: readonly {
    text: string;
    name: string;
    color: string;
    count: number;
    x: number;
    y: number;
    swatchX: number;
  }[];
  readonly cells: readonly {
    x: number;
    y: number;
    z: number;
    px: number;
    py: number;
    interior: boolean;
    block: number;
    recipe: number;
  }[];
  /** Position of the 3D inset, or `null` when `view3D` is off. */
  readonly inset: { x: number; y: number; size: number } | null;
}

/** Java `PNGWriter:29-30`: the text scales with the block size. */
export const DEFAULT_BLOCK_SIZE = 32;
export const DEFAULT_TEXT_HEIGHT = 20;
export const DEFAULT_BORDER_SIZE = 16;

/**
 * Java's `Core.imageExportCasingParts == false` filter (`PNGWriter:52-63`): drop
 * the structural blocks from the parts list by *name substring*, lowercased.
 */
const CASING_WORDS: readonly string[] = [
  'casing',
  'port',
  'controller',
  'vent',
  'glass',
  'inlet',
  'outlet',
];

export function isCasingPart(name: string): boolean {
  const lower = name.toLowerCase();
  return CASING_WORDS.some((word) => lower.includes(word));
}

/**
 * The bounding box Java's `Multiblock.getBoundingBox(includeCasing)` returns, over
 * the app's external-coordinate grid: the extent of every non-air interior cell,
 * or the whole interior when `includeCasing` is set (the casing ring is implicit
 * here, so it can only widen the box to the grid itself).
 */
export function exportBounds(grid: GridState, includeCasing: boolean): ImageExportBounds {
  const [dx, dy, dz] = grid.dims;
  let x1 = dx - 1;
  let y1 = dy - 1;
  let z1 = dz - 1;
  let x2 = 0;
  let y2 = 0;
  let z2 = 0;
  let found = false;
  for (let x = 0; x < dx; x++) {
    for (let y = 0; y < dy; y++) {
      for (let z = 0; z < dz; z++) {
        if ((grid.blocks[x]?.[y]?.[z] ?? AIR) === AIR) continue;
        found = true;
        if (x < x1) x1 = x;
        if (y < y1) y1 = y;
        if (z < z1) z1 = z;
        if (x > x2) x2 = x;
        if (y > y2) y2 = y;
        if (z > z2) z2 = z;
      }
    }
  }
  if (!found) return { x1: 0, y1: 0, z1: 0, x2: dx - 1, y2: dy - 1, z2: dz - 1 };
  if (includeCasing) return { x1: 0, y1: 0, z1: 0, x2: dx - 1, y2: dy - 1, z2: dz - 1 };
  return { x1, y1, z1, x2, y2, z2 };
}

/**
 * `PNGWriter.write`'s geometry (`:36-90` + the `:130-156` draw loop), with the
 * font metric injected so the arithmetic stays testable.
 *
 * @param measureText Java's `renderer.getStringWidth(text, textHeight)`.
 */
export function planImageExport(
  input: ImageExportInput,
  measureText: (text: string, textHeight: number) => number,
): ImageExportPlan {
  const blockSize = DEFAULT_BLOCK_SIZE;
  const borderSize = DEFAULT_BORDER_SIZE;
  const textHeight = (DEFAULT_TEXT_HEIGHT * blockSize) / 16;
  const bbox = input.bounds;
  const width3 = bbox.x2 - bbox.x1 + 1;
  const height3 = bbox.y2 - bbox.y1 + 1;
  const depth3 = bbox.z2 - bbox.z1 + 1;

  const parts = input.includeCasingParts
    ? input.parts
    : input.parts.filter((part) => !isCasingPart(part.name));

  const totalTextHeight = Math.max(textHeight * input.headerLines.length, textHeight * parts.length);

  let textWidth = 0;
  for (const line of input.headerLines) textWidth = Math.max(textWidth, measureText(line, textHeight));
  let partsWidth = 0;
  for (const part of parts) {
    partsWidth = Math.max(partsWidth, textHeight + measureText(part.label, textHeight));
  }

  const tW = textWidth + borderSize;
  const pW = partsWidth + borderSize;
  let width = Math.max(
    textWidth + partsWidth + (input.view3D ? totalTextHeight : 0),
    width3 * blockSize + borderSize,
  );
  const layerWidth = width3 * blockSize + borderSize;
  const layerHeight = depth3 * blockSize + borderSize;
  let multisPerRow = Math.max(1, Math.floor(width / layerWidth));
  let rowCount = Math.ceil(height3 / multisPerRow);
  let height = totalTextHeight + rowCount * layerHeight + borderSize / 2;
  // `:85-90` — note the loop recomputes `height` *without* the `borderSize/2`.
  while (rowCount > 1 && height > width) {
    width++;
    multisPerRow = Math.max(1, Math.floor(width / layerWidth));
    rowCount = Math.ceil(height3 / multisPerRow);
    height = totalTextHeight + rowCount * layerHeight;
  }

  const header = input.headerLines.map((text, i) => ({
    text,
    x: borderSize / 2,
    y: i * textHeight + borderSize / 2,
  }));

  const partRows = parts.map((part, i) => {
    const rowY = i * textHeight + borderSize / 2;
    // `:103-104`: with the 3D view the parts sit right of the header, otherwise
    // they are right-aligned to the image edge.
    const textX = input.view3D ? tW + textHeight + borderSize / 2 : width - pW + textHeight + borderSize / 2;
    const swatchX = input.view3D ? tW : width - pW;
    return {
      text: part.label,
      name: part.name,
      color: part.color,
      count: part.count,
      x: textX,
      y: rowY,
      swatchX,
    };
  });

  const cells: {
    x: number;
    y: number;
    z: number;
    px: number;
    py: number;
    interior: boolean;
    block: number;
    recipe: number;
  }[] = [];
  for (let layer = 0; layer < height3; layer++) {
    const column = layer % multisPerRow;
    const row = Math.floor(layer / multisPerRow);
    for (let x = 0; x < width3; x++) {
      for (let z = 0; z < depth3; z++) {
        const gx = x + bbox.x1;
        const gy = layer + bbox.y1;
        const gz = z + bbox.z1;
        const block = input.grid.blocks[gx]?.[gy]?.[gz] ?? AIR;
        const interior = gx > 0 && gy > 0 && gz > 0 && gx < input.dims[0] - 1 && gy < input.dims[1] - 1 && gz < input.dims[2] - 1;
        if (!input.includeCasing && !interior && block === AIR) continue;
        cells.push({
          x: gx,
          y: gy,
          z: gz,
          px: column * layerWidth + borderSize / 2 + x * blockSize,
          py: row * layerHeight + borderSize + z * blockSize + totalTextHeight,
          interior,
          block,
          recipe: input.grid.recipes[gx]?.[gy]?.[gz] ?? AIR,
        });
      }
    }
  }

  return {
    width,
    height,
    blockSize,
    textHeight,
    borderSize,
    totalTextHeight,
    headerWidth: tW,
    partsWidth: pW,
    multisPerRow,
    rowCount,
    header,
    parts: partRows,
    cells,
    inset: input.view3D
      ? { x: width - totalTextHeight / 2, y: totalTextHeight / 2, size: totalTextHeight }
      : null,
  };
}
