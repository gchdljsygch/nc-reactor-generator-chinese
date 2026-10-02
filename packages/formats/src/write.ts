import { writeFileSync } from 'node:fs';
import type { NCPFElement } from '@ncplanner/ncpf';
import { configurationSpec, type ConfigurationSpec } from './configSpecs.js';
import {
  BLOCK_RECIPES_MODULE,
  designUsedIdentities,
  elementIdentity,
  emitBlockGrid,
  emitRecipeGrid,
  type NcpfDesignDocument,
} from './designs.js';
import { deepCloneJson, isJsonObject, jsonArray, type JsonObject, type JsonValue } from './json.js';
import { javaDefinitionToString } from './javaModel.js';
import {
  buildConfigurationDocument,
  NcpfFormatError,
  type NcpfConfigurationDocument,
  type NcpfProjectDocument,
} from './project.js';

/**
 * The two NCPF writers (R0 finding #10 — they must never be mixed):
 *
 * | writer | Java | semantics |
 * |---|---|---|
 * | {@link writeNcpfSave} | `NCPFFileWriter` (`Core.java:611`) | **full fidelity**, nothing is trimmed |
 * | {@link writeNcpfExport} | `NCPFWriter` (`MenuMain:316-320`) | `makePartial()` + `trimPlanneratorModules()` |
 *
 * Both write the document tree (`NcpfProjectDocument.raw`) rather than a
 * re-derived object model, so unknown modules/fields survive a save. The only
 * values recomputed on the way out are the design element references, which are
 * re-indexed **from element identity** (`designs.ts`) instead of Java's
 * `indexof` → `NCPFElementDefinition.matches` path (R0 finding #9).
 */

/**
 * Re-emit one design. The raw design object is cloned and only the keys this
 * layer models are overwritten, so unknown design fields (`modules`, metadata,
 * extra grids) are preserved verbatim.
 *
 * `recipesFor` must return the recipe list of the block **in the configuration
 * that will actually be written**. That matters for the export path, where the
 * written configuration is a filtered copy of the document while the design
 * still refers to the original element objects: using `configuration.recipesOf`
 * on those stale objects would emit indices into the *unfiltered* recipe list
 * (found the hard way — the frozen Java reader rejected it with
 * `IndexOutOfBoundsException: Index 64 out of bounds for length 43`, see
 * `docs/r1/r1.4-ncpf-io.md`).
 */
export function emitDesign(
  design: NcpfDesignDocument,
  configuration: NcpfConfigurationDocument | undefined,
  recipesFor: (block: NCPFElement) => readonly NCPFElement[] = (block) =>
    configuration === undefined ? [] : configuration.recipesOf(block),
): JsonObject {
  const out = deepCloneJson(design.raw);
  if (design.grid === null || configuration === undefined) return out;
  out.design = emitBlockGrid(design.grid.blocks, configuration.list('blocks'));
  // Only designs whose NCPF definition has a `block_recipes` grid get one:
  // `NCPFOverhaulSFRDesign`/`NCPFOverhaulMSRDesign`/`NCPFUnderhaulSFRDesign` call
  // `setRecipe3DArray("block_recipes", …)`, while the turbine/distiller designs do
  // not (they only carry a single `recipe` index). Writing the key unconditionally
  // would invent a field the Java writer never produces.
  if (design.grid.hasRecipeGrid) {
    out.block_recipes = emitRecipeGrid(design.grid.blocks, design.grid.recipes, recipesFor);
  }
  for (const reference of design.scalarReferences.values()) {
    out[reference.key] =
      reference.element === null
        ? -1
        : configuration.identityIndexOf(reference.listName, elementIdentity(reference.element));
  }
  return out;
}

/**
 * `NCPFFileWriter` semantics: read → write must be lossless.
 *
 * Java (`NCPFFileWriter.write` → `project.convertToObject(ncpf)` →
 * `JSONNCPFWriter`) round trips through its object model, which drops fields no
 * module class knows about; the TS writer keeps the parsed tree verbatim and is
 * therefore a strict superset of the Java output for everything TS does not
 * model. The R0 acceptance criterion (identical fingerprint after write→read) is
 * satisfied by construction, and verified in `test/r1.4b-save.test.ts`.
 */
