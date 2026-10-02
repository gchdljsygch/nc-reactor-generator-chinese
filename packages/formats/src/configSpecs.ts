/**
 * Per-reactor-type configuration facts, ported from the Java configuration
 * classes. They are needed because the NCPF wire format does **not** describe
 * which keys of a `configuration.<id>` object are element lists, nor which
 * elements contribute block recipes: that knowledge lives in the 120 hand
 * written Java classes this package is replacing with data (R1.3c).
 *
 * Sources (`src/net/ncplanner/plannerator/...`):
 *
 *  - `getName()` — used verbatim by the R0 fingerprint
 *    (`RoundTrip.signature()` writes `cfg|` + `getName()`):
 *      `ncpf/configuration/NCPFOverhaulSFRConfiguration.java:14`
 *      `ncpf/configuration/NCPFUnderhaulSFRConfiguration.java:14`
 *      `ncpf/configuration/NCPFOverhaulMSRConfiguration.java:12`
 *      `ncpf/configuration/NCPFOverhaulTurbineConfiguration.java:14`
 *      `ncpf/configuration/NCPFOverhaulDistillerConfiguration.java:14`
 *      `planner/ncpf/configuration/OverhaulFusionConfiguration.java:77` → "Fusion Test Configuration"
 *      `ncpf/configuration/UnknownNCPFConfiguration.java:33` → "Unknown Configuration"
 *
 *  - `elementLists` — the *declared* element lists, in declaration order. They
 *    are what `NCPFConfiguration.getElements()` returns and therefore what both
 *    the fingerprint and `makePartial` walk:
 *      `planner/ncpf/configuration/OverhaulSFRConfiguration.java:20-21`
 *      `planner/ncpf/configuration/UnderhaulSFRConfiguration.java:20-21`
 *      `planner/ncpf/configuration/OverhaulMSRConfiguration.java:18`
 *      `planner/ncpf/configuration/OverhaulTurbineConfiguration.java:20-21`
 *      `planner/ncpf/configuration/OverhaulDistillerConfiguration.java:20-21`
 *      `planner/ncpf/configuration/OverhaulFusionConfiguration.java:58-60`
 *
 *  - `blockRecipeGate` — `BlockRecipesElement.getBlockRecipes()` returns the
 *    element's **first** declared recipe list (the list object is never `null`),
 *    and that list is only populated when its containing module is present
 *    (`DefinedPlanneratorRecipe.convertFromObject`, `BlockRecipesElement:50-52`):
 *      overhaul_sfr  → `fuel_cell`   (`overhaulSFR/BlockElement.java:52`)
 *      underhaul_sfr → `active_cooler` (`underhaulSFR/BlockElement.java`)
 *      overhaul_msr  → `fuel_vessel` (`overhaulMSR/BlockElement.java:50`)
 *      fusion        → `breeding_blanket` (explicit `getBlockRecipes()` override,
 *                      `overhaulFusion/BlockElement.java:74-96`)
 *      turbine / distiller → none (their `BlockElement` is not a
 *      `BlockRecipesElement`)
 *
 *  - `recipePortsModule` — `RecipePortsModule.setLocalReferences` sets
 *    `input.block.parent = output.block.parent = <the block holding the module>`,
 *    and `DefinedPlanneratorRecipe.setReferences` then copies the parent's first
 *    recipe list *by reference* into the port. That is why toggled ports
 *    (`fission_cell_port[active=false]` …) show up in the fingerprint with their
 *    parent's recipes.
 */
export interface ConfigurationSpec {
  /** Java `NCPFConfiguration.getName()` — the human readable name. */
  readonly name: string;
  /** Declared element lists (JSON keys), in declaration order. */
  readonly elementLists: readonly string[];
  /** Module whose presence loads this config type's first block recipe list. */
  readonly blockRecipeGate: string | null;
  /** Module whose `input`/`output` references make a block a port of another. */
  readonly recipePortsModule: string | null;
}

export const OVERHAUL_SFR = 'nuclearcraft:overhaul_sfr';
export const UNDERHAUL_SFR = 'nuclearcraft:underhaul_sfr';
export const OVERHAUL_MSR = 'nuclearcraft:overhaul_msr';
export const OVERHAUL_TURBINE = 'nuclearcraft:overhaul_turbine';
export const OVERHAUL_DISTILLER = 'nuclearcraft:overhaul_distiller';
export const FUSION_TEST = 'plannerator:fusion_test';

const UNKNOWN_SPEC: ConfigurationSpec = {
  name: 'Unknown Configuration',
  elementLists: [],
  blockRecipeGate: null,
  recipePortsModule: null,
};

export const CONFIG_SPECS: Readonly<Record<string, ConfigurationSpec>> = {
  [OVERHAUL_SFR]: {
    name: 'Overhaul SFR Configuration',
    elementLists: ['blocks', 'coolant_recipes'],
    blockRecipeGate: `${OVERHAUL_SFR}:fuel_cell`,
    recipePortsModule: `${OVERHAUL_SFR}:recipe_ports`,
  },
  [UNDERHAUL_SFR]: {
    name: 'Underhaul SFR Configuration',
    elementLists: ['blocks', 'fuels'],
    blockRecipeGate: `${UNDERHAUL_SFR}:active_cooler`,
    recipePortsModule: null,
  },
  [OVERHAUL_MSR]: {
    name: 'Overhaul MSR Configuration',
    elementLists: ['blocks'],
    blockRecipeGate: `${OVERHAUL_MSR}:fuel_vessel`,
    recipePortsModule: `${OVERHAUL_MSR}:recipe_ports`,
  },
  [OVERHAUL_TURBINE]: {
    name: 'Overhaul Turbine Configuration',
    elementLists: ['blocks', 'recipes'],
    blockRecipeGate: null,
    recipePortsModule: null,
  },
  [OVERHAUL_DISTILLER]: {
    name: 'Overhaul Distiller Configuration',
    elementLists: ['blocks', 'recipes'],
    blockRecipeGate: null,
    recipePortsModule: null,
  },
  [FUSION_TEST]: {
    name: 'Fusion Test Configuration',
    elementLists: ['blocks', 'coolant_recipes', 'recipes'],
    blockRecipeGate: `${FUSION_TEST}:breeding_blanket`,
    recipePortsModule: null,
  },
};

/** Spec for a configuration id; unrecognised ids behave like Java's `UnknownNCPFConfiguration`. */
export function configurationSpec(configId: string): ConfigurationSpec {
  return CONFIG_SPECS[configId] ?? UNKNOWN_SPEC;
}

/**
 * Which configuration element list a design's scalar element reference points
 * into. Java hard-codes these per design class
 * (`NCPFUnderhaulSFRDesign.convertToObject` → `setIndex("fuel", …, config.fuels)`,
 * `NCPFOverhaulSFRDesign` → `("coolant_recipe", …, config.coolantRecipes)`,
 * `NCPFOverhaulTurbineDesign` → `("recipe", …, config.recipes)`).
 */
export const DESIGN_SCALAR_REFERENCES: Readonly<Record<string, string>> = {
  fuel: 'fuels',
  coolant_recipe: 'coolant_recipes',
  recipe: 'recipes',
};
