/**
 * `CompiledOverhaulSFRConfiguration` / `CompiledUnderhaulSFRConfiguration` — the
 * generator's flat, index-addressed view of a configuration.
 *
 * ## Why this module exists at all
 *
 * The frozen Java lite engine needed its own flattened configuration because its
 * physics was hand-inlined over `int[]` arrays. **Our physics is the kernel**
 * (`@ncplanner/kernel`), so this module is deliberately *much* thinner than
 * `CompiledOverhaulSFRConfiguration.java` (363 lines): it compiles nothing about
 * cooling, flux, rules or clustering, because the kernel already owns all of that.
 *
 * What survives is exactly what the *generator* needs and the kernel does not:
 *
 *  1. **An index space.** `LiteOverhaulSFR.blocks[x][y][z]` is an `int` index into
 *     the compiled arrays, not a block object. The generator's savings come from
 *     shuffling small integers around; the mapping index → kernel object happens
 *     once per `calculate()`.
 *  2. **Recipe pairs.** Java compiles `(block, fuel)` and `(block, irradiator
 *     recipe)` into one entry each (`CompiledOverhaulSFRConfiguration.addBlock`),
 *     so index 0..n covers *every* user-selectable block+recipe combination.
 *  3. **Display names**, for the `Block Count: <name>` variables and the UI.
 *
 * Index 0 is reserved for air: the shipped presets store `-1` for air in the
 * mutator index lists and the mutators subtract 1, so the grid's own integer domain
 * is `0 = air, i > 0 = entry i - 1`.
 */

import { outputRatio, type Configuration } from '@ncplanner/ncpf';
import type {
  SfrConfig,
  SfrCoolantRecipe,
  SfrFuel,
  SfrIrradiatorRecipe,
  SfrTemplate,
  UsfrActiveCoolerRecipe,
  UsfrConfig,
  UsfrFuel,
  UsfrTemplate,
} from '@ncplanner/kernel';

/** One entry of the generator's block index space. */
export interface CompiledEntry<TTemplate> {
  /** The grid stores `index`; `index - 1` addresses {@link entries}. */
  readonly index: number;
  readonly template: TTemplate;
  /** `null` unless the entry is a fuel cell (`fuel`) / active cooler (`recipe`). */
  readonly recipe: SfrFuel | SfrIrradiatorRecipe | UsfrActiveCoolerRecipe | null;
  /**
   * Index into `configuration.blocks` (NCPF list order), and the index of the
   * recipe inside that block's own recipe list (`-1` when the block has none).
   * Together they let a result be written back as a portable
   * `(identity, recipe name)` pair — see `reactors/sfr.ts#toPortable`.
   */
  readonly blockListIndex: number;
  readonly recipeIndex: number;
  /** Java `BlockAndRecipe.getDisplayName()` — `block (recipe)`. */
  readonly displayName: string;
  /**
   * Java `CompiledOverhaulSFRConfiguration.losTest` — `false` for fuel cells,
   * irradiators and reflectors. Kept because it documents which entries the lite
   * engine excluded from line-of-sight sweeps; the kernel does not need it.
   */
  readonly losTest: boolean;
}

export interface CoolantRecipeEntry {
  readonly index: number;
  readonly heat: number;
  readonly ratio: number;
  readonly displayName: string;
  /** The kernel's own minimal coolant record. */
  readonly recipe: SfrCoolantRecipe;
}

/** Java `CompiledOverhaulSFRConfiguration`, minus everything the kernel owns. */
export interface CompiledSfrConfiguration {
  readonly config: SfrConfig;
  readonly entries: readonly CompiledEntry<SfrTemplate>[];
  readonly coolantRecipes: readonly CoolantRecipeEntry[];
  readonly neutronReach: number;
  readonly minSize: number;
  readonly maxSize: number;
}

/** Java `CompiledUnderhaulSFRConfiguration`, minus everything the kernel owns. */
export interface CompiledUsfrConfiguration {
  readonly config: UsfrConfig;
  readonly entries: readonly CompiledEntry<UsfrTemplate>[];
  readonly fuels: readonly UsfrFuel[];
  readonly neutronReach: number;
  readonly minSize: number;
  readonly maxSize: number;
}

/** Java `BlockFunctionModule` lookup, reduced to what the generator prints. */
function sfrLosTest(t: SfrTemplate): boolean {
  return !(t.fuelCell || t.irradiator || t.reflector !== null);
}

function usfrLosTest(t: UsfrTemplate): boolean {
  return !(t.fuelCell || t.activeCooler);
}