export function writeNcpfSave(project: NcpfProjectDocument): JsonObject {
  const out = deepCloneJson(project.raw);
  const designs = out.designs;
  if (Array.isArray(designs)) {
    out.designs = project.designs.map((design) =>
      emitDesign(design, design.type === null ? undefined : project.getConfiguration(design.type)),
    );
  }
  return out;
}

/** Save text (`JSON.stringify`, i.e. the compact form `JSONNCPFWriter` emits). */
export function saveNcpfText(project: NcpfProjectDocument): string {
  return JSON.stringify(writeNcpfSave(project));
}

export function writeNcpfSaveFile(project: NcpfProjectDocument, path: string): void {
  writeFileSync(path, saveNcpfText(project), 'utf8');
}

/** Which designs an export contains: indices into `project.designs`, or design types. */
export type NcpfDesignSelector = readonly (number | string)[] | undefined;

function selectDesigns(project: NcpfProjectDocument, designIds: NcpfDesignSelector): readonly NcpfDesignDocument[] {
  if (designIds === undefined) return project.designs;
  const wanted = new Set(designIds);
  return project.designs.filter(
    (design) => wanted.has(design.index) || (design.type !== null && wanted.has(design.type)),
  );
}

/**
 * `NCPFWriter` semantics (export one multiblock).
 *
 * Java (`NCPFWriter.write`, `FileWriter.NCPF`, `MenuMain:316-320`):
 * ```java
 * ncpf = ncpf.copyTo(Project::new);
 * ncpf.makePartial();                       // Project.makePartial(): drop unused configs/addons
 * NCPFObject obj = new NCPFObject();
 * ncpf.convertToObject(obj);
 * trimPlanneratorModules(obj);              // drop every non-`ncpf:` module
 * format.write(obj, stream);
 * ```
 *
 * `Project.makePartial()` (`Project.java:73-84`):
 *  - keeps only the configurations whose id equals some design's `definition.type`;
 *  - `conglomeration.makePartial(designs)` → `NCPFConfiguration.makePartial` →
 *    each declared element list is filtered by `Design.getElements()`, and every
 *    surviving block has its recipe list filtered the same way
 *    (`ElementListPlanneratorField.makePartial`, `DefinedNCPFObject.makePartial`);
 *  - `addons.clear()`.
 *
 * `trimPlanneratorModules` (`NCPFWriter.java:40-70`) — the exact key rule:
 *  - for **every** JSON object in the tree that has a `"modules"` object: remove
 *    every entry whose key does **not** start with `"ncpf:"` (`trimModules`),
 *    then delete `"modules"` entirely when nothing is left;
 *  - **kept**: `ncpf:*` modules (e.g. `ncpf:block_recipes`) — including empty
 *    `recipes` arrays, because `trimModules` only looks at the key prefix;
 *  - **stripped**: `plannerator:display_name`, `plannerator:texture`,
 *    `plannerator:legacy_names`, `plannerator:tags`,
 *    `plannerator:global_elements`, `plannerator:configuration_metadata`,
 *    `plannerator:metadata`, `minecraft:air`, and every reactor-type module
 *    (`nuclearcraft:*`, …) — i.e. all element/gameplay decoration.
 *
 * Known R1.4 limitation: Java exports `conglomeration` (main + addons merged by
 * `conglomerate()`), so elements contributed by an addon do appear in a Java
 * export. The TS writer drops addons like Java but does **not** merge their
 * elements into the main configurations (that merge is R2 scope,
 * see `docs/r1/r1.4-ncpf-io.md` "未达成").
 */
