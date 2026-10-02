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
import { legacyRecipeName } from '../sfr/config.js';

/**
 * `nuclearcraft:overhaul_msr` — the Overhaul MSR ("molten salt reactor") view.
 *
 * MSR shares the SFR vocabulary (moderators, reflectors, shields, irradiators)
 * but adds three block kinds and one nested structure:
 *
 *  - **fuel vessel** (`fuel_vessel`) instead of a fuel cell. Vessels are grouped
 *    by `OverhaulMSR.VesselGroup`, a 4-adjacency flood fill over blocks with the
 *    *same template and the same `Fuel` object* (Java `Block.isEqual` →
 *    `NCPFElementDefinition.matches` on the definition, plus `newBlock.fuel==start.fuel`).
 *    The group carries the neutron flux and the criticality, not the block.
 *  - **heater** (`heater`) — a cooling block whose recipe supplies the cooling.
 *  - **recipe ports** (`recipe_ports` + `port`): a "port" block only carries the
 *    recipe; the real block (vessel / heater / irradiator) is linked to it through
 *    `recipe_ports` (Java `BlockElement.parent`).
 *
 * Field kinds come from `packages/ncpf/src/moduleSchema.ts`, which mirrors the
 * Java module declarations (`planner/ncpf/module/overhaulMSR/*.java`):
 * `fuel_stats.time` is a **float** for MSR (an `int` for SFR), and
 * `heater_stats.cooling` is an `int` — see `docs/r1/float-fidelity.md` rule 1.
 */

/** `nuclearcraft:overhaul_msr` */
export const MSR_CONFIG_ID = 'nuclearcraft:overhaul_msr';

const M = modulesOf(MSR_CONFIG_ID);

export interface MsrSettings {
  readonly minSize: number;
  readonly maxSize: number;
  readonly neutronReach: number;
  readonly coolingEfficiencyLeniency: number;
  /** Java `float`. */
  readonly sparsityPenaltyMultiplier: number;
  /** Java `float`. */
  readonly sparsityPenaltyThreshold: number;
}

export interface MsrFuelStats {
  /** Java `float`. */
  readonly efficiency: number;
  readonly heat: number;
  /** Java `float` (MSR only — SFR declares `time` as an `int`). */
  readonly time: number;
  readonly criticality: number;
  readonly selfPriming: boolean;
}

export interface MsrFuel {
  /** Dataset / project key: `<fieldName>=<definition name>` for golden records. */
  readonly key: string;
  readonly name: string;
  readonly identity: string;
  readonly displayName: string;
  readonly stats: MsrFuelStats;
}

export interface MsrHeaterStats {
  readonly cooling: number;
}

export interface MsrHeaterRecipe {
  readonly key: string;
  readonly name: string;
  readonly identity: string;
  readonly displayName: string;
  readonly stats: MsrHeaterStats;
  /**
   * The recipe's *own* `blocksLos`-style outputs, used by the statistics pass.
   * `undefined` when the recipe is declared as a plain legacy fluid rather than
   * as a legacy recipe (Java guards on `NCPFLegacyRecipeElement`, see
   * `OverhaulMSR.java:477`).
   */
  readonly outputs: readonly MsrElementStack[] | undefined;
  /** `BlockRulesModule` on the recipe itself (`AbstractBlock.getRules()` step 2). */
  readonly rules: readonly PlacementRule[];
}

export interface MsrElementStack {
  readonly identity: string;
  /** Java `NCPFElementStack.amount`, accumulated in `float` by the stats pass. */
  amount: number;
}

export interface MsrIrradiatorStats {
  /** Java `float`. */
  readonly efficiency: number;
  /** Java `float`. */
  readonly heat: number;
}

export interface MsrIrradiatorRecipe {
  readonly key: string;
  readonly name: string;
  readonly identity: string;
  readonly displayName: string;
  readonly stats: MsrIrradiatorStats;
  readonly rules: readonly PlacementRule[];
}

export interface MsrModerator {
  readonly flux: number;
  /** Java `float`. */
  readonly efficiency: number;
}

export interface MsrReflector {
  /** Java `float`. */
  readonly efficiency: number;
  /** Java `float`. */
  readonly reflectivity: number;
}

export interface MsrNeutronShield {
  readonly heatPerFlux: number;
  /** Java `float`. */
  readonly efficiency: number;
  /** Raw `closed` reference, resolved to `toggled` after all templates are built. */
  readonly closed: RawElement | undefined;
}

export interface MsrNeutronSource {
  /** Java `float`. */
  readonly efficiency: number;
}

export interface MsrPort {
  readonly output: boolean;
}

export interface MsrRecipePorts {
  readonly input: RawElement | undefined;
  readonly output: RawElement | undefined;
}

/**
 * A block template: the Java `plannerator.ncpf.configuration.overhaulMSR.BlockElement`,
 * reduced to what the physics reads. Fields mirror the Java field names so the
 * mapping table in `docs/r1/r1.6-msr-turbine.md` can be read directly.
 */
