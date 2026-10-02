import { makeElement, type NCPFElement, type RawElement } from '@ncplanner/ncpf';
import { DESIGN_SCALAR_REFERENCES } from './configSpecs.js';
import { isJsonObject, jsonArray, type JsonObject, type JsonValue } from './json.js';
import { javaDefinitionToString, javaElementType } from './javaModel.js';

/**
 * Design (multiblock) element references.
 *
 * On the wire a design stores element references as **integers**: an index into
 * one of its configuration's element lists, or `-1` for "nothing". Java resolves
 * them with `NCPFObject.indexof` → `NCPFElementDefinition.matches`, and that is
 * exactly the path R0 finding #9 proved broken (`NCPFSettingsElement.matches()`
 * is not reflexive for `legacy_recipe` elements, so Overhaul SFR designs were
 * written with `coolant_recipe: -1` and the file cannot be read back — see
 * `docs/r0/findings.md` §8 and `docs/r0/format-roundtrip.md`).
 *
 * The TS layer therefore stores the reference *by element identity*
 * (`javaDefinitionToString`) and converts back to an index only when writing
 * (R1.4d: "TS writes element identity directly instead of the broken
 * 'index + structural equality' matches() path").
 *
 * The recipe grid is stored compressed on the wire; `resolveRecipeGrid` /
 * `emitRecipeGrid` mirror `NCPFObject.getRecipe3DArray` / `setRecipe3DArray`.
 */

export const BLOCK_RECIPES_MODULE = 'ncpf:block_recipes';

/** A design's scalar element reference (`fuel`, `coolant_recipe`, `recipe`). */
export interface NcpfScalarReference {
  /** Raw JSON key of the reference, e.g. `coolant_recipe`. */
  readonly key: string;
  /** Configuration element list it points into, e.g. `coolant_recipes`. */
  readonly listName: string;
  /** Resolved element (`null` when the stored index was `-1`/absent/out of range). */
  element: NCPFElement | null;
}

export interface NcpfDesignGrid {
  /** `design` → index into the configuration's `blocks` list, resolved. */
  readonly blocks: (NCPFElement | null)[][][];
  /** `block_recipes` (compressed) → per-cell block recipe, resolved. */
  readonly recipes: (NCPFElement | null)[][][];
  /** Whether the raw design carried a `block_recipes` grid at all. */
  readonly hasRecipeGrid: boolean;
}

export interface NcpfDesignDocument {
  /** Position inside `project.designs`. */
  readonly index: number;
  readonly raw: JsonObject;
  /** Java `NCPFDesignDefinition.type` (== the configuration id it belongs to). */
  readonly type: string | null;
  readonly dimensions: readonly number[];
  /**
   * Resolved cuboidal grid, or `null` for design types this layer does not
   * model (unknown types, designs without a `design` grid). A `null` grid means
   * "preserve `raw` verbatim on write".
   */
  readonly grid: NcpfDesignGrid | null;
  /** Scalar element references (`fuel`, `coolant_recipe`, `recipe`). */
  readonly scalarReferences: ReadonlyMap<string, NcpfScalarReference>;
}

/** Identity used for element reference matching. */
export function elementIdentity(element: NCPFElement | JsonObject): string {
  return javaDefinitionToString('definition' in element ? (element.raw as unknown as JsonObject) : element);
}

export function elementView(raw: JsonObject): NCPFElement {
  return makeElement(raw as unknown as RawElement);
}

/** Per-config recipe lookup, so a design walk does not re-parse elements. */
export type RecipeLookup = (element: NCPFElement) => readonly NCPFElement[];

export function recipeLookup(): RecipeLookup {
  const cache = new WeakMap<NCPFElement, readonly NCPFElement[]>();
  return (element) => {
    let recipes = cache.get(element);
    if (recipes === undefined) {
      // `NCPFBlockRecipesModule` payload: `{recipes: [...]}`.
      const modules = element.raw.modules as unknown as JsonObject | undefined;
      const module = modules?.[BLOCK_RECIPES_MODULE];
      recipes = isJsonObject(module)
        ? jsonArray(module.recipes).filter(isJsonObject).map((recipe) => elementView(recipe))
        : [];
      cache.set(element, recipes);
    }
    return recipes;
  };
}