export function writeNcpfExport(project: NcpfProjectDocument, designIds?: NcpfDesignSelector): JsonObject {
  const selected = selectDesigns(project, designIds);
  const out = deepCloneJson(project.raw);

  // 1. Project.makePartial(): only the configurations the designs use survive.
  const keptConfigurationIds = new Set<string>();
  for (const design of selected) if (design.type !== null) keptConfigurationIds.add(design.type);
  const rawConfigurations = isJsonObject(out.configuration) ? out.configuration : {};
  for (const id of Object.keys(rawConfigurations)) {
    if (!keptConfigurationIds.has(id)) delete rawConfigurations[id];
  }

  // 2. NCPFConfiguration.makePartial(): filter element lists (and block recipes)
  //    by the identities the exported designs reference.
  const used = new Set<string>();
  for (const design of selected) for (const identity of designUsedIdentities(design)) used.add(identity);
  const filtered = new Map<string, NcpfConfigurationDocument>();
  /** Recipe resolver that goes through the *filtered* block, by identity. */
  const recipesByIdentity = new Map<string, (block: NCPFElement) => readonly NCPFElement[]>();
  for (const [id, rawConfiguration] of Object.entries(rawConfigurations)) {
    if (!isJsonObject(rawConfiguration)) continue;
    filterConfiguration(rawConfiguration, configurationSpec(id), used);
    const configuration = buildConfigurationDocument(id, project.container, rawConfiguration);
    filtered.set(id, configuration);
    const byIdentity = new Map<string, NCPFElement>();
    for (const block of configuration.list('blocks')) byIdentity.set(elementIdentity(block), block);
    recipesByIdentity.set(id, (block) => {
      const filteredBlock = byIdentity.get(elementIdentity(block));
      return filteredBlock === undefined ? [] : configuration.recipesOf(filteredBlock);
    });
  }

  // 3. Drop addons (Java `addons.clear()`), re-emit the selected designs against
  //    the filtered lists, then trim `plannerator:*`.
  out.addons = [];
  out.designs = selected.map((design) => {
    if (design.type === null) return emitDesign(design, undefined);
    const configuration = filtered.get(design.type);
    return emitDesign(design, configuration, recipesByIdentity.get(design.type));
  });
  trimPlanneratorModules(out);
  return out;
}

/** Export text (`JSON.stringify`, the compact form `JSONNCPFWriter` emits). */
export function exportNcpfText(project: NcpfProjectDocument, designIds?: NcpfDesignSelector): string {
  return JSON.stringify(writeNcpfExport(project, designIds));
}

export function writeNcpfExportFile(
  project: NcpfProjectDocument,
  path: string,
  designIds?: NcpfDesignSelector,
): void {
  writeFileSync(path, exportNcpfText(project, designIds), 'utf8');
}

/**
 * Java `NCPFWriter.trimPlanneratorModules`: recursive in-place trim of every
 * `modules` bag down to its `ncpf:*` keys.
 */
export function trimPlanneratorModules(node: JsonValue | object): void {
  if (Array.isArray(node)) {
    for (const value of node) {
      if (isJsonObject(value) || Array.isArray(value)) trimPlanneratorModules(value);
    }
    return;
  }
  if (!isJsonObject(node)) return;
  const modules = node.modules;
  if (isJsonObject(modules)) {
    for (const key of Object.keys(modules)) {
      if (!key.startsWith('ncpf:')) delete modules[key];
    }
    if (Object.keys(modules).length === 0) delete node.modules;
  }
  for (const value of Object.values(node)) {
    if (isJsonObject(value) || Array.isArray(value)) trimPlanneratorModules(value);
  }
}

/**
 * Java `DefinedNCPFObject.makePartial(elems, designs)` +
 * `ElementListPlanneratorField.makePartial`:
 *  - keep an element only when a design references its definition;
 *  - then filter each surviving block's `ncpf:block_recipes` recipes the same way.
 *
 * Java compares definitions with `matches()`; TS compares element identities
 * (R1.4d), which is strictly finer for the definition fields `matches()` ignores.
 */
function filterConfiguration(raw: JsonObject, spec: ConfigurationSpec, used: ReadonlySet<string>): void {
  for (const listName of spec.elementLists) {
    const list = raw[listName];
    if (!Array.isArray(list)) continue;
    raw[listName] = list.filter(
      (element) => isJsonObject(element) && used.has(javaDefinitionToString(element)),
    );
  }
  if (!spec.elementLists.includes('blocks')) return;
  const blocks = raw['blocks'];
  if (!Array.isArray(blocks)) return;
  for (const block of blocks) {
    if (!isJsonObject(block)) continue;
    const modules = isJsonObject(block.modules) ? block.modules : undefined;
    const module = modules?.[BLOCK_RECIPES_MODULE];
    if (!isJsonObject(module)) continue;
    module.recipes = jsonArray(module.recipes).filter(
      (recipe) => isJsonObject(recipe) && used.has(javaDefinitionToString(recipe)),
    );
  }
}

/** Guard against accidentally exporting with a selector that matches nothing. */
export function assertDesignSelection(project: NcpfProjectDocument, designIds: NcpfDesignSelector): void {
  if (designIds === undefined) return;
  if (selectDesigns(project, designIds).length === 0) {
    throw new NcpfFormatError('export selector matched no design in this project');
  }
}
