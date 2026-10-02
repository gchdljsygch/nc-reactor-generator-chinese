/**
 * R3.8 — statistics for the design being edited.
 *
 * The UI must not grow a second physics implementation (iron law 1), so this
 * module does exactly one thing: translate the editor's index grid into the
 * `GoldenRecord` shape the kernel's rebuilders already accept
 * (`kernel/src/dataset.ts`, `rebuildSfr` / `rebuildUsfr` / `rebuildMsr`), run the
 * single kernel, and hand the stats back.
 *
 * Two details matter and are both taken from the kernel rather than guessed:
 *
 *  - **recipe encoding**: a record's `recipeNames[i]` is `"<field>=<name>"`, with
 *    `<field>` ∈ {`fuel`, `irradiatorRecipe`, `heaterRecipe`} and `<name>` the
 *    kernel view's recipe name. The resolver matches on the *name*, which is why
 *    the app encodes names and not identities;
 *  - **position anchoring**: `size` is the external grid (casing included) and a
 *    cell's flat index is `x*dy*dz + y*dz + z`, exactly the numbering the golden
 *    datasets use.
 */

import {
  buildMsrConfig,
  buildSfrConfig,
  buildUsfrConfig,
  MSR_CONFIG_ID,
  rebuildMsr,
  rebuildSfr,
  rebuildUsfr,
  SFR_CONFIG_ID,
  USFR_CONFIG_ID,
  type GoldenRecord,
  type SfrConfig,
  type UsfrConfig,
} from '@ncplanner/kernel';
import {
  elementIdentity,
  javaDefinitionName,
  type JsonObject,
  type NcpfConfigurationDocument,
  type NcpfProjectDocument,
} from '@ncplanner/formats';
import type { NCPFElement } from '@ncplanner/ncpf';
import { AIR, type GridState } from './grid.js';

export type SupportedConfigId =
  | typeof SFR_CONFIG_ID
  | typeof USFR_CONFIG_ID
  | typeof MSR_CONFIG_ID;

export const SUPPORTED_CONFIGS: readonly string[] = [SFR_CONFIG_ID, USFR_CONFIG_ID, MSR_CONFIG_ID];

export function isSupported(configId: string): configId is SupportedConfigId {
  return SUPPORTED_CONFIGS.includes(configId);
}

export type SimulationResult =
  | {
      readonly kind: 'ok';
      readonly reactorType: string;
      readonly stats: Record<string, number>;
      /** Recipes/blocks the record could not resolve (must be empty in practice). */
      readonly warnings: readonly string[];
    }
  | { readonly kind: 'unsupported'; readonly reason: string }
  | { readonly kind: 'error'; readonly message: string };

interface SimulationInput {
  readonly project: NcpfProjectDocument;
  readonly configuration: NcpfConfigurationDocument;
  readonly configId: string;
  readonly grid: GridState;
}

/**
 * Build the record. `blockNames` is the configuration's `blocks` list *in order*,
 * so the editor's block indices are already valid record indices — no index
 * translation, no chance of an off-by-one between editor and physics.
 */
