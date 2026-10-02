import {
  COMMON_MODULE,
  definitionIdentity,
  hasModule,
  moduleOf,
  modulesOf,
  num,
  bool,
  parseRules,
  recipePayloads,
  settingsOf,
  stackToString,
  type Configuration,
  type NCPFElement,
  type PlacementRule,
  type RawElement,
} from '@ncplanner/ncpf';
import { f } from '../float.js';

/** `nuclearcraft:overhaul_sfr` */
export const SFR_CONFIG_ID = 'nuclearcraft:overhaul_sfr';

const M = modulesOf(SFR_CONFIG_ID);

export interface SfrSettings {
  readonly minSize: number;
  readonly maxSize: number;
  readonly neutronReach: number;
  readonly coolingEfficiencyLeniency: number;
  /** Java `float`. */
  readonly sparsityPenaltyMultiplier: number;
  /** Java `float`. */
  readonly sparsityPenaltyThreshold: number;
}

export interface SfrFuelStats {
  readonly efficiency: number;
  readonly heat: number;
  readonly time: number;
  readonly criticality: number;
  readonly selfPriming: boolean;
}

export interface SfrFuel {
  /** Dataset / project key: `<fieldName>=<definition name>` for golden records. */
  readonly key: string;
  readonly name: string;
  readonly identity: string;
  readonly displayName: string;
  readonly stats: SfrFuelStats;
}

export interface SfrIrradiatorStats {
  readonly efficiency: number;
  readonly heat: number;
}

export interface SfrIrradiatorRecipe {
  readonly key: string;
  readonly name: string;
  readonly identity: string;
  readonly displayName: string;
  readonly stats: SfrIrradiatorStats;
}

export interface SfrModerator {
  readonly flux: number;
  readonly efficiency: number;
}

export interface SfrReflector {
  readonly efficiency: number;
  readonly reflectivity: number;
}

export interface SfrNeutronShield {
  readonly heatPerFlux: number;
  readonly efficiency: number;
  /** Raw `closed` reference, resolved to `toggled` after all templates are built. */
  readonly closed: RawElement | undefined;
}

export interface SfrHeatsink {
  readonly cooling: number;
  readonly rules: readonly PlacementRule[];
}

export interface SfrNeutronSource {
  readonly efficiency: number;
}

export interface SfrCoolantVent {
  readonly output: boolean;
}

export interface SfrPort {
  readonly output: boolean;
}

/**
 * A block template: the Java `plannerator.ncpf.configuration.overhaulSFR.BlockElement`,
 * reduced to what the physics reads.
 */
export interface SfrTemplate {
  readonly element: NCPFElement;
  readonly identity: string;
  readonly name: string;
  readonly displayName: string;
  readonly conductor: boolean;
  readonly casing: boolean;
  readonly controller: boolean;
  readonly fuelCell: boolean;
  readonly irradiator: boolean;
  readonly coolantVent: SfrCoolantVent | null;
  readonly port: SfrPort | null;
  readonly moderator: SfrModerator | null;
  readonly reflector: SfrReflector | null;
  readonly neutronShield: SfrNeutronShield | null;
  readonly neutronSource: SfrNeutronSource | null;
  readonly heatsink: SfrHeatsink | null;
  readonly fuels: readonly SfrFuel[];
  readonly irradiatorRecipes: readonly SfrIrradiatorRecipe[];
  /** Java `BlockElement.toggled` / `unToggled` (neutron shields, vents, ports). */
  toggled: SfrTemplate | null;
  unToggled: SfrTemplate | null;
}

export function blocksLOS(t: SfrTemplate): boolean {
  return t.fuelCell || t.irradiator || t.reflector !== null;
}

export function createsCluster(t: SfrTemplate): boolean {
  return t.fuelCell || t.irradiator || t.neutronShield !== null;
}

/** Java `Block.isCasing()` — explicit casing *or* a port. */
export function isCasing(t: SfrTemplate): boolean {
  return t.casing || t.port !== null;
}

export interface SfrConfig {
  readonly configuration: Configuration;
  readonly settings: SfrSettings;
  readonly templates: readonly SfrTemplate[];
  /** identity → template (first definition wins, mirroring Java's list order). */
  readonly byIdentity: ReadonlyMap<string, SfrTemplate>;
  findByIdentity(identity: string): SfrTemplate | undefined;
}

function fuelStatsFrom(raw: RawElement): SfrFuelStats {
  const m = moduleOf(raw, M.fuelStats);
  return {
    // `efficiency` is declared `float` in FuelStatsModule; the other three are
    // `int`. Reading a JSON number as a double instead of a float is a real
    // fidelity bug (1 ULP here changes downstream rounding).
    efficiency: f(num(m, 'efficiency')),
    heat: num(m, 'heat'),
    time: num(m, 'time'),
    criticality: num(m, 'criticality'),
    selfPriming: bool(m, 'self_priming'),
  };
}

function irradiatorStatsFrom(raw: RawElement): SfrIrradiatorStats {
  const m = moduleOf(raw, M.irradiatorStats);
  // IrradiatorStatsModule declares BOTH fields as `float`.
  return { efficiency: f(num(m, 'efficiency')), heat: f(num(m, 'heat')) };
}