export function compileSfr(config: SfrConfig): CompiledSfrConfiguration {
  const blocks = config.configuration.blocks;
  const entries: CompiledEntry<SfrTemplate>[] = [];
  for (let b = 0; b < config.templates.length; b++) {
    const template = config.templates[b];
    if (template === undefined) continue;
    // Java `addBlock`: casings and controllers are structural, never mutated.
    if (template.casing || template.controller) continue;
    if (template.fuelCell) {
      for (let r = 0; r < template.fuels.length; r++) {
        const fuel = template.fuels[r];
        if (fuel === undefined) continue;
        entries.push({
          index: entries.length + 1,
          template,
          recipe: fuel,
          blockListIndex: b,
          recipeIndex: r,
          displayName: `${template.displayName} (${fuel.displayName})`,
          losTest: false,
        });
      }
      if (template.fuels.length === 0) {
        // A fuel cell with no fuel is unusable, but Java still emits a bare entry
        // for it (its `for(Fuel fuel : block.fuels)` simply does not run, so it
        // emits *nothing*) — we mirror that and skip.
        continue;
      }
      continue;
    }
    if (template.irradiator) {
      for (let r = 0; r < template.irradiatorRecipes.length; r++) {
        const recipe = template.irradiatorRecipes[r];
        if (recipe === undefined) continue;
        entries.push({
          index: entries.length + 1,
          template,
          recipe,
          blockListIndex: b,
          recipeIndex: r,
          displayName: `${template.displayName} (${recipe.displayName})`,
          losTest: false,
        });
      }
      continue;
    }
    entries.push({
      index: entries.length + 1,
      template,
      recipe: null,
      blockListIndex: b,
      recipeIndex: -1,
      displayName: template.displayName,
      losTest: sfrLosTest(template),
    });
  }

  const coolantRecipes = compileCoolantRecipes(config.configuration);
  return {
    config,
    entries,
    coolantRecipes,
    neutronReach: config.settings.neutronReach,
    minSize: config.settings.minSize,
    maxSize: config.settings.maxSize,
  };
}

/**
 * The coolant recipe list. Java reads `stats.heat` from the
 * `overhaul_sfr:coolant_recipe_stats` module and the output ratio from the recipe
 * *definition* (`NCPFLegacyRecipeElement.getOutputRatio()`), which is what
 * `@ncplanner/ncpf`'s `outputRatio` implements — the same helper
 * `packages/kernel/src/dataset.ts` uses for the editor's default coolant.
 */
export function compileCoolantRecipes(configuration: Configuration): CoolantRecipeEntry[] {
  const list = configuration.lists.get('coolant_recipes') ?? [];
  const out: CoolantRecipeEntry[] = [];
  for (let i = 0; i < list.length; i++) {
    const element = list[i];
    if (element === undefined) continue;
    const stats = element.modules['nuclearcraft:overhaul_sfr:coolant_recipe_stats'] as
      | { heat?: unknown }
      | undefined;
    const heat = typeof stats?.heat === 'number' ? stats.heat : 0;
    const ratio = outputRatio(element.raw);
    out.push({
      index: i,
      heat,
      ratio,
      displayName: element.displayName,
      recipe: { heat, ratio },
    });
  }
  return out;
}

export function compileUsfr(config: UsfrConfig): CompiledUsfrConfiguration {
  const entries: CompiledEntry<UsfrTemplate>[] = [];
  for (let b = 0; b < config.templates.length; b++) {
    const template = config.templates[b];
    if (template === undefined) continue;
    if (template.casing || template.controller) continue;
    if (template.activeCooler) {
      for (let r = 0; r < template.activeCoolerRecipes.length; r++) {
        const recipe = template.activeCoolerRecipes[r];
        if (recipe === undefined) continue;
        entries.push({
          index: entries.length + 1,
          template,
          recipe,
          blockListIndex: b,
          recipeIndex: r,
          displayName: `${template.displayName} (${recipe.displayName})`,
          losTest: false,
        });
      }
      continue;
    }
    entries.push({
      index: entries.length + 1,
      template,
      recipe: null,
      blockListIndex: b,
      recipeIndex: -1,
      displayName: template.displayName,
      losTest: usfrLosTest(template),
    });
  }
  return {
    config,
    entries,
    fuels: config.fuels,
    neutronReach: config.settings.neutronReach,
    minSize: config.settings.minSize,
    maxSize: config.settings.maxSize,
  };
}