function is3dGrid(value: JsonValue | undefined): value is JsonValue[][][] {
  return (
    Array.isArray(value) &&
    value.every((plane) => Array.isArray(plane) && plane.every((row) => Array.isArray(row)))
  );
}

function emptyGrid<T>(dimensions: readonly number[]): T[][][] {
  const [x = 0, y = 0, z = 0] = dimensions;
  return Array.from({ length: x }, () => Array.from({ length: y }, () => Array.from({ length: z }, () => null as T)));
}

function gridDimensions(grid: JsonValue[][][]): [number, number, number] {
  return [grid.length, grid[0]?.length ?? 0, grid[0]?.[0]?.length ?? 0];
}

export interface DesignResolutionContext {
  /**
   * The configuration's `blocks` list, or `undefined` when the project has no
   * configuration with that id (an unknown design type → raw is preserved).
   */
  readonly blocksFor: (configId: string | null) => readonly NCPFElement[] | undefined;
  readonly elementAt: (configId: string | null, listName: string, index: number) => NCPFElement | null;
  readonly recipes: RecipeLookup;
}

/**
 * Java `NCPFObject.getRecipe3DArray`: the wire format stores recipes in a
 * *compacted* 3D array that only contains cells whose block has an
 * `ncpf:block_recipes` module, indexed by the ordinal of the x-slice / y-row /
 * z-cell among such cells.
 */
export function resolveRecipeGrid(
  blocks: (NCPFElement | null)[][][],
  raw: JsonValue,
  dimensions: readonly number[],
  recipes: RecipeLookup,
): (NCPFElement | null)[][][] {
  const out = emptyGrid<NCPFElement | null>(dimensions);
  if (!is3dGrid(raw)) return out;
  let slice = -1;
  let lastX = -1;
  for (let x = 0; x < blocks.length; x++) {
    let row = -1;
    let lastY = -1;
    for (let y = 0; y < (blocks[x]?.length ?? 0); y++) {
      let cell = -1;
      let lastZ = -1;
      for (let z = 0; z < (blocks[x][y]?.length ?? 0); z++) {
        const block = blocks[x][y][z];
        if (block === null || block.modules[BLOCK_RECIPES_MODULE] === undefined) continue;
        if (x !== lastX) {
          lastX = x;
          slice++;
        }
        if (y !== lastY) {
          lastY = y;
          row++;
        }
        if (z !== lastZ) {
          lastZ = z;
          cell++;
        }
        const index = raw[slice]?.[row]?.[cell];
        if (typeof index === 'number' && index > -1) {
          out[x][y][z] = recipes(block)[index] ?? null;
        }
      }
    }
  }
  return out;
}

/** Resolve one design from its raw JSON (`null` grid when we cannot model it). */
export function resolveDesign(index: number, raw: JsonObject, context: DesignResolutionContext): NcpfDesignDocument {
  const type = typeof raw.type === 'string' ? raw.type : null;
  const dimensions = jsonArray(raw.dimensions).filter((value): value is number => typeof value === 'number');

  const scalarReferences = new Map<string, NcpfScalarReference>();
  for (const [key, listName] of Object.entries(DESIGN_SCALAR_REFERENCES)) {
    if (!(key in raw)) continue;
    const stored = typeof raw[key] === 'number' ? (raw[key] as number) : -1;
    scalarReferences.set(key, { key, listName, element: context.elementAt(type, listName, stored) });
  }

  let grid: NcpfDesignGrid | null = null;
  const blocksList = context.blocksFor(type);
  if (is3dGrid(raw.design) && blocksList !== undefined) {
    const [dx, dy, dz] = gridDimensions(raw.design);
    const resolvedDimensions = dimensions.length === 3 ? dimensions : [dx, dy, dz];
    const blocks = emptyGrid<NCPFElement | null>(resolvedDimensions);
    for (let x = 0; x < Math.min(dx, blocks.length); x++) {
      for (let y = 0; y < Math.min(dy, blocks[x].length); y++) {
        for (let z = 0; z < Math.min(dz, blocks[x][y].length); z++) {
          const value = raw.design[x][y][z];
          blocks[x][y][z] = typeof value === 'number' ? context.elementAt(type, 'blocks', value) : null;
        }
      }
    }
    const hasRecipeGrid = Array.isArray(raw.block_recipes);
    grid = {
      blocks,
      recipes: hasRecipeGrid
        ? resolveRecipeGrid(blocks, raw.block_recipes as JsonValue, resolvedDimensions, context.recipes)
        : emptyGrid<NCPFElement>(resolvedDimensions),
      hasRecipeGrid,
    };
  }

  return { index, raw, type, dimensions, grid, scalarReferences };
}

