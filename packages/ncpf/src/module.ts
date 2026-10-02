import type { NCPFElement, NCPFElementDefinition } from './element.js';
import { makeElementDefinition } from './element.js';
import type { RawElement, RawModule, RawModules, RawValue } from './raw.js';

/**
 * NCPF modules.
 *
 * In Java each module is a hand-written class (`ModeratorModule`,
 * `FuelStatsModule`, …) that declares its fields in a constructor and is wired
 * into ~120 element classes. In TS the module set is **data**: a module is a
 * name plus a schema; element classes are replaced by queries over the module
 * bag (see `hasModule` / `moduleOf`).
 *
 * This file holds only the *format-level* facts (names, field schemas, JSON
 * shapes). Physics lives in `@ncplanner/kernel`.
 */

/** Modules that exist for every reactor type. */
export const COMMON_MODULE = {
  displayName: 'plannerator:display_name',
  legacyNames: 'plannerator:legacy_names',
  texture: 'plannerator:texture',
  tags: 'plannerator:tags',
  blockRecipes: 'ncpf:block_recipes',
  globalElements: 'plannerator:global_elements',
  configurationMetadata: 'plannerator:configuration_metadata',
  /** Java `AirModule` — the module a placement rule targets to mean "empty". */
  air: 'minecraft:air',
} as const;

/** Module names contributed by a specific reactor type, e.g. `nuclearcraft:overhaul_sfr`. */
export function modulesOf(configId: string) {
  return {
    settings: `${configId}_configuration_settings`,
    casing: `${configId}:casing`,
    controller: `${configId}:controller`,
    conductor: `${configId}:conductor`,
    moderator: `${configId}:moderator`,
    reflector: `${configId}:reflector`,
    neutronShield: `${configId}:neutron_shield`,
    neutronSource: `${configId}:neutron_source`,
    heatsink: `${configId}:heat_sink`,
    cooler: `${configId}:cooler`,
    fuelCell: `${configId}:fuel_cell`,
    fuelVessel: `${configId}:fuel_vessel`,
    fuelStats: `${configId}:fuel_stats`,
    irradiator: `${configId}:irradiator`,
    irradiatorStats: `${configId}:irradiator_stats`,
    port: `${configId}:port`,
    recipePorts: `${configId}:recipe_ports`,
    coolantVent: `${configId}:coolant_vent`,
    coolantRecipeStats: `${configId}:coolant_recipe_stats`,
    heater: `${configId}:heater`,
    heaterStats: `${configId}:heater_stats`,
    activeCooler: `${configId}:active_cooler`,
    recipeStats: `${configId}:recipe_stats`,
    blade: `${configId}:blade`,
    stator: `${configId}:stator`,
    coil: `${configId}:coil`,
    bearing: `${configId}:bearing`,
    shaft: `${configId}:shaft`,
    connector: `${configId}:connector`,
    inlet: `${configId}:inlet`,
    outlet: `${configId}:outlet`,
  } as const;
}

export const SFR_CONFIG_ID = 'nuclearcraft:overhaul_sfr';
export const USFR_CONFIG_ID = 'nuclearcraft:underhaul_sfr';
export const MSR_CONFIG_ID = 'nuclearcraft:overhaul_msr';
export const TURBINE_CONFIG_ID = 'nuclearcraft:overhaul_turbine';

export type ConfigId =
  | typeof SFR_CONFIG_ID
  | typeof USFR_CONFIG_ID
  | typeof MSR_CONFIG_ID
  | typeof TURBINE_CONFIG_ID
  | string;

/** Field kinds that can appear in a module schema. */
export type ModuleFieldKind =
  | 'int'
  | 'float'
  | 'double'
  | 'boolean'
  | 'string'
  | 'stringList'
  | 'reference'
  | 'rules'
  | 'recipes'
  | 'blockstates'
  | 'elementStacks';

export interface ModuleFieldSpec {
  readonly kind: ModuleFieldKind;
  /** Wire name in the JSON payload. */
  readonly key: string;
}

export interface ModuleSpec {
  /** Fully qualified module name, e.g. `nuclearcraft:overhaul_sfr:moderator`. */
  readonly name: string;
  /** Fields, keyed by the TS-side field name. */
  readonly fields: Readonly<Record<string, ModuleFieldSpec>>;
}

/**
 * The declarative replacement for the Java module classes. Adding a module is a
 * data change, not a class; the schema is also what the `i18nAudit`-style tooling
 * and the config编辑器 will read to build their UI.
 */
export class ModuleRegistry {
  private readonly specs = new Map<string, ModuleSpec>();

  define(name: string, fields: Record<string, ModuleFieldSpec> = {}): ModuleSpec {
    const spec: ModuleSpec = { name, fields };
    this.specs.set(name, spec);
    return spec;
  }

  get(name: string): ModuleSpec | undefined {
    return this.specs.get(name);
  }

  has(name: string): boolean {
    return this.specs.has(name);
  }

  names(): string[] {
    return [...this.specs.keys()].sort();
  }
}

