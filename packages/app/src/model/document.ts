/**
 * R3.3 / R3.4 — the document model: what a loaded project, a configuration
 * palette and an edited design look like to the UI.
 *
 * The document is the R1.4 layer's `NcpfProjectDocument` (the parsed JSON tree)
 * plus **views**: a palette per configuration, the design list, and the
 * conversion between a design's resolved grid and the editor's index grid
 * (`model/grid.ts`).
 *
 * Two invariants:
 *
 *  1. indices are positions in the configuration's `blocks` list — the same
 *     numbers a design stores on the wire, so nothing has to be translated;
 *  2. an edit writes **elements** back into `design.grid` (which
 *     `writeNcpfSave` emits) and `dimensions` back into `design.raw` (which
 *     `emitDesign` copies verbatim). Both must be kept in sync or a resize is
 *     silently lost on save.
 */

import {
  configurationSpec,
  designUsedIdentities,
  elementIdentity,
  identityIndex,
  isJsonObject,
  javaDefinitionName,
  parseNcpfProject,
  readNcpfProject,
  writeNcpfExport,
  writeNcpfSave,
  type ConfigurationSpec,
  type JsonObject,
  type NcpfConfigurationDocument,
  type NcpfDesignDocument,
  type NcpfProjectDocument,
} from '@ncplanner/formats';
import type { NCPFElement } from '@ncplanner/ncpf';
import { buildSfrConfig, buildUsfrConfig } from '@ncplanner/kernel';
import { dataNameKey } from '@ncplanner/i18n';
import { AIR, createGrid, type Dims, type GridState } from './grid.js';

export interface PaletteRecipe {
  /** Index inside the block's own `ncpf:block_recipes` list. */
  readonly index: number;
  readonly identity: string;
  /** Java `getName()` of the recipe definition. */
  readonly name: string;
}

export interface PaletteEntry {
  /** Index in the configuration's `blocks` list (the value stored in a design). */
  readonly index: number;
  readonly identity: string;
  readonly name: string;
  /** English canonical display name (never localized; the UI localizes separately). */
  readonly canonicalName: string;
  readonly recipes: readonly PaletteRecipe[];
  /** Stable identity key for the four-segment data-name lookup. */
  readonly dataNameKey: string;
}

export interface ConfigurationView {
  readonly id: string;
  /**
   * Java `Configuration.getName()` for the *project* — the first segment of the
   * four-segment data-name key and, measured, `NuclearCraft` for the shipped
   * configuration (`planner/ncpf/Configuration.java:57-70`).
   */
  readonly projectName: string;
  readonly javaName: string;
  readonly spec: ConfigurationSpec;
  readonly document: NcpfConfigurationDocument;
  readonly palette: readonly PaletteEntry[];
}

/**
 * Java `Configuration.getName()` (`planner/ncpf/Configuration.java:57-70`): the
 * `plannerator:configuration_metadata` name of the first configuration that has
 * one. Every configuration in one file carries the same project name, so the
 * iteration order only matters for a hand-made file.
 */
export function projectConfigurationName(project: NcpfProjectDocument): string {
  const configurations = isJsonObject(project.raw.configuration) ? project.raw.configuration : {};
  for (const value of Object.values(configurations)) {
    if (!isJsonObject(value)) continue;
    const modules = value['modules'];
    const { name } = configurationMetadata(isJsonObject(modules) ? modules : undefined);
    if (name !== null) return name;
  }
  return 'Unknown Configuration';
}

/** `plannerator:configuration_metadata` — Java `ConfigurationMetadataModule`. */
export function configurationMetadata(
  modules: JsonObject | undefined,
): { name: string | null; version: string } {
  const metadata = modules?.['plannerator:configuration_metadata'] as
    | { name?: unknown; version?: unknown }
    | undefined;
  return {
    name: typeof metadata?.name === 'string' ? metadata.name : null,
    version: typeof metadata?.version === 'string' ? metadata.version : '',
  };
}

/**
 * The four-segment data-name key of an element in a view.
 *
 * Delegates to `@ncplanner/i18n`'s `dataNameKey` (which is
 * `@ncplanner/ncpf`'s `elementIdentityKey`) rather than re-building the string:
 * `type|definition` alone collides on 29 keys (R0 finding #4), and a second
 * implementation of the format would silently stop joining the packs.
 */
export function viewDataNameKey(view: ConfigurationView, element: NCPFElement): string {
  return dataNameKey(view.projectName, view.spec.name, element);
}

export interface DesignView {
  readonly index: number;
  readonly type: string | null;
  readonly dimensions: readonly number[];
  /** True when this layer can model the grid (unknown types cannot be edited). */
  readonly editable: boolean;
  readonly blocks: number;
}