export interface MsrTemplate {
  readonly element: NCPFElement;
  readonly identity: string;
  readonly name: string;
  readonly displayName: string;
  readonly conductor: boolean;
  readonly casing: MsrCasing | null;
  readonly controller: boolean;
  readonly fuelVessel: boolean;
  readonly irradiator: boolean;
  readonly heater: MsrHeater | null;
  readonly moderator: MsrModerator | null;
  readonly reflector: MsrReflector | null;
  readonly neutronShield: MsrNeutronShield | null;
  readonly neutronSource: MsrNeutronSource | null;
  readonly port: MsrPort | null;
  readonly recipePorts: MsrRecipePorts | null;
  readonly fuels: readonly MsrFuel[];
  readonly heaterRecipes: readonly MsrHeaterRecipe[];
  readonly irradiatorRecipes: readonly MsrIrradiatorRecipe[];
  /** Java `BlockElement.toggled` / `unToggled` (neutron shields, recipe ports). */
  toggled: MsrTemplate | null;
  unToggled: MsrTemplate | null;
  /** Java `BlockElement.parent` — the real block a port stands for. */
  parent: MsrTemplate | null;
}

export interface MsrCasing {
  readonly edge: boolean;
}

export interface MsrHeater {
  readonly rules: readonly PlacementRule[];
}

/** Java `BlockElement.blocksLOS()` (`overhaulMSR/BlockElement.java:54`). */
export function msrBlocksLOS(t: MsrTemplate): boolean {
  return t.fuelVessel || t.irradiator || t.reflector !== null;
}

/** Java `BlockElement.createsCluster()` (`overhaulMSR/BlockElement.java:57`). */
export function msrCreatesCluster(t: MsrTemplate): boolean {
  return t.fuelVessel || t.irradiator || t.neutronShield !== null;
}

/** Java `Block.isCasing()` — explicit casing *or* a port. */
export function msrIsCasing(t: MsrTemplate): boolean {
  return t.casing !== null || t.port !== null;
}

export interface MsrConfig {
  readonly configuration: Configuration;
  readonly settings: MsrSettings;
  readonly templates: readonly MsrTemplate[];
  /** identity → template (first definition wins, mirroring Java's list order). */
  readonly byIdentity: ReadonlyMap<string, MsrTemplate>;
  findByIdentity(identity: string): MsrTemplate | undefined;
}

function fuelStatsFrom(raw: RawElement): MsrFuelStats {
  const m = moduleOf(raw, M.fuelStats);
  return {
    // `FuelStatsModule` (overhaulMSR) declares efficiency AND time as `float`;
    // reading either as a double changes downstream rounding.
    efficiency: f(num(m, 'efficiency')),
    heat: num(m, 'heat'),
    time: f(num(m, 'time')),
    criticality: num(m, 'criticality'),
    selfPriming: bool(m, 'self_priming'),
  };
}

function heaterStatsFrom(raw: RawElement): MsrHeaterStats {
  const m = moduleOf(raw, M.heaterStats);
  // `HeaterStatsModule.cooling` is an `int`.
  return { cooling: num(m, 'cooling') };
}

function irradiatorStatsFrom(raw: RawElement): MsrIrradiatorStats {
  const m = moduleOf(raw, M.irradiatorStats);
  // `IrradiatorStatsModule` declares BOTH fields as `float`.
  return { efficiency: f(num(m, 'efficiency')), heat: f(num(m, 'heat')) };
}

/**
 * A recipe payload's `BlockRulesModule` (Java `AbstractBlock.getRules()` step 2:
 * the *recipe's* rules are only consulted when the template has no rules module).
 */
function recipeRulesFrom(raw: RawElement, moduleName: string): readonly PlacementRule[] {
  return parseRules(moduleOf(raw, moduleName)?.rules);
}

function stackIdentity(raw: RawElement): string {
  // Java `NCPFElementStack.definition.toString()`; reuse the shared implementation.
  return definitionIdentity(raw);
}

/**
 * Java `NCPFLegacyRecipeElement.outputs`, or `undefined` when the recipe is not
 * a legacy recipe (a plain legacy fluid). The statistics pass only folds outputs
 * into `totalOutput` for the former (`OverhaulMSR.java:477`).
 */
function legacyRecipeOutputs(raw: RawElement): readonly MsrElementStack[] | undefined {
  if (raw.type !== 'legacy_recipe') return undefined;
  const outputs = raw.outputs;
  if (!Array.isArray(outputs)) return [];
  const out: MsrElementStack[] = [];
  for (const stack of outputs as RawElement[]) {
    if (stack === null || typeof stack !== 'object' || Array.isArray(stack)) continue;
    out.push({
      identity: stackIdentity(stack),
      amount: typeof stack.amount === 'number' ? stack.amount : 1,
    });
  }
  return out;
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
 * heater / irradiator recipe unresolvable.
 *
 * Identical to the Overhaul SFR implementation (one implementation per concept),
 * so it is reused rather than duplicated.
 */
export { legacyRecipeName };

function displayNameOf(raw: RawElement): string {
  const m = moduleOf(raw, COMMON_MODULE.displayName);
  const name = m?.display_name;
  return typeof name === 'string' ? name : elementName(raw);
}

function rawReference(v: unknown): RawElement | undefined {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as RawElement) : undefined;
}

