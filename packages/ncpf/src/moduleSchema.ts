import { COMMON_MODULE, ModuleRegistry, type ModuleFieldSpec, type ModuleSpec } from './module.js';

/**
 * R1.3c — the declarative module schema.
 *
 * Java defines these as ~120 hand-written classes, each declaring its fields in
 * a constructor and wiring them into ~120 element classes with boilerplate
 * `convertToObject` / `convertFromObject` methods (205 of them, per R0). Here the
 * same information is data: one entry per module, one entry per field.
 *
 * The `kind` is not decoration — it is what makes the port faithful:
 * `int` must stay an integer (Java narrowing on `int += float`), `float` must be
 * narrowed with `Math.fround` on read (`double` must not). Reading a `float`
 * field as a JS double silently changes downstream rounding; that bug was found
 * and fixed while porting Overhaul SFR (see `docs/r1/float-fidelity.md`).
 */

const int = (key: string): ModuleFieldSpec => ({ kind: 'int', key });
const float = (key: string): ModuleFieldSpec => ({ kind: 'float', key });
const double = (key: string): ModuleFieldSpec => ({ kind: 'double', key });
const bool = (key: string): ModuleFieldSpec => ({ kind: 'boolean', key });
const str = (key: string): ModuleFieldSpec => ({ kind: 'string', key });
const strList = (key: string): ModuleFieldSpec => ({ kind: 'stringList', key });
const rules = (key: string): ModuleFieldSpec => ({ kind: 'rules', key });
const recipes = (key: string): ModuleFieldSpec => ({ kind: 'recipes', key });
const reference = (key: string): ModuleFieldSpec => ({ kind: 'reference', key });

function module(name: string, fields: Record<string, ModuleFieldSpec>): ModuleSpec {
  return { name, fields };
}