function makeTemplate(element: NCPFElement): SfrTemplate {
  const mods = element.modules;
  const moderatorModule = moduleOf({ modules: mods }, M.moderator);
  const reflectorModule = moduleOf({ modules: mods }, M.reflector);
  const shieldModule = moduleOf({ modules: mods }, M.neutronShield);
  const sourceModule = moduleOf({ modules: mods }, M.neutronSource);
  const heatsinkModule = moduleOf({ modules: mods }, M.heatsink);
  const ventModule = moduleOf({ modules: mods }, M.coolantVent);
  const portModule = moduleOf({ modules: mods }, M.port);

  const payloads = recipePayloads({ modules: mods });
  const fuels: SfrFuel[] = [];
  const irradiatorRecipes: SfrIrradiatorRecipe[] = [];
  for (const raw of payloads) {
    const elementKey = raw.type;
    const name = elementName(raw);
    if (hasModule(raw, M.fuelStats)) {
      const fuel: SfrFuel = {
        key: `fuel=${name}`,
        name,
        identity: raw.type + '|' + name,
        displayName: displayNameOf(raw),
        stats: fuelStatsFrom(raw),
      };
      fuels.push(fuel);
    } else if (hasModule(raw, M.irradiatorStats)) {
      irradiatorRecipes.push({
        key: `irradiatorRecipe=${name}`,
        name,
        identity: `${elementKey}|${name}`,
        displayName: displayNameOf(raw),
        stats: irradiatorStatsFrom(raw),
      });
    }
  }

  return {
    element,
    identity: element.definition.identity,
    name: element.definition.name,
    displayName: element.displayName,
    conductor: hasModule({ modules: mods }, M.conductor),
    casing: hasModule({ modules: mods }, M.casing),
    controller: hasModule({ modules: mods }, M.controller),
    fuelCell: hasModule({ modules: mods }, M.fuelCell),
    irradiator: hasModule({ modules: mods }, M.irradiator),
    coolantVent: ventModule ? { output: bool(ventModule, 'output') } : null,
    port: portModule ? { output: bool(portModule, 'output') } : null,
    moderator: moderatorModule
      ? {
          flux: num(moderatorModule, 'flux'),
          efficiency: f(num(moderatorModule, 'efficiency')),
        }
      : null,
    reflector: reflectorModule
      ? {
          efficiency: f(num(reflectorModule, 'efficiency')),
          reflectivity: f(num(reflectorModule, 'reflectivity')),
        }
      : null,
    neutronShield: shieldModule
      ? {
          heatPerFlux: num(shieldModule, 'heat_per_flux'),
          efficiency: f(num(shieldModule, 'efficiency')),
          closed:
            shieldModule.closed !== null &&
            typeof shieldModule.closed === 'object' &&
            !Array.isArray(shieldModule.closed)
              ? (shieldModule.closed as RawElement)
              : undefined,
        }
      : null,
    neutronSource: sourceModule ? { efficiency: f(num(sourceModule, 'efficiency')) } : null,
    heatsink: heatsinkModule
      ? { cooling: num(heatsinkModule, 'cooling'), rules: parseRules(heatsinkModule.rules) }
      : null,
    fuels,
    irradiatorRecipes,
    toggled: null,
    unToggled: null,
  };
}

function elementName(raw: RawElement): string {
  if (raw.type === 'legacy_recipe') return legacyRecipeName(raw);
  if (raw.type === 'list') {
    const elements = Array.isArray(raw.elements) ? (raw.elements as RawElement[]) : [];
    return elements.map((e) => stackToString(e)).join(', ');
  }
  if (typeof raw.name === 'string') return raw.name;
  if (typeof raw.oredict === 'string') return raw.oredict;
  return '';
}

/**
 * Java `NCPFLegacyRecipeElement.getName()` — `[in*1, …]->[out*1, …]`, with the
 * input and output lists sorted. The amounts matter: they are part of the
 * recipe's identity in the golden dataset, so a missing `*1` makes every
 * irradiator/heater recipe unresolvable.
 */
export function legacyRecipeName(raw: RawElement): string {
  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? (v as RawElement[]).map((s) => stackToString(s)) : [];
  const inputs = strings(raw.inputs).sort();
  const outputs = strings(raw.outputs).sort();
  return `[${inputs.join(', ')}]->[${outputs.join(', ')}]`;
}

function displayNameOf(raw: RawElement): string {
  const m = moduleOf(raw, COMMON_MODULE.displayName);
  const name = m?.display_name;
  return typeof name === 'string' ? name : elementName(raw);
}

function settingsFrom(configuration: Configuration): SfrSettings {
  const m = settingsOf(configuration, M.settings);
  return {
    minSize: num(m, 'min_size', 1),
    maxSize: num(m, 'max_size', 24),
    neutronReach: num(m, 'neutron_reach', 4),
    coolingEfficiencyLeniency: num(m, 'cooling_efficiency_leniency', 10),
    // Java declares these `float`; narrow so downstream arithmetic matches.
    sparsityPenaltyMultiplier: f(num(m, 'sparsity_penalty_multiplier', 0.5)),
    sparsityPenaltyThreshold: f(num(m, 'sparsity_penalty_threshold', 0.75)),
  };
}

/** Build the Overhaul SFR view over a parsed configuration. */
export function buildSfrConfig(configuration: Configuration): SfrConfig {
  const templates = configuration.blocks.map((e) => makeTemplate(e));
  const byIdentity = new Map<string, SfrTemplate>();
  for (const t of templates) if (!byIdentity.has(t.identity)) byIdentity.set(t.identity, t);

  // Resolve `toggled` / `unToggled` the way Java's `setLocalReferences` does.
  for (const t of templates) {
    const closed = t.neutronShield?.closed;
    if (!closed) continue;
    const other = byIdentity.get(definitionIdentity(closed));
    if (!other) continue;
    t.toggled = other;
    other.unToggled = t;
  }

  return {
    configuration,
    settings: settingsFrom(configuration),
    templates,
    byIdentity,
    findByIdentity(identity: string) {
      return byIdentity.get(identity);
    },
  };
}