function buildRecord(input: SimulationInput): { record: GoldenRecord; warnings: string[] } {
  const { configuration, grid } = input;
  const blocks = configuration.list('blocks');
  const [dx, dy, dz] = grid.dims;
  const blockNames = blocks.map((element) => elementIdentity(element));

  const recipeNames: string[] = [];
  const recipeIds = new Map<string, number>();
  const recipes = new Array<number>(dx * dy * dz).fill(AIR);
  const gridIndices = new Array<number>(dx * dy * dz).fill(AIR);
  const warnings: string[] = [];
  const recipeCache = new Map<number, readonly NCPFElement[]>();

  const recipesOf = (index: number): readonly NCPFElement[] => {
    let list = recipeCache.get(index);
    if (list === undefined) {
      const element = blocks[index];
      list = element === undefined ? [] : configuration.recipesOf(element);
      recipeCache.set(index, list);
    }
    return list;
  };

  for (let x = 0; x < dx; x++) {
    for (let y = 0; y < dy; y++) {
      for (let z = 0; z < dz; z++) {
        const idx = x * dy * dz + y * dz + z;
        const blockIndex = grid.blocks[x]?.[y]?.[z] ?? AIR;
        if (blockIndex === AIR) continue;
        gridIndices[idx] = blockIndex;
        const recipeIndex = grid.recipes[x]?.[y]?.[z] ?? AIR;
        if (recipeIndex === AIR) continue;
        const recipe = recipesOf(blockIndex)[recipeIndex];
        if (recipe === undefined) {
          warnings.push(`block ${blockIndex} has no recipe ${recipeIndex}`);
          continue;
        }
        const key = encodeRecipe(blockIndex, recipe, recipesOf(blockIndex));
        if (key === null) {
          warnings.push(`unencodable recipe ${elementIdentity(recipe)} on block ${blockIndex}`);
          continue;
        }
        let id = recipeIds.get(key);
        if (id === undefined) {
          id = recipeNames.length;
          recipeNames.push(key);
          recipeIds.set(key, id);
        }
        recipes[idx] = id;
      }
    }
  }

  const record: GoldenRecord = {
    id: 'editor',
    type: input.configId,
    strategy: 'editor',
    size: [dx, dy, dz],
    blockNames,
    recipeNames,
    grid: gridIndices,
    recipes,
    editor: {},
    lite: null,
    divergence: {},
  };
  return { record, warnings };
}

/**
 * `"<field>=<name>"` for a recipe cell. The field is decided by the *position* of
 * the recipe in the block's own `ncpf:block_recipes` list, compared against the
 * kernel view's per-block lists — checking the kernel's own lists rather than
 * assuming "index 0 is a fuel" is what keeps this correct for irradiator and
 * heater blocks.
 */
function encodeRecipe(
  blockIndex: number,
  recipe: NCPFElement,
  allRecipes: readonly NCPFElement[],
): string | null {
  const identity = elementIdentity(recipe);
  if (!allRecipes.some((candidate) => elementIdentity(candidate) === identity)) return null;
  // The kernel views resolve recipes by *name*, so encode the recipe's Java
  // `getName()` — see `kernelRecipeName`.
  const name = kernelRecipeName(recipe);
  if (name === null) return null;
  // SFR fuel cells / MSR fuel vessels: field `fuel`; irradiators and heaters use
  // their own field. The recipe's own modules tell us which one applies.
  const field = recipeField(blockIndex, recipe);
  if (field === null) return null;
  return `${field}=${name}`;
}

/**
 * Java `NCPFElementDefinition.getName()` — the string the kernel's recipe
 * resolver compares against (`kernel/src/sfr/config.ts` `elementName`,
 * `kernel/src/dataset.ts` `assignRecipe`). This is *not* `String(raw.name)`:
 * fuel recipes are `oredict`/`legacy_recipe`/`list` elements, whose Java names
 * live in `oredict` / `inputs`+`outputs` / `elements` respectively, so the
 * definition-name rules in `formats/src/javaModel.ts` are the single source of
 * truth. An unregistered element yields `null` (or the literal `"null"` Java
 * uses) and is reported as unencodable rather than silently dropped.
 */
function kernelRecipeName(recipe: NCPFElement): string | null {
  const name = javaDefinitionName(recipe.raw as unknown as JsonObject);
  return name === null || name === 'null' ? null : name;
}

/**
 * Which record field a recipe belongs to. Decided from the recipe's own modules:
 * `fuel_stats` → `fuel`, `irradiator_stats` → `irradiatorRecipe`,
 * `heater_stats` → `heaterRecipe`. Anything else is not placeable physics, and
 * the caller records a warning instead of silently dropping it.
 */
function recipeField(_blockIndex: number, recipe: NCPFElement): string | null {
  const modules = recipe.modules as unknown as Record<string, unknown>;
  for (const name of Object.keys(modules)) {
    if (name.endsWith(':fuel_stats')) return 'fuel';
    if (name.endsWith(':irradiator_stats')) return 'irradiatorRecipe';
    if (name.endsWith(':heater_stats')) return 'heaterRecipe';
  }
  return null;
}