/** Read a module's raw payload from an element / recipe / configuration. */
export function moduleOf(
  holder: { modules?: RawModules } | undefined,
  name: string,
): RawModule | undefined {
  return holder?.modules?.[name];
}

export function hasModule(holder: { modules?: RawModules } | undefined, name: string): boolean {
  return moduleOf(holder, name) !== undefined;
}

export function num(m: RawModule | undefined, key: string, fallback = 0): number {
  const v = m?.[key];
  return typeof v === 'number' ? v : fallback;
}

export function bool(m: RawModule | undefined, key: string, fallback = false): boolean {
  const v = m?.[key];
  return typeof v === 'boolean' ? v : fallback;
}

export function str(m: RawModule | undefined, key: string, fallback = ''): string {
  const v = m?.[key];
  return typeof v === 'string' ? v : fallback;
}

// ---------------------------------------------------------------------------
// placement rules
// ---------------------------------------------------------------------------

export type RuleType = 'between' | 'axial' | 'vertex' | 'edge' | 'or' | 'and';

export interface RuleTargetModule {
  readonly kind: 'module';
  readonly name: string;
}

export interface RuleTargetElement {
  readonly kind: 'element';
  readonly definition: NCPFElementDefinition;
}

export type RuleTarget = RuleTargetModule | RuleTargetElement;

export interface PlacementRule {
  readonly rule: RuleType;
  readonly min: number;
  readonly max: number;
  readonly target?: RuleTarget;
  readonly rules: readonly PlacementRule[];
}

function parseRuleTarget(v: unknown): RuleTarget | undefined {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const raw = v as RawElement;
  if (raw.type === 'module') {
    return { kind: 'module', name: typeof raw.name === 'string' ? raw.name : '' };
  }
  return { kind: 'element', definition: makeElementDefinition(raw) };
}

/** Parse the `rules` array of a `BlockRulesModule` (heat sinks / coolers / coils). */
export function parseRules(v: unknown): PlacementRule[] {
  if (!Array.isArray(v)) return [];
  return v.map((raw) => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return { rule: 'between' as RuleType, min: 0, max: 6, rules: [] };
    }
    const obj = raw as RawElement;
    const rule = (typeof obj.type === 'string' ? obj.type : 'between') as RuleType;
    const sub = parseRules(obj.rules);
    return {
      rule,
      min: typeof obj.min === 'number' ? obj.min : 0,
      max: typeof obj.max === 'number' ? obj.max : 6,
      target: parseRuleTarget(obj.block),
      rules: sub,
    };
  });
}

/** Element stacks / recipe payloads attached through `ncpf:block_recipes`. */
export function recipePayloads(
  holder: { modules?: RawModules } | undefined,
  moduleName = COMMON_MODULE.blockRecipes,
): RawElement[] {
  const m = moduleOf(holder, moduleName);
  const recipes = m?.recipes;
  if (!Array.isArray(recipes)) return [];
  return recipes as RawElement[];
}

/** A `recipe_ports` payload (`{input: <ref>, output: <ref>}`). */
export function recipePorts(
  holder: { modules?: RawModules } | undefined,
  moduleName: string,
): { input?: RawElement; output?: RawElement } {
  const m = moduleOf(holder, moduleName);
  const out: { input?: RawElement; output?: RawElement } = {};
  const input = m?.input;
  const output = m?.output;
  if (input !== null && typeof input === 'object' && !Array.isArray(input)) {
    out.input = input as RawElement;
  }
  if (output !== null && typeof output === 'object' && !Array.isArray(output)) {
    out.output = output as RawElement;
  }
  return out;
}

/** Reaction-ratio helper used by coolant recipes (Java `getOutputRatio`). */
export function outputRatio(recipe: RawElement): number {
  const sum = (v: RawValue | undefined): number => {
    if (!Array.isArray(v)) return 0;
    let total = 0;
    for (const stack of v) {
      if (stack === null || typeof stack !== 'object' || Array.isArray(stack)) continue;
      const amount = (stack as RawElement).amount;
      total += typeof amount === 'number' ? amount : 1;
    }
    return total;
  };
  const input = sum(recipe.inputs as RawValue | undefined);
  const output = sum(recipe.outputs as RawValue | undefined);
  if (input === 0) return 0;
  return output / input;
}

/** Elements referenced by a block's `recipe_ports` module (input/output blocks). */
export function portReferences(
  holder: { modules?: RawModules } | undefined,
  moduleName: string,
): { input?: NCPFElementDefinition; output?: NCPFElementDefinition } {
  const ports = recipePorts(holder, moduleName);
  const out: { input?: NCPFElementDefinition; output?: NCPFElementDefinition } = {};
  if (ports.input) out.input = makeElementDefinition(ports.input);
  if (ports.output) out.output = makeElementDefinition(ports.output);
  return out;
}

/** Convenience: the module a heat sink / cooler's placement rules target. */
export function isAirRule(rule: PlacementRule): boolean {
  return rule.target?.kind === 'module' && rule.target.name === COMMON_MODULE.air;
}

export type { NCPFElement };
