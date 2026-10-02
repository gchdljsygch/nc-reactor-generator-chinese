import {
  hasModule,
  moduleOf,
  modulesOf,
  num,
  bool,
  parseRules,
  settingsOf,
  type Configuration,
  type NCPFElement,
  type PlacementRule,
} from '@ncplanner/ncpf';
import { f } from '../float.js';

/**
 * `nuclearcraft:overhaul_turbine` — the Overhaul Turbine view.
 *
 * The turbine is much smaller than a reactor: a rotor of blades/stators on a
 * bearing, plus dynamo coils at both faces. It carries **one** multiblock-level
 * recipe (`OverhaulTurbine.recipe`, defaulting to `recipes[0]`) whose
 * `coefficient`/`power` drive the whole calculation — block-level recipes do not
 * exist for this type (`Block.getRecipes()` is empty).
 *
 * Field kinds come from `packages/ncpf/src/moduleSchema.ts`, which mirrors
 * `planner/ncpf/module/overhaulTurbine/*.java`:
 * `blade.{efficiency,expansion}` and `stator.expansion` are `float`;
 * `coil.efficiency` is `float`; `recipe_stats.{power,coefficient}` are **double**
 * (they are never narrowed — see `docs/r1/float-fidelity.md` rule 6).
 */

/** `nuclearcraft:overhaul_turbine` */
export const TURBINE_CONFIG_ID = 'nuclearcraft:overhaul_turbine';

const M = modulesOf(TURBINE_CONFIG_ID);

export interface TurbineSettings {
  readonly minWidth: number;
  readonly minLength: number;
  readonly maxSize: number;
  readonly fluidPerBlade: number;
  /** Java `float`. */
  readonly throughputFactor: number;
  /** Java `float`. */
  readonly powerBonus: number;
  /** Java `float`. */
  readonly throughputEfficiencyLeniencyMultiplier: number;
  /** Java `float`. */
  readonly throughputEfficiencyLeniencyThreshold: number;
}

export interface TurbineRecipeStats {
  /** Java `double`. */
  readonly power: number;
  /** Java `double`. */
  readonly coefficient: number;
}

export interface TurbineRecipe {
  /** Dataset / project key: `<fieldName>=<definition name>`. */
  readonly key: string;
  readonly name: string;
  readonly identity: string;
  readonly displayName: string;
  readonly stats: TurbineRecipeStats;
}

export interface TurbineCasing {
  readonly edge: boolean;
}

export interface TurbineBlade {
  /** Java `float`. */
  readonly efficiency: number;
  /** Java `float`. */
  readonly expansion: number;
}

export interface TurbineStator {
  /** Java `float`. */
  readonly expansion: number;
}

export interface TurbineCoil {
  /** Java `float`. */
  readonly efficiency: number;
  readonly rules: readonly PlacementRule[];
}

export interface TurbineConnector {
  readonly rules: readonly PlacementRule[];
}

/**
 * A block template: the Java
 * `plannerator.ncpf.configuration.overhaulTurbine.BlockElement`.
 */
export interface TurbineTemplate {
  readonly element: NCPFElement;
  readonly identity: string;
  readonly name: string;
  readonly displayName: string;
  readonly blade: TurbineBlade | null;
  readonly stator: TurbineStator | null;
  readonly coil: TurbineCoil | null;
  readonly bearing: boolean;
  readonly shaft: boolean;
  readonly connector: TurbineConnector | null;
  readonly controller: boolean;
  readonly casing: TurbineCasing | null;
  readonly inlet: boolean;
  readonly outlet: boolean;
}

export interface TurbineConfig {
  readonly configuration: Configuration;
  readonly settings: TurbineSettings;
  readonly templates: readonly TurbineTemplate[];
  readonly byIdentity: ReadonlyMap<string, TurbineTemplate>;
  /** Java `OverhaulTurbineConfiguration.recipes` — the default is the first. */
  readonly recipes: readonly TurbineRecipe[];
  findByIdentity(identity: string): TurbineTemplate | undefined;
}

function makeTemplate(element: NCPFElement): TurbineTemplate {
  const mods = element.modules;
  const holder = { modules: mods };
  const casingModule = moduleOf(holder, M.casing);
  const bladeModule = moduleOf(holder, M.blade);
  const statorModule = moduleOf(holder, M.stator);
  const coilModule = moduleOf(holder, M.coil);
  const connectorModule = moduleOf(holder, M.connector);
  return {
    element,
    identity: element.definition.identity,
    name: element.definition.name,
    displayName: element.displayName,
    blade: bladeModule
      ? {
          // BladeModule declares BOTH fields as `float`.
          efficiency: f(num(bladeModule, 'efficiency')),
          expansion: f(num(bladeModule, 'expansion')),
        }
      : null,
    stator: statorModule ? { expansion: f(num(statorModule, 'expansion')) } : null,
    coil: coilModule
      ? { efficiency: f(num(coilModule, 'efficiency')), rules: parseRules(coilModule.rules) }
      : null,
    bearing: hasModule(holder, M.bearing),
    shaft: hasModule(holder, M.shaft),
    connector: connectorModule ? { rules: parseRules(connectorModule.rules) } : null,
    controller: hasModule(holder, M.controller),
    casing: casingModule ? { edge: bool(casingModule, 'edge') } : null,
    inlet: hasModule(holder, M.inlet),
    outlet: hasModule(holder, M.outlet),
  };
}

function recipeFrom(element: NCPFElement): TurbineRecipe {
  const stats = moduleOf({ modules: element.modules }, M.recipeStats);
  return {
    key: `recipe=${element.definition.name}`,
    name: element.definition.name,
    identity: `${element.definition.type}|${element.definition.identity}`,
    displayName: element.displayName,
    stats: {
      // RecipeStatsModule declares `power` and `coefficient` as `double`.
      power: num(stats, 'power'),
      coefficient: num(stats, 'coefficient'),
    },
  };
}

function settingsFrom(configuration: Configuration): TurbineSettings {
  const m = settingsOf(configuration, M.settings);
  return {
    minWidth: num(m, 'min_width', 3),
    minLength: num(m, 'min_length', 1),
    maxSize: num(m, 'max_size', 24),
    fluidPerBlade: num(m, 'fluid_per_blade', 100),
    // Java declares these `float`; narrow so downstream arithmetic matches.
    throughputFactor: f(num(m, 'throughput_factor', 2)),
    powerBonus: f(num(m, 'power_bonus', 1)),
    throughputEfficiencyLeniencyMultiplier: f(
      num(m, 'throughput_efficiency_leniency_multiplier', 0.5),
    ),
    throughputEfficiencyLeniencyThreshold: f(
      num(m, 'throughput_efficiency_leniency_threshold', 0.75),
    ),
  };
}

export function buildTurbineConfig(configuration: Configuration): TurbineConfig {
  const templates = configuration.blocks.map((e) => makeTemplate(e));
  const byIdentity = new Map<string, TurbineTemplate>();
  for (const t of templates) if (!byIdentity.has(t.identity)) byIdentity.set(t.identity, t);
  const recipes = (configuration.lists.get('recipes') ?? []).map((e) => recipeFrom(e));
  return {
    configuration,
    settings: settingsFrom(configuration),
    templates,
    byIdentity,
    recipes,
    findByIdentity(identity: string) {
      return byIdentity.get(identity);
    },
  };
}
