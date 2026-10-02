import { createHash } from 'node:crypto';
import { configurationSpec, type ConfigurationSpec } from './configSpecs.js';
import { BLOCK_RECIPES_MODULE, portsReference } from './designs.js';
import { isJsonObject, jsonArray, type JsonObject } from './json.js';
import { javaDefinitionToString, javaElementDisplayName, javaElementType } from './javaModel.js';
import type { NcpfProjectDocument } from './project.js';

/**
 * The R0 structural fingerprint — an exact port of
 * `tools/golden/src/net/ncplanner/plannerator/tools/RoundTrip.java:411-447`
 * (`signature(Project)`), which produced the 38/38 baseline in
 * `docs/r0/format-roundtrip.md`.
 *
 * Algorithm (verbatim from Java):
 *
 * ```
 * for each main configuration (cfg):
 *     line  "cfg|" + cfg.getName()                      // NOT the JSON key
 *     for each list in cfg.getAllElementsISaidAllElements():
 *         for each element e:
 *             line "el|" + cfg.getName() + "|" + e.definition.type + "|" +
 *                  e.definition.toString() + "|" + e.getDisplayName()
 * for each addon a:
 *     line  "addon|" + a.getName()
 *     for each configuration cfg of the addon:
 *         for each element e of that expansion:
 *             line "ael|" + a.getName() + "|" + cfg.getName() + "|" + <same as el>
 * sort(lines); sha256(join(lines, "\n") + "\n")[0..12) hex + "#" + lines.length
 * ```
 *
 * Three details are easy to get wrong and are reproduced here exactly:
 *
 *  1. **Addon configurations emit no `cfg|` line** — Java emits only `addon|`
 *     plus `ael|` lines (there is no `cfg|` write inside the addon loop). That is
 *     why `alloy_heat_sinks.ncpf.json` has 988 lines for 983 elements with 4 main
 *     configurations and 1 addon: 983 + 4 + 1.
 *  2. **`getAllElementsISaidAllElements()` is not "the declared lists"**
 *     (`NCPFConfiguration.java:70-87`): it appends, for every element of the
 *     declared lists, that element's *first* block recipe list
 *     (`BlockRecipesElement.getBlockRecipes()`), and finally the
 *     `plannerator:global_elements` list when that module exists and is
 *     non-empty. `getBlockRecipes()` returns the first declared recipe field
 *     (never `null`), and that field is only populated when its containing
 *     module is present — hence `blockRecipeGate` in `configSpecs.ts`.
 *  3. **Toggled ports share their parent's recipe list by reference**
 *     (`RecipePortsModule.setLocalReferences` sets `parent`,
 *     `DefinedPlanneratorRecipe.setReferences` then copies
 *     `get.apply(parent)`), hence `recipePortsModule` + `portsReference`.
 */
export function fingerprint(project: NcpfProjectDocument): string {
  const lines = fingerprintLines(project).sort();
  const digest = createHash('sha256')
    .update(lines.map((line) => `${line}\n`).join(''), 'utf8')
    .digest('hex');
  return `${digest.slice(0, 24)}#${lines.length}`;
}

/** Identity half of a fingerprint line — Java `RoundTrip.safe(e)`. */
export function elementFingerprintText(raw: JsonObject): string {
  const type = javaElementType(raw);
  return `${type === null ? 'null' : type}|${javaDefinitionToString(raw)}|${javaElementDisplayName(raw)}`;
}

/** All fingerprint lines (unsorted), exposed for diagnostics/tests. */
export function fingerprintLines(project: NcpfProjectDocument): string[] {
  const lines: string[] = [];
  const rawConfigurations = isJsonObject(project.raw.configuration) ? project.raw.configuration : {};
  for (const [id, configuration] of Object.entries(rawConfigurations)) {
    if (!isJsonObject(configuration)) continue;
    const spec = configurationSpec(id);
    lines.push(`cfg|${spec.name}`);
    lines.push(...elementLines('el', spec.name, javaExpandedElements(configuration, spec)));
  }
  for (const addon of project.addons) {
    // Java renders a `null` addon name as the literal string "null".
    const addonName = addon.javaName === null ? 'null' : addon.javaName;
    lines.push(`addon|${addonName}`);
    const addonConfigurations = isJsonObject(addon.raw.configuration) ? addon.raw.configuration : {};
    for (const [id, configuration] of Object.entries(addonConfigurations)) {
      if (!isJsonObject(configuration)) continue;
      const spec = configurationSpec(id);
      lines.push(...elementLines(`ael|${addonName}`, spec.name, javaExpandedElements(configuration, spec)));
    }
  }
  return lines;
}

function elementLines(prefix: string, cfgName: string, elements: readonly JsonObject[]): string[] {
  return elements.map((element) => `${prefix}|${cfgName}|${elementFingerprintText(element)}`);
}

/**
 * Java `getAllElementsISaidAllElements()` for one configuration, in Java's
 * order (the fingerprint sorts, so the order is cosmetic only).
 */
export function javaExpandedElements(configuration: JsonObject, spec: ConfigurationSpec): JsonObject[] {
  const declared: JsonObject[][] = [];
  for (const listName of spec.elementLists) {
    const list = configuration[listName];
    if (Array.isArray(list)) declared.push(list.filter(isJsonObject));
  }
  const out: JsonObject[] = [];
  for (const list of declared) out.push(...list);

  if (spec.blockRecipeGate !== null && spec.elementLists.includes('blocks')) {
    const pool = declared.flat();
    for (const list of declared) {
      for (const element of list) out.push(...blockRecipeElements(spec, element, pool));
    }
  }

  const modules = isJsonObject(configuration.modules) ? configuration.modules : undefined;
  const global = modules?.['plannerator:global_elements'];
  const globals = isJsonObject(global) ? global.elements : undefined;
  // Java enumerates global elements only when `GlobalElementsModule.exists()`,
  // i.e. when the list is non-empty (an empty module is dropped while reading).
  if (Array.isArray(globals) && globals.length > 0) out.push(...globals.filter(isJsonObject));
  return out;
}

/**
 * Java `BlockRecipesElement.getBlockRecipes()`: the first declared recipe list
 * of the element's class. It is non-empty only when the gate module is present,
 * and a *port* shares the list of the block that declares it as its
 * `recipe_ports` input/output (`parent`).
 */
function blockRecipeElements(
  spec: ConfigurationSpec,
  element: JsonObject,
  pool: readonly JsonObject[],
  seen: Set<JsonObject> = new Set(),
): JsonObject[] {
  if (seen.has(element)) return [];
  seen.add(element);
  const gate = spec.blockRecipeGate;
  if (gate === null) return [];
  const modules = isJsonObject(element.modules) ? element.modules : undefined;
  if (modules?.[gate] !== undefined) {
    const module = modules[BLOCK_RECIPES_MODULE];
    return isJsonObject(module) ? jsonArray(module.recipes).filter(isJsonObject) : [];
  }
  const portsModule = spec.recipePortsModule;
  if (portsModule === null) return [];
  for (const other of pool) {
    if (other === element) continue;
    const otherModules = isJsonObject(other.modules) ? other.modules : undefined;
    const ports = otherModules?.[portsModule];
    if (!isJsonObject(ports)) continue;
    if (portsReference(ports, element)) return blockRecipeElements(spec, other, pool, seen);
  }
  return [];
}
