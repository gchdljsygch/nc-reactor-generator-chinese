import {
  COMMON_MODULE,
  hasModule,
  moduleOf,
  modulesOf,
  num,
  recipePayloads,
  settingsOf,
  parseRules,
  type Configuration,
  type NCPFElement,
  type PlacementRule,
  type RawElement,
} from '@ncplanner/ncpf';
import { f } from '../float.js';

/** `nuclearcraft:underhaul_sfr` — the 1.12.2-era reactor family. */
export const USFR_CONFIG_ID = 'nuclearcraft:underhaul_sfr';

const M = modulesOf(USFR_CONFIG_ID);

export interface UsfrSettings {
  readonly minSize: number;
  readonly maxSize: number;
  readonly neutronReach: number;
  /** Java `float`. */
  readonly moderatorExtraPower: number;
  /** Java `float`. */
  readonly moderatorExtraHeat: number;
  readonly activeCoolerRate: number;
}

export interface UsfrFuelStats {
  /** Java `float`. */
  readonly power: number;
  /** Java `float`. */
  readonly heat: number;
  readonly time: number;
}

export interface UsfrFuel {
  readonly key: string;
  readonly name: string;
  readonly identity: string;
  readonly displayName: string;
  readonly stats: UsfrFuelStats;
}

export interface UsfrCooler {
  readonly cooling: number;
  readonly rules: readonly PlacementRule[];
}

export interface UsfrActiveCoolerRecipe {
  readonly key: string;
  readonly name: string;
  readonly identity: string;
  readonly displayName: string;
  readonly cooler: UsfrCooler;
}

export interface UsfrTemplate {
  readonly element: NCPFElement;
  readonly identity: string;
  readonly name: string;
  readonly displayName: string;
  readonly casing: boolean;
  readonly controller: boolean;
  readonly fuelCell: boolean;
  readonly moderator: boolean;
  readonly cooler: UsfrCooler | null;
  readonly activeCooler: boolean;
  readonly activeCoolerRecipes: readonly UsfrActiveCoolerRecipe[];
}

export interface UsfrConfig {
  readonly configuration: Configuration;
  readonly settings: UsfrSettings;
  readonly templates: readonly UsfrTemplate[];
  readonly byIdentity: ReadonlyMap<string, UsfrTemplate>;
  /** Java `UnderhaulSFRConfiguration.fuels` — the default reactor fuel is the first. */
  readonly fuels: readonly UsfrFuel[];
  findByIdentity(identity: string): UsfrTemplate | undefined;
}

function coolerFrom(raw: { modules?: Record<string, unknown> } | undefined, moduleName: string): UsfrCooler | null {
  const m = moduleOf(raw as { modules?: never }, moduleName);
  if (!m) return null;
  return { cooling: num(m, 'cooling'), rules: parseRules(m.rules) };
}

function fuelFrom(element: NCPFElement): UsfrFuel {
  const stats = moduleOf({ modules: element.modules }, M.fuelStats);
  return {
    key: `recipe=${element.definition.name}`,
    name: element.definition.name,
    identity: `${element.definition.type}|${element.definition.identity}`,
    displayName: element.displayName,
    stats: {
      // FuelStatsModule: power/heat are `float`, time is `int`.
      power: f(num(stats, 'power')),
      heat: f(num(stats, 'heat')),
      time: num(stats, 'time'),
    },
  };
}

function makeTemplate(element: NCPFElement): UsfrTemplate {
  const mods = element.modules;
  const payloads = recipePayloads({ modules: mods });
  const recipes: UsfrActiveCoolerRecipe[] = [];
  for (const raw of payloads) {
    const cooler = coolerFrom(raw, M.cooler);
    if (!cooler) continue;
    const name = typeof raw.name === 'string' ? raw.name : '';
    recipes.push({
      key: `recipe=${name}`,
      name,
      identity: `${raw.type}|${name}`,
      displayName: displayNameOf(raw),
      cooler,
    });
  }
  return {
    element,
    identity: element.definition.identity,
    name: element.definition.name,
    displayName: element.displayName,
    casing: hasModule({ modules: mods }, M.casing),
    controller: hasModule({ modules: mods }, M.controller),
    fuelCell: hasModule({ modules: mods }, M.fuelCell),
    moderator: hasModule({ modules: mods }, M.moderator),
    cooler: coolerFrom({ modules: mods }, M.cooler),
    activeCooler: hasModule({ modules: mods }, M.activeCooler),
    activeCoolerRecipes: recipes,
  };
}

function displayNameOf(raw: RawElement): string {
  const m = moduleOf(raw, COMMON_MODULE.displayName);
  const name = m?.display_name;
  return typeof name === 'string' ? name : typeof raw.name === 'string' ? raw.name : '';
}

function settingsFrom(configuration: Configuration): UsfrSettings {
  const m = settingsOf(configuration, `${USFR_CONFIG_ID}_configuration_settings`);
  return {
    minSize: num(m, 'min_size', 1),
    maxSize: num(m, 'max_size', 24),
    neutronReach: num(m, 'neutron_reach', 4),
    moderatorExtraPower: f(num(m, 'moderator_extra_power')),
    moderatorExtraHeat: f(num(m, 'moderator_extra_heat')),
    activeCoolerRate: num(m, 'active_cooler_rate'),
  };
}

export function buildUsfrConfig(configuration: Configuration): UsfrConfig {
  const templates = configuration.blocks.map((e) => makeTemplate(e));
  const byIdentity = new Map<string, UsfrTemplate>();
  for (const t of templates) if (!byIdentity.has(t.identity)) byIdentity.set(t.identity, t);
  const fuels = (configuration.lists.get('fuels') ?? []).map((e) => fuelFrom(e));
  return {
    configuration,
    settings: settingsFrom(configuration),
    templates,
    byIdentity,
    fuels,
    findByIdentity(identity: string) {
      return byIdentity.get(identity);
    },
  };
}