/** Recipes of a block, from its own `ncpf:block_recipes` module. */
function paletteRecipes(configuration: NcpfConfigurationDocument, element: NCPFElement): PaletteRecipe[] {
  return configuration.recipesOf(element).map((recipe, index) => ({
    index,
    identity: elementIdentity(recipe),
    name: javaDefinitionName(recipe.raw as unknown as JsonObject) ?? '',
  }));
}

function canonicalNameOf(element: NCPFElement): string {
  const display = element.modules?.['plannerator:display_name'] as { display_name?: unknown } | undefined;
  if (typeof display?.display_name === 'string') return display.display_name;
  return javaDefinitionName(element.raw as unknown as JsonObject) ?? '';
}

export function configurationView(
  document: NcpfProjectDocument,
  id: string,
): ConfigurationView | null {
  const configuration = document.getConfiguration(id);
  if (configuration === undefined) return null;
  const spec = configurationSpec(id);
  const projectName = projectConfigurationName(document);
  const view: ConfigurationView = {
    id,
    projectName,
    javaName: configuration.javaName,
    spec,
    document: configuration,
    palette: [],
  };
  const palette = configuration.list('blocks').map((element, index) => ({
    index,
    identity: elementIdentity(element),
    name: javaDefinitionName(element.raw as unknown as JsonObject) ?? '',
    canonicalName: canonicalNameOf(element),
    recipes: paletteRecipes(configuration, element),
    dataNameKey: viewDataNameKey(view, element),
  }));
  return { ...view, palette };
}

export class AppDocument {
  private document: NcpfProjectDocument;
  private readonly views = new Map<string, ConfigurationView>();
  /** Set by the editor when a design changes; drives the "unsaved" marker. */
  dirty = false;

  constructor(project: NcpfProjectDocument) {
    this.document = project;
  }

  get project(): NcpfProjectDocument {
    return this.document;
  }

  /**
   * Swap in a rebuilt document view. The resolved design/grid objects come from
   * `buildProjectDocument`, so anything that mutates the raw tree structurally
   * (adding a design) must go through here or the views go stale.
   */
  replaceProject(project: NcpfProjectDocument): void {
    this.document = project;
    this.views.clear();
  }

  /** Every configuration in the file, in file order. */
  configurationIds(): string[] {
    return this.project.configurations.map((configuration) => configuration.id);
  }

  /**
   * The kernel configuration for a reactor, built from **this** document.
   *
   * `model/simulate.ts` builds the same objects for the statistics panel; the generator
   * must use the one belonging to the open document, because iron law 1 says there is one
   * physics kernel and a configuration built from elsewhere would quietly be a second one.
   */
  kernelConfigFor(
    configId: string,
    kind: 'sfr' | 'usfr',
  ): import('@ncplanner/kernel').SfrConfig | import('@ncplanner/kernel').UsfrConfig {
    // `buildSfrConfig` takes the *parsed* NCPF configuration (`project.ncpf`), not the
    // document's view wrapper — the same call `model/simulate.ts` makes, so the
    // generator and the statistics panel share one configuration object.
    const configuration = this.project.ncpf.getConfiguration(configId);
    if (configuration === undefined) {
      throw new Error('the document has no configuration ' + configId);
    }
    return kind === 'sfr' ? buildSfrConfig(configuration) : buildUsfrConfig(configuration);
  }

  view(id: string): ConfigurationView | null {
    if (!this.views.has(id)) {
      const view = configurationView(this.project, id);
      if (view === null) return null;
      this.views.set(id, view);
    }
    return this.views.get(id) ?? null;
  }

  designsOf(id: string): DesignView[] {
    const out: DesignView[] = [];
    for (const design of this.project.designs) {
      if (design.type !== id) continue;
      out.push({
        index: design.index,
        type: design.type,
        dimensions: design.dimensions,
        editable: design.grid !== null,
        blocks:
          design.grid === null
            ? 0
            : design.grid.blocks.flat().flat().filter((cell) => cell !== null).length,
      });
    }
    return out;
  }

  /** True when the file contains at least one design for this configuration. */
  hasDesigns(id: string): boolean {
    return this.project.designs.some((design) => design.type === id);
  }

  design(index: number): NcpfDesignDocument | undefined {
    return this.project.designs[index];
  }