function makeTemplate(element: NCPFElement): MsrTemplate {
  const mods = element.modules;
  const holder = { modules: mods };
  const casingModule = moduleOf(holder, M.casing);
  const heaterModule = moduleOf(holder, M.heater);
  const moderatorModule = moduleOf(holder, M.moderator);
  const reflectorModule = moduleOf(holder, M.reflector);
  const shieldModule = moduleOf(holder, M.neutronShield);
  const sourceModule = moduleOf(holder, M.neutronSource);
  const portModule = moduleOf(holder, M.port);
  const portsModule = moduleOf(holder, M.recipePorts);

  const payloads = recipePayloads(holder);
  const fuels: MsrFuel[] = [];
  const heaterRecipes: MsrHeaterRecipe[] = [];
  const irradiatorRecipes: MsrIrradiatorRecipe[] = [];
  for (const raw of payloads) {
    const name = elementName(raw);
    if (hasModule(raw, M.fuelStats)) {
      fuels.push({
        key: `fuel=${name}`,
        name,
        identity: `${raw.type}|${name}`,
        displayName: displayNameOf(raw),
        stats: fuelStatsFrom(raw),
      });
    } else if (hasModule(raw, M.heaterStats)) {
      heaterRecipes.push({
        key: `heaterRecipe=${name}`,
        name,
        identity: `${raw.type}|${name}`,
        displayName: displayNameOf(raw),
        stats: heaterStatsFrom(raw),
        outputs: legacyRecipeOutputs(raw),
        rules: recipeRulesFrom(raw, M.heater),
      });
    } else if (hasModule(raw, M.irradiatorStats)) {
      irradiatorRecipes.push({
        key: `irradiatorRecipe=${name}`,
        name,
        identity: `${raw.type}|${name}`,
        displayName: displayNameOf(raw),
        stats: irradiatorStatsFrom(raw),
        rules: recipeRulesFrom(raw, M.irradiator),
      });
    }
  }

  return {
    element,
    identity: element.definition.identity,
    name: element.definition.name,
    displayName: element.displayName,
    conductor: hasModule(holder, M.conductor),
    casing: casingModule ? { edge: bool(casingModule, 'edge') } : null,
    controller: hasModule(holder, M.controller),
    fuelVessel: hasModule(holder, M.fuelVessel),
    irradiator: hasModule(holder, M.irradiator),
    heater: heaterModule ? { rules: parseRules(heaterModule.rules) } : null,
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
          closed: rawReference(shieldModule.closed),
        }
      : null,
    neutronSource: sourceModule ? { efficiency: f(num(sourceModule, 'efficiency')) } : null,
    port: portModule ? { output: bool(portModule, 'output') } : null,
    recipePorts: portsModule
      ? { input: rawReference(portsModule.input), output: rawReference(portsModule.output) }
      : null,
    fuels,
    heaterRecipes,
    irradiatorRecipes,
    toggled: null,
    unToggled: null,
    parent: null,
  };
}

function settingsFrom(configuration: Configuration): MsrSettings {
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

/**
 * Build the Overhaul MSR view over a parsed configuration.
 *
 * `setLocalReferences` is mirrored in three steps, exactly like Java's
 * `BlockElement.setLocalReferences`:
 *  1. every `neutron_shield.closed` reference links `toggled`/`unToggled`
 *     (the referencing template is the **un**toggled one — see
 *     `NeutronShieldModule.setLocalReferences`);
 *  2. every `recipe_ports` pair links the input port's `toggled` to the output
 *     port and vice versa (`RecipePortsModule.setLocalReferences`);
 *  3. both port templates get `parent` = the template that owns the pair.
 */
export function buildMsrConfig(configuration: Configuration): MsrConfig {
  const templates = configuration.blocks.map((e) => makeTemplate(e));
  const byIdentity = new Map<string, MsrTemplate>();
  for (const t of templates) if (!byIdentity.has(t.identity)) byIdentity.set(t.identity, t);

  // 1. neutron shields
  for (const t of templates) {
    const closed = t.neutronShield?.closed;
    if (!closed) continue;
    const other = byIdentity.get(definitionIdentity(closed));
    if (!other) continue;
    t.toggled = other;
    other.unToggled = t;
  }

  // 2 + 3. recipe ports
  for (const t of templates) {
    const ports = t.recipePorts;
    if (!ports?.input || !ports.output) continue;
    const input = byIdentity.get(definitionIdentity(ports.input));
    const output = byIdentity.get(definitionIdentity(ports.output));
    if (!input || !output) continue;
    input.toggled = output;
    output.unToggled = input;
    input.parent = t;
    output.parent = t;
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