/**
 * Java `NCPFObject.setDefined3DArray`: element → index into the (possibly
 * filtered) list, `-1` for `null` or a missing element.
 */
export function emitBlockGrid(
  blocks: readonly (NCPFElement | null)[][][],
  list: readonly NCPFElement[],
): number[][][] {
  const lookup = identityIndex(list);
  return blocks.map((plane) =>
    plane.map((row) => row.map((element) => (element === null ? -1 : lookup(elementIdentity(element))))),
  );
}

/**
 * Java `NCPFObject.setRecipe3DArray`: rebuild the compacted grid. The recipe
 * index is looked up inside the *block's* recipe list, exactly like Java's
 * `indexof(array[x][y][z], design[x][y][z].getModule(NCPFBlockRecipesModule).recipes)`.
 */
export function emitRecipeGrid(
  blocks: readonly (NCPFElement | null)[][][],
  recipes: readonly (NCPFElement | null)[][][],
  resolveRecipesFor: (element: NCPFElement) => readonly NCPFElement[],
): number[][][] {
  const slices: number[][][] = [];
  // One identity→index map per block *definition* (many cells share a block).
  const lookups = new Map<string, (identity: string) => number>();
  const indexOfRecipe = (block: NCPFElement, recipe: NCPFElement): number => {
    const key = elementIdentity(block);
    let lookup = lookups.get(key);
    if (lookup === undefined) {
      lookup = identityIndex(resolveRecipesFor(block));
      lookups.set(key, lookup);
    }
    return lookup(elementIdentity(recipe));
  };
  for (let x = 0; x < blocks.length; x++) {
    const rows: number[][] = [];
    for (let y = 0; y < (blocks[x]?.length ?? 0); y++) {
      const cells: number[] = [];
      for (let z = 0; z < (blocks[x][y]?.length ?? 0); z++) {
        const block = blocks[x][y][z];
        if (block === null || block.modules[BLOCK_RECIPES_MODULE] === undefined) continue;
        const recipe = recipes[x]?.[y]?.[z] ?? null;
        cells.push(recipe === null ? -1 : indexOfRecipe(block, recipe));
      }
      if (cells.length > 0) rows.push(cells);
    }
    if (rows.length > 0) slices.push(rows);
  }
  return slices;
}

/** Identity → index map for a list (first match wins, like Java's linear scan). */
export function identityIndex(list: readonly NCPFElement[]): (identity: string) => number {
  const map = new Map<string, number>();
  list.forEach((element, index) => {
    const identity = elementIdentity(element);
    if (!map.has(identity)) map.set(identity, index);
  });
  return (identity) => map.get(identity) ?? -1;
}

/**
 * Element identities a design references. This is the TS equivalent of Java's
 * `Design.getElements()`, which `makePartial` uses to decide what to keep.
 */
export function designUsedIdentities(design: NcpfDesignDocument): Set<string> {
  const used = new Set<string>();
  if (design.grid !== null) {
    for (const plane of design.grid.blocks) {
      for (const row of plane) {
        for (const element of row) if (element !== null) used.add(elementIdentity(element));
      }
    }
    for (const plane of design.grid.recipes) {
      for (const row of plane) {
        for (const element of row) if (element !== null) used.add(elementIdentity(element));
      }
    }
  }
  for (const reference of design.scalarReferences.values()) {
    if (reference.element !== null) used.add(elementIdentity(reference.element));
  }
  return used;
}

/** True when `raw` is the JSON object a design's `recipe_ports` module points at. */
export function portsReference(module: JsonObject | undefined, raw: JsonObject): boolean {
  if (module === undefined) return false;
  for (const key of ['input', 'output'] as const) {
    const reference = module[key];
    if (!isJsonObject(reference)) continue;
    if (
      javaElementType(reference) === javaElementType(raw) &&
      javaDefinitionToString(reference) === javaDefinitionToString(raw)
    ) {
      return true;
    }
  }
  return false;
}