  /**
   * Options for the design's scalar references (fuel / coolant recipe / recipe),
   * so `MenuElementConfiguration`-style selectors can be rendered (R3.4).
   */
  scalarOptions(id: string): { key: string; listName: string; elements: readonly NCPFElement[] }[] {
    const configuration = this.project.getConfiguration(id);
    if (configuration === undefined) return [];
    const out: { key: string; listName: string; elements: readonly NCPFElement[] }[] = [];
    for (const design of this.project.designs) {
      if (design.type !== id) continue;
      for (const reference of design.scalarReferences.values()) {
        if (out.some((entry) => entry.key === reference.key)) continue;
        out.push({
          key: reference.key,
          listName: reference.listName,
          elements: configuration.list(reference.listName),
        });
      }
    }
    return out;
  }

  // -------------------------------------------------------------- grid bridge

  /**
   * Convert a design's resolved grid into editor indices. Returns `null` for
   * designs this layer cannot model (unknown type / no grid field) — the caller
   * must offer "convert to an editable design" instead of guessing.
   */
  gridOf(designIndex: number, id: string): GridState | null {
    const view = this.view(id);
    const design = this.project.designs[designIndex];
    if (view === null || design === undefined || design.grid === null) return null;
    const blockIndex = identityIndex(view.document.list('blocks'));
    const recipeIndices = new Map<string, (identity: string) => number>();
    const recipeIndexFor = (block: NCPFElement, recipe: NCPFElement | null): number => {
      if (recipe === null) return AIR;
      const key = elementIdentity(block);
      let lookup = recipeIndices.get(key);
      if (lookup === undefined) {
        lookup = identityIndex(view.document.recipesOf(block));
        recipeIndices.set(key, lookup);
      }
      return lookup(elementIdentity(recipe));
    };

    const dims = gridDims(design);
    const grid = createGrid(dims);
    for (let x = 0; x < dims[0]; x++) {
      for (let y = 0; y < dims[1]; y++) {
        for (let z = 0; z < dims[2]; z++) {
          const block = design.grid.blocks[x]?.[y]?.[z] ?? null;
          if (block === null) continue;
          grid.blocks[x]![y]![z] = blockIndex(elementIdentity(block));
          grid.recipes[x]![y]![z] = recipeIndexFor(block, design.grid.recipes[x]?.[y]?.[z] ?? null);
        }
      }
    }
    for (const reference of design.scalarReferences.values()) {
      if (reference.element === null) {
        grid.scalars[reference.key] = AIR;
        continue;
      }
      const index = view.document.identityIndexOf(reference.listName, elementIdentity(reference.element));
      grid.scalars[reference.key] = index < 0 ? AIR : index;
    }
    return grid;
  }

  /**
   * Write an edited grid back into a design. `dimensions` is updated in `raw`
   * because that is the field `emitDesign` preserves verbatim.
   */
  applyGrid(designIndex: number, id: string, grid: GridState): void {
    const view = this.view(id);
    const design = this.project.designs[designIndex];
    if (view === null || design === undefined || design.grid === null) return;
    const blocks = view.document.list('blocks');
    const elementAt = (index: number): NCPFElement | null => (index === AIR ? null : (blocks[index] ?? null));
    const recipesCache = new Map<number, readonly NCPFElement[]>();
    const recipesOf = (index: number): readonly NCPFElement[] => {
      let recipes = recipesCache.get(index);
      if (recipes === undefined) {
        const element = blocks[index];
        recipes = element === undefined ? [] : view.document.recipesOf(element);
        recipesCache.set(index, recipes);
      }
      return recipes;
    };

    const [dx, dy, dz] = grid.dims;
    const blocksGrid: (NCPFElement | null)[][][] = [];
    const recipesGrid: (NCPFElement | null)[][][] = [];
    for (let x = 0; x < dx; x++) {
      const planeB: (NCPFElement | null)[][] = [];
      const planeR: (NCPFElement | null)[][] = [];
      for (let y = 0; y < dy; y++) {
        const rowB: (NCPFElement | null)[] = [];
        const rowR: (NCPFElement | null)[] = [];
        for (let z = 0; z < dz; z++) {
          const index = grid.blocks[x]?.[y]?.[z] ?? AIR;
          const element = elementAt(index);
          rowB.push(element);
          const recipeIndex = grid.recipes[x]?.[y]?.[z] ?? AIR;
          rowR.push(
            element === null || recipeIndex === AIR ? null : (recipesOf(index)[recipeIndex] ?? null),
          );
        }
        planeB.push(rowB);
        planeR.push(rowR);
      }
      blocksGrid.push(planeB);
      recipesGrid.push(planeR);
    }

    // `NcpfDesignGrid` fields are readonly by design; replacing the object is
    // the documented way to mutate a resolved design (`formats/src/designs.ts`).
    (design as { grid: NcpfDesignDocument['grid'] }).grid = {
      blocks: blocksGrid,
      recipes: recipesGrid,
      hasRecipeGrid: design.grid.hasRecipeGrid,
    };
    design.raw.dimensions = [dx, dy, dz];
    for (const reference of design.scalarReferences.values()) {
      const index = grid.scalars[reference.key] ?? AIR;
      const element = reference.listName === undefined ? null : elementAt2(view, reference.listName, index);
      (reference as { element: NCPFElement | null }).element = element;
      design.raw[reference.key] = index;
    }
    this.dirty = true;
  }