/** Run the single kernel over an edited design. */
export function simulateDesign(input: SimulationInput): SimulationResult {
  const { configId, project, configuration, grid } = input;
  if (!isSupported(configId)) {
    return { kind: 'unsupported', reason: configId };
  }
  const ncpfConfiguration = project.ncpf.getConfiguration(configId);
  if (ncpfConfiguration === undefined) {
    return { kind: 'error', message: `project has no configuration ${configId}` };
  }
  const { record, warnings } = buildRecord(input);
  try {
    if (configId === USFR_CONFIG_ID) {
      const base = buildUsfrConfig(ncpfConfiguration);
      const config = withSelectedFuel(base, configuration, grid);
      const { reactor } = rebuildUsfr(config, record);
      reactor.recalculate();
      return {
        kind: 'ok',
        reactorType: 'underhaul-sfr',
        stats: reactor.stats() as unknown as Record<string, number>,
        warnings,
      };
    }
    if (configId === SFR_CONFIG_ID) {
      const base = buildSfrConfig(ncpfConfiguration);
      const config = withSelectedCoolant(base, configuration, grid);
      const { reactor } = rebuildSfr(config, record);
      reactor.recalculate();
      return {
        kind: 'ok',
        reactorType: 'overhaul-sfr',
        stats: reactor.stats() as unknown as Record<string, number>,
        warnings,
      };
    }
    const config = buildMsrConfig(ncpfConfiguration);
    const { reactor } = rebuildMsr(config, record);
    reactor.recalculate();
    return {
      kind: 'ok',
      reactorType: 'overhaul-msr',
      stats: reactor.stats() as unknown as Record<string, number>,
      warnings,
    };
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Underhaul SFR carries **one** fuel for the whole multiblock, and the kernel
 * reactor always takes `config.fuels[0]`. The editor can select a different one,
 * so the selected fuel is moved to the front of a shallow copy of the config —
 * the minimal change that keeps one physics implementation.
 */
function withSelectedFuel(
  config: UsfrConfig,
  configuration: NcpfConfigurationDocument,
  grid: GridState,
): UsfrConfig {
  const selected = grid.scalars['fuel'] ?? AIR;
  const fuels = configuration.list('fuels');
  const element = selected === AIR ? undefined : fuels[selected];
  if (element === undefined) return config;
  const identity = elementIdentity(element);
  const match = config.fuels.find((fuel) => fuel.identity === identity);
  if (match === undefined || config.fuels[0] === match) return config;
  return { ...config, fuels: [match, ...config.fuels.filter((fuel) => fuel !== match)] };
}

/**
 * The selected coolant recipe.
 *
 * `rebuildSfr` derives the coolant from the **first** entry of
 * `config.configuration.lists.get('coolant_recipes')` (that is what the golden
 * generator always ran with). The editor can select another one, and rather than
 * growing a second reactor construction path — which is precisely the mistake
 * the rewrite exists to undo — the configuration's coolant list is rotated so
 * the selected recipe is first. Same kernel call, same physics, one code path.
 */
function withSelectedCoolant(
  config: SfrConfig,
  configuration: NcpfConfigurationDocument,
  grid: GridState,
): SfrConfig {
  const selected = grid.scalars['coolant_recipe'] ?? AIR;
  const list = configuration.list('coolant_recipes');
  const element = selected === AIR ? undefined : list[selected];
  if (element === undefined || selected === AIR) return config;
  const identity = elementIdentity(element);
  const current = config.configuration.lists.get('coolant_recipes') ?? [];
  const position = current.findIndex((candidate) => elementIdentity(candidate) === identity);
  if (position <= 0) return config;
  const rotated = [...current.slice(position), ...current.slice(0, position)];
  const lists = new Map(config.configuration.lists);
  lists.set('coolant_recipes', rotated);
  return { ...config, configuration: { ...config.configuration, lists } };
}