/** Every module that appears in the shipped `nuclearcraft.ncpf.json`. */
export const SHIPPED_MODULE_SCHEMA: readonly ModuleSpec[] = [
  // ---- shared / plannerator -------------------------------------------------
  module(COMMON_MODULE.displayName, { displayName: str('display_name') }),
  module(COMMON_MODULE.legacyNames, { legacyNames: strList('legacy_names') }),
  module(COMMON_MODULE.texture, {
    texture: str('texture'),
    displayTexture: str('display_texture'),
  }),
  module(COMMON_MODULE.tags, { tags: strList('tags') }),
  module(COMMON_MODULE.blockRecipes, { recipes: recipes('recipes') }),
  module(COMMON_MODULE.configurationMetadata, {
    name: str('name'),
    version: str('version'),
  }),
  module(COMMON_MODULE.globalElements, { elements: recipes('elements') }),
  module('plannerator:metadata', {}),

  // ---- Overhaul SFR --------------------------------------------------------
  module('nuclearcraft:overhaul_sfr:casing', { edge: bool('edge') }),
  module('nuclearcraft:overhaul_sfr:controller', {}),
  module('nuclearcraft:overhaul_sfr:conductor', {}),
  module('nuclearcraft:overhaul_sfr:coolant_vent', { output: bool('output') }),
  module('nuclearcraft:overhaul_sfr:fuel_cell', {}),
  module('nuclearcraft:overhaul_sfr:heat_sink', {
    cooling: int('cooling'),
    rules: rules('rules'),
  }),
  module('nuclearcraft:overhaul_sfr:irradiator', {}),
  module('nuclearcraft:overhaul_sfr:moderator', {
    flux: int('flux'),
    efficiency: float('efficiency'),
  }),
  module('nuclearcraft:overhaul_sfr:neutron_shield', {
    heatPerFlux: int('heat_per_flux'),
    efficiency: float('efficiency'),
    closed: reference('closed'),
  }),
  module('nuclearcraft:overhaul_sfr:neutron_source', { efficiency: float('efficiency') }),
  module('nuclearcraft:overhaul_sfr:port', { output: bool('output') }),
  module('nuclearcraft:overhaul_sfr:recipe_ports', {
    input: reference('input'),
    output: reference('output'),
  }),
  module('nuclearcraft:overhaul_sfr:reflector', {
    efficiency: float('efficiency'),
    reflectivity: float('reflectivity'),
  }),
  module('nuclearcraft:overhaul_sfr:fuel_stats', {
    efficiency: float('efficiency'),
    heat: int('heat'),
    time: int('time'),
    criticality: int('criticality'),
    selfPriming: bool('self_priming'),
  }),
  module('nuclearcraft:overhaul_sfr:irradiator_stats', {
    efficiency: float('efficiency'),
    heat: float('heat'),
  }),
  module('nuclearcraft:overhaul_sfr:coolant_recipe_stats', { heat: int('heat') }),
  module('nuclearcraft:overhaul_sfr_configuration_settings', {
    minSize: int('min_size'),
    maxSize: int('max_size'),
    neutronReach: int('neutron_reach'),
    coolingEfficiencyLeniency: int('cooling_efficiency_leniency'),
    sparsityPenaltyMultiplier: float('sparsity_penalty_multiplier'),
    sparsityPenaltyThreshold: float('sparsity_penalty_threshold'),
  }),

  // ---- Underhaul SFR -------------------------------------------------------
  module('nuclearcraft:underhaul_sfr:casing', {}),
  module('nuclearcraft:underhaul_sfr:controller', {}),
  module('nuclearcraft:underhaul_sfr:fuel_cell', {}),
  module('nuclearcraft:underhaul_sfr:moderator', {}),
  module('nuclearcraft:underhaul_sfr:cooler', {
    cooling: int('cooling'),
    rules: rules('rules'),
  }),
  module('nuclearcraft:underhaul_sfr:active_cooler', {}),
  module('nuclearcraft:underhaul_sfr:fuel_stats', {
    power: float('power'),
    heat: float('heat'),
    time: int('time'),
  }),
  module('nuclearcraft:underhaul_sfr_configuration_settings', {
    minSize: int('min_size'),
    maxSize: int('max_size'),
    neutronReach: int('neutron_reach'),
    moderatorExtraPower: float('moderator_extra_power'),
    moderatorExtraHeat: float('moderator_extra_heat'),
    activeCoolerRate: int('active_cooler_rate'),
  }),

  // ---- Overhaul MSR --------------------------------------------------------
  module('nuclearcraft:overhaul_msr:casing', { edge: bool('edge') }),
  module('nuclearcraft:overhaul_msr:controller', {}),
  module('nuclearcraft:overhaul_msr:conductor', {}),
  module('nuclearcraft:overhaul_msr:fuel_vessel', {}),
  module('nuclearcraft:overhaul_msr:heater', { rules: rules('rules') }),
  module('nuclearcraft:overhaul_msr:irradiator', {}),
  module('nuclearcraft:overhaul_msr:moderator', {
    flux: int('flux'),
    efficiency: float('efficiency'),
  }),
  module('nuclearcraft:overhaul_msr:neutron_shield', {
    heatPerFlux: int('heat_per_flux'),
    efficiency: float('efficiency'),
    closed: reference('closed'),
  }),
  module('nuclearcraft:overhaul_msr:neutron_source', { efficiency: float('efficiency') }),
  module('nuclearcraft:overhaul_msr:port', { output: bool('output') }),
  module('nuclearcraft:overhaul_msr:recipe_ports', {
    input: reference('input'),
    output: reference('output'),
  }),
  module('nuclearcraft:overhaul_msr:reflector', {
    efficiency: float('efficiency'),
    reflectivity: float('reflectivity'),
  }),
  module('nuclearcraft:overhaul_msr:fuel_stats', {
    efficiency: float('efficiency'),
    heat: int('heat'),
    // NOTE: MSR declares `time` as a float, SFR as an int.
    time: float('time'),
    criticality: int('criticality'),
    selfPriming: bool('self_priming'),
  }),
  module('nuclearcraft:overhaul_msr:heater_stats', { cooling: int('cooling') }),
  module('nuclearcraft:overhaul_msr:irradiator_stats', {
    efficiency: float('efficiency'),
    heat: float('heat'),
  }),
  module('nuclearcraft:overhaul_msr_configuration_settings', {
    minSize: int('min_size'),
    maxSize: int('max_size'),
    neutronReach: int('neutron_reach'),
    coolingEfficiencyLeniency: int('cooling_efficiency_leniency'),
    sparsityPenaltyMultiplier: float('sparsity_penalty_multiplier'),
    sparsityPenaltyThreshold: float('sparsity_penalty_threshold'),
  }),

  // ---- Overhaul Turbine ----------------------------------------------------
  module('nuclearcraft:overhaul_turbine:casing', { edge: bool('edge') }),
  module('nuclearcraft:overhaul_turbine:controller', {}),
  module('nuclearcraft:overhaul_turbine:bearing', {}),
  module('nuclearcraft:overhaul_turbine:shaft', {}),
  module('nuclearcraft:overhaul_turbine:connector', { rules: rules('rules') }),
  module('nuclearcraft:overhaul_turbine:inlet', {}),
  module('nuclearcraft:overhaul_turbine:outlet', {}),
  module('nuclearcraft:overhaul_turbine:blade', {
    efficiency: float('efficiency'),
    expansion: float('expansion'),
  }),
  module('nuclearcraft:overhaul_turbine:stator', { expansion: float('expansion') }),
  module('nuclearcraft:overhaul_turbine:coil', {
    efficiency: float('efficiency'),
    rules: rules('rules'),
  }),
  module('nuclearcraft:overhaul_turbine:recipe_stats', {
    power: double('power'),
    coefficient: double('coefficient'),
  }),
  module('nuclearcraft:overhaul_turbine_configuration_settings', {
    minWidth: int('min_width'),
    minLength: int('min_length'),
    maxSize: int('max_size'),
    fluidPerBlade: int('fluid_per_blade'),
    throughputFactor: float('throughput_factor'),
    powerBonus: float('power_bonus'),
    throughputEfficiencyLeniencyMultiplier: float('throughput_efficiency_leniency_multiplier'),
    throughputEfficiencyLeniencyThreshold: float('throughput_efficiency_leniency_threshold'),
  }),
];

/** Populate a registry with every shipped module (Java `CoreModule` + `OverhaulModule` + `UnderhaulModule`). */
export function defineShippedModules(registry: ModuleRegistry): ModuleRegistry {
  for (const spec of SHIPPED_MODULE_SCHEMA) registry.define(spec.name, spec.fields);
  return registry;
}

/** A registry containing exactly the shipped modules. */
export function shippedModuleRegistry(): ModuleRegistry {
  return defineShippedModules(new ModuleRegistry());
}

/** Module names present in a raw configuration that the schema does not describe. */
export function unknownModuleNames(
  registry: ModuleRegistry,
  moduleNames: Iterable<string>,
): string[] {
  const unknown = new Set<string>();
  for (const name of moduleNames) if (!registry.has(name)) unknown.add(name);
  return [...unknown].sort();
}