  /** Element identities a design currently uses (for the export path). */
  usedIdentities(designIndex: number): Set<string> {
    const design = this.project.designs[designIndex];
    return design === undefined ? new Set() : designUsedIdentities(design);
  }

  // ------------------------------------------------------------------- output

  /** `NCPFFileWriter` semantics — what "save" writes (iron law 5). */
  saveText(): string {
    return JSON.stringify(writeNcpfSave(this.project));
  }

  /** `NCPFWriter` semantics — what "export" writes (trimmed, portable). */
  exportText(designIndex?: number): string {
    return JSON.stringify(writeNcpfExport(this.project, designIndex === undefined ? undefined : [designIndex]));
  }

  /** Designs that are visible for a configuration (for menus/dialogs). */
  designNames(id: string): string[] {
    return this.designsOf(id).map((design, position) => designName(design, position));
  }

  get issues(): readonly string[] {
    return this.project.issues;
  }
}

function elementAt2(
  view: ConfigurationView,
  listName: string,
  index: number,
): NCPFElement | null {
  if (index === AIR) return null;
  return view.document.list(listName)[index] ?? null;
}

/** External dimensions of a design: `dimensions` when present, else the grid shape. */
export function gridDims(design: NcpfDesignDocument): Dims {
  const grid = design.grid;
  const fromGrid: Dims = grid === null
    ? [3, 3, 3]
    : [grid.blocks.length, grid.blocks[0]?.length ?? 0, grid.blocks[0]?.[0]?.length ?? 0];
  const stored = design.dimensions;
  if (stored.length === 3 && stored.every((value) => typeof value === 'number' && value >= 3)) {
    return [stored[0]!, stored[1]!, stored[2]!];
  }
  return fromGrid;
}

export function designName(design: DesignView, position: number): string {
  return `#${position + 1} (${design.dimensions.join('×')})`;
}

/** The scalar reference keys a design type uses (for a fresh design). */
export function scalarKeysFor(id: string): string[] {
  switch (id) {
    case 'nuclearcraft:underhaul_sfr':
      return ['fuel'];
    case 'nuclearcraft:overhaul_sfr':
    case 'nuclearcraft:overhaul_msr':
      return ['coolant_recipe', 'recipe'];
    case 'nuclearcraft:overhaul_turbine':
    case 'nuclearcraft:overhaul_distiller':
      return ['recipe'];
    default:
      return [];
  }
}

/**
 * Create a new, empty design for a configuration and append it to the project.
 * The shape follows a real save (`{type, dimensions, design, block_recipes,
 * modules}` plus the scalar references), so a file written before any edit is
 * still readable by the frozen Java version.
 */
export function createDesign(document: AppDocument, id: string, dims: Dims): number {
  const [dx, dy, dz] = dims;
  const raw: JsonObject = {
    type: id,
    dimensions: [dx, dy, dz],
    design: Array.from({ length: dx }, () =>
      Array.from({ length: dy }, () => new Array<number>(dz).fill(-1)),
    ),
    block_recipes: [],
    modules: { 'plannerator:metadata': {} },
  };
  for (const key of scalarKeysFor(id)) raw[key] = -1;
  const designs = document.project.raw.designs;
  if (!Array.isArray(designs)) document.project.raw.designs = [];
  const list = document.project.raw.designs as unknown as JsonObject[];
  list.push(raw);
  // Rebuild the document view so the new design is resolved like a loaded one.
  const rebuilt = parseNcpfProject(JSON.stringify(document.project.raw), document.project.container);
  document.replaceProject(rebuilt);
  return rebuilt.designs.length - 1;
}

/** `readNcpfProject` re-export so the UI has a single import for "open a file". */
export { readNcpfProject, parseNcpfProject };

/** True when the parsed tree looks like NCPF JSON (used for drop routing). */
export function looksLikeNcpf(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as unknown;
    return isJsonObject(parsed) && typeof parsed['version'] === 'number';
  } catch {
    return false;
  }
}

/**
 * Apply an edited design back to disk-shaped JSON in one call: used by the
 * "save" path so an unsaved edit is never written without its grid.
 */
export function withGridApplied(
  document: AppDocument,
  designIndex: number,
  id: string,
  grid: GridState,
): void {
  document.applyGrid(designIndex, id, grid);
}
