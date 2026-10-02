/**
 * LegacyNCPF **v11** reader — a port of
 * `src/net/ncplanner/plannerator/planner/file/reader/LegacyNCPF11Reader.java`
 * (1379 lines; bare `:NNN` references below are to that frozen file).
 *
 * A v11 save is a `config2` stream (see `config2Cursor.ts`):
 *
 * ```
 * Config header      { version: 11, count: N, [metadata: {...}] }
 * Config config      { partial, addon, name, version, underhaulVersion, underhaul, overhaul, addons }
 * Config multiblock  x N  { id: 0..4, dimensions, blocks, … }
 * ```
 *
 * `read` converts that into the **NCPF JSON tree the frozen Java code would have
 * written** (`FormatGolden` → `NCPFFileWriter` → `JSONNCPFWriter`).
 *
 * ## How the Java object graph maps onto JSON (the parts that are easy to get wrong)
 *
 * The golden comes from `FileReader.read`, which returns `project.copyTo(Project::new)`
 * — a serialise/deserialise round trip — and then serialises *that*. Only two
 * properties of the round trip are observable in the JSON, and both are
 * reproduced here rather than by emulating the whole graph:
 *
 *  1. **Textures are dropped.** `Bootstrap` sets `plannerator.skipTextures=true`,
 *     so `TextureModule.convertFromObject` returns early and the copied project
 *     always has `texture == null`; `convertToObject` then writes an *empty*
 *     `plannerator:texture` module (`TextureModule.java:18-25`). Every element
 *     built here therefore gets `plannerator:texture: {}` and the `texture`
 *     number list in the file is never decoded.
 *  2. **`NamedTexturedNCPFElement` always carries `plannerator:display_name` and
 *     `plannerator:texture`**, even with no name: the modules are fields
 *     (non-null), and `DisplayNameModule.convertToObject` removes the
 *     `display_name` key when the value is null, leaving `{}`
 *     (`NCPFObject.set` never stores nulls).
 *
 * The module container is serialised *wholesale*, and the per-module
 * `definedPlanneratorRecipes` only *replace* `ncpf:block_recipes` when their
 * element list is non-empty (`DefinedNCPFModularObject.setRecipes`, `:96-106`).
 * That is why a recipe port keeps its parent's recipes in the output even though
 * the port has no fuel-cell module of its own.
 *
 * ## Deliberate deviations (all reported in the task result)
 *
 *  - **Float formatting.** Java writes `Float` values through
 *    `JSON.JSONObject.write` → `Float.toString` (`JSON.java:236-237`), i.e. the
 *    shortest decimal that round-trips the *32-bit float*. The goldens were made
 *    with JDK 25, whose `Float.toString` does exactly that; {@link javaFloat}
 *    reproduces it and returns the double `JSON.parse` yields for it, which is
 *    what structural equality compares. `Double` values need no treatment.
 *  - **`metadata: 0` is kept.** `NCPFLegacyBlockElement(String)` parses a
 *    `name:<digits>` suffix into `metadata`, so the field is an `Integer` and
 *    `convertToObject` writes `"metadata": 0` (only a *null* removes the key).
 *    `types.ts`'s `legacyElement` drops a 0 metadata, so definitions are built
 *    here instead.
 *  - **Byte reads.** `ConfigObject.getByte` (like the rest of `config2.ts`) is
 *    more permissive than Java's `Byte`-only unboxing: a file that stores an
 *    `int` where Java expects a `byte` throws a `ClassCastException` in Java and
 *    is accepted here.
 *  - **`legacy_recipe` identity.** `NCPFSettingsElement.matches` compares the
 *    `inputs`/`outputs` sets by looping `instanceof NCPFElementDefinition`, which
 *    is never true for an `NCPFElementStack`, so it clears `equal`
 *    (`NCPFSettingsElement.java:186-210`). Two `legacy_recipe` definitions
 *    therefore only match when all four sets are empty. That quirk is reproduced
 *    because it decides whether a coolant recipe is appended or merged during
 *    conglomeration, and whether a design's `coolant_recipe` index survives
 *    `NCPFObject.indexof`.
 *  - **GUI recovery is not ported.** `RecoveryModeHandler.recoverFallbackID` can
 *    consult `Core.project` through a dialog; the golden run uses
 *    `FileReader.defaultRecoveryHandler` (`NonRecoveryHandler`, `:10-13`), which
 *    is a bounds-checked `list.get(idx)` that throws otherwise. Only that exists
 *    here.
 *  - **Fusion multiblocks cannot be read at all** — Java's
 *    `readMultiblockOverhaulFusionReactor` indexes `new int[0]` (`:339`) and
 *    always throws `ArrayIndexOutOfBoundsException`. That is reproduced as a
 *    thrown {@link LegacyFormatError} instead of a best-effort conversion, so a
 *    broken input stays visibly broken (`fusion_test.ncpf` is out of scope).
 *  - **Addon-copied blocks and design recipes.** Java's design readers recover
 *    recipe elements from the *conglomeration* block (`block.fuels`), whose lists
 *    are rebuilt from `ncpf:block_recipes` for copied addon blocks. Copies are
 *    not tracked here; for a conglomeration block that came from an addon the
 *    recovery falls back to the block's `ncpf:block_recipes` list (documented in
 *    {@link recipeListsOf}). No acceptance fixture has an overhaul design, so this
 *    path is untested against the oracle.
 */
import { ConfigList, ConfigNumberList, ConfigObject } from '../config2.js';
import { isJsonObject, type JsonObject, type JsonValue } from '../json.js';
import {
  cloneJson,
  element,
  LegacyFormatError,
  type LegacyFormatReader,
  type LegacyInput,
  type LegacyReadResult,
} from './types.js';
import { Config2Stream } from './config2Cursor.js';

// --------------------------------------------------------------- module names

const DISPLAY_NAME = 'plannerator:display_name';
const TEXTURE = 'plannerator:texture';
const LEGACY_NAMES = 'plannerator:legacy_names';
const BLOCK_RECIPES = 'ncpf:block_recipes';
const METADATA = 'plannerator:metadata';
const CONFIG_METADATA = 'plannerator:configuration_metadata';
const AIR = 'minecraft:air';

const UH = 'nuclearcraft:underhaul_sfr';
const SFR = 'nuclearcraft:overhaul_sfr';
const MSR = 'nuclearcraft:overhaul_msr';
const TURBINE = 'nuclearcraft:overhaul_turbine';
const FUSION = 'plannerator:fusion_test';

/** Configuration key → the element lists that configuration always serialises. */
const CONFIGURATION_LISTS: Readonly<Record<string, readonly string[]>> = {
  [UH]: ['blocks', 'fuels'],
  [SFR]: ['blocks', 'coolant_recipes'],
  [MSR]: ['blocks'],
  [TURBINE]: ['blocks', 'recipes'],
  [FUSION]: ['blocks', 'coolant_recipes', 'recipes'],
};

// ------------------------------------------------------- placement rule tables

/**
 * `ruleTypes` (`:1324-1331`): the v11 rule byte indexes this table. It is *not*
 * the v10 numbering — see `ncpf10.ts`.
 */
const RULE_TYPES = ['between', 'axial', 'vertex', 'edge', 'or', 'and'] as const;

/**
 * The `blockTypes` arrays (`:1332-1378`). A rule byte of 0 means "the first
 * entry"; for everything but the turbine that is air. The fusion array really
 * does list the heatsink module twice.
 */
const UNDERHAUL_BLOCK_TYPES = [AIR, `${UH}:casing`, `${UH}:cooler`, `${UH}:fuel_cell`, `${UH}:moderator`];
const OVERHAUL_SFR_BLOCK_TYPES = [
  AIR,
  `${SFR}:casing`,
  `${SFR}:heat_sink`,
  `${SFR}:fuel_cell`,
  `${SFR}:moderator`,
  `${SFR}:reflector`,
  `${SFR}:neutron_shield`,
  `${SFR}:irradiator`,
  `${SFR}:conductor`,
];
const OVERHAUL_MSR_BLOCK_TYPES = [
  AIR,
  `${MSR}:casing`,
  `${MSR}:heater`,
  `${MSR}:fuel_vessel`,
  `${MSR}:moderator`,
  `${MSR}:reflector`,
  `${MSR}:neutron_shield`,
  `${MSR}:irradiator`,
  `${MSR}:conductor`,
];
const OVERHAUL_TURBINE_BLOCK_TYPES = [`${TURBINE}:casing`, `${TURBINE}:coil`, `${TURBINE}:bearing`, `${TURBINE}:connector`];
const OVERHAUL_FUSION_BLOCK_TYPES = [
  AIR,
  `${FUSION}:toroidal_electromagnet`,
  `${FUSION}:poloidal_electromagnet`,
  `${FUSION}:heating_blanket`,
  `${FUSION}:breeding_blanket`,
  `${FUSION}:reflector`,
  `${FUSION}:heatsink`,
  `${FUSION}:heatsink`, // yes, twice — verbatim from the Java table
  `${FUSION}:conductor`,
  `${FUSION}:connector`,
];

/**
 * One of the five Java post-load maps. The rule JSON object is created before its
 * target is known, exactly like the Java `NCPFPlacementRule`.
 *
 * Exported for `ncpf02.ts`, whose `readGenericRuleNcpf2` is handed the map
 * directly (`LegacyNCPF2Reader.java:52`) instead of going through
 * `readUnderRule` &c.
 */
export interface RuleState {
  readonly postLoad: Map<JsonObject, number>;
  readonly postNames: Map<JsonObject, string>;
  readonly blockTypes: readonly string[];
  /** What a rule index of 0 resolves to (`:481-540`). */
  readonly zeroTarget: string;
  /** Which configuration's `blocks` list the indices refer to. */
  readonly blockConfig: string;
}

// ------------------------------------------------------------------ formatting

/**
 * Java `Float.toString` semantics: the shortest decimal that rounds back to the
 * same 32-bit float (JDK ≥ 19). Returns the double that `JSON.parse` produces
 * from that decimal — which is what the golden holds.
 */
export function javaFloat(value: number): number {
  const f = Math.fround(value);
  if (f === 0 || !Number.isFinite(f)) return f; // keeps -0.0
  for (let precision = 1; precision <= 9; precision++) {
    const text = f.toPrecision(precision);
    const parsed = Number(text);
    if (Math.fround(parsed) === f) return parsed;
  }
  return Number(f.toPrecision(9));
}

/** Java `MathUtil.makeIntegerRatio(float, float)` (`MathUtil.java:210-222`). */
export function makeIntegerRatio(a: number, b: number): [number, number] {
  const multiplier = 10_000_000;
  // `a * multiplier` promotes the long to float, so the multiply happens in float.
  const scaledA = javaRoundFloat(Math.fround(Math.fround(a) * multiplier));
  const scaledB = javaRoundFloat(Math.fround(Math.fround(b) * multiplier));
  const divisor = gcd(Math.abs(scaledA), Math.abs(scaledB));
  return [Math.trunc(scaledA / divisor), Math.trunc(scaledB / divisor)];
}

/** Java `Math.round(float)` = `(int) Math.floor(a + 0.5f)`. */
function javaRoundFloat(value: number): number {
  return Math.floor(Math.fround(value + 0.5));
}

function gcd(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y !== 0) {
    const remainder = x % y;
    x = y;
    y = remainder;
  }
  return x;
}

// ------------------------------------------------------- NCPF element builders

/** `plannerator:display_name` — `{display_name}` or `{}` when the name is null. */
function displayNameModule(displayName: string | null): JsonObject {
  return displayName === null ? {} : { display_name: displayName };
}

/**
 * `plannerator:legacy_names` (`LegacyNamesModule.java:12`). Only created when the
 * source configuration had a `legacyNames` list: Java calls `withModuleOrCreate`
 * inside the loop, so an empty list creates no module.
 */
function legacyNamesModule(names: readonly string[]): JsonObject {
  return { legacy_names: [...names] };
}

/**
 * The module bag of a `NamedTexturedNCPFElement`: `display_name` and `texture`
 * are always present, `legacy_names` only when the file had one.
 */
export function namedModules(displayName: string | null, legacyNames: readonly string[] | null): JsonObject {
  const modules: JsonObject = {};
  modules[DISPLAY_NAME] = displayNameModule(displayName);
  modules[TEXTURE] = {};
  if (legacyNames !== null) modules[LEGACY_NAMES] = legacyNamesModule(legacyNames);
  return modules;
}

/**
 * `NCPFLegacyBlockElement` (`NCPFLegacyBlockElement.java:19-27`): a `name:<digits>`
 * suffix is split off into `metadata`, which is therefore *present* (possibly 0)
 * even though the name itself has been truncated.
 */
export function legacyBlockDefinition(name: string): JsonObject {
  const definition: JsonObject = { name, type: 'legacy_block' };
  const match = /:(\d+)$/.exec(name);
  if (match !== null) {
    const metadata = Number.parseInt(match[1]!, 10);
    definition.metadata = metadata;
    definition.name = name.slice(0, name.length - String(metadata).length - 1);
  }
  return definition;
}

/** `NCPFLegacyItemElement` (`NCPFLegacyItemElement.java:16-24`) — the same metadata rule. */
export function legacyItemDefinition(name: string): JsonObject {
  const definition: JsonObject = { name, type: 'legacy_item' };
  const match = /:(\d+)$/.exec(name);
  if (match !== null) {
    const metadata = Number.parseInt(match[1]!, 10);
    definition.metadata = metadata;
    definition.name = name.slice(0, name.length - String(metadata).length - 1);
  }
  return definition;
}

/** `NCPFLegacyFluidElement(String)` rejects a namespaced name (`:11-13`). */
export function legacyFluidDefinition(name: string): JsonObject {
  if (name.includes(':')) {
    throw new LegacyFormatError(`NCPFLegacyFluidElement must not be namespaced! (${name})`);
  }
  return { name, type: 'legacy_fluid' };
}

/** `NCPFModuleElement` — the `{"type":"module","name":…}` reference form. */
function moduleDefinition(name: string): JsonObject {
  return { type: 'module', name };
}

/** `NCPFLegacyRecipeElement` (`NCPFLegacyRecipeElement.java:12-16`). */
export function legacyRecipeDefinition(inputs: readonly JsonObject[], outputs: readonly JsonObject[]): JsonObject {
  return { type: 'legacy_recipe', inputs: [...inputs], outputs: [...outputs] };
}

/** `NCPFElementStack.convertToObject` (`NCPFElementStack.java:32-39`). */
export function elementStack(definition: JsonObject, amount: number): JsonObject {
  // `canHaveAmount()` is true for every definition this reader produces.
  return { ...definition, amount };
}

/** An NCPF element: the definition fields at the top level plus its module bag. */
export function legacyElementJson(definition: JsonObject, modules: JsonObject): JsonObject {
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(definition)) out[key] = value;
  // `name` is a *setting* of the legacy block/item/fluid elements, not of every
  // definition: `NCPFLegacyRecipeElement` has no `name` setting, so
  // `NCPFElement.convertToObject` writes no `name` key for a coolant recipe.
  out.modules = modules;
  return out;
}

/** The reference/design form of an element — `NCPFElementReference.convertToObject`. */
export function definitionOf(elementJson: JsonObject): JsonObject {
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(elementJson)) {
    if (key === 'modules') continue;
    out[key] = value;
  }
  return out;
}

export function modulesOf(elementJson: JsonObject): JsonObject {
  const modules = elementJson.modules;
  return isJsonObject(modules) ? modules : {};
}

/** Java `NCPFModuleContainer.setModule` ignores nulls. */
export function setModuleIfPresent(elementJson: JsonObject, name: string, module: JsonObject): void {
  modulesOf(elementJson)[name] = module;
}

/** The `rules` array currently on a turbine module, if any. */
function turbineRules(module: JsonObject): JsonValue[] {
  return Array.isArray(module.rules) ? (module.rules as JsonValue[]) : [];
}

/** The JSON object stored at module `name`, or `null` when it is absent/not an object. */
function moduleIfObject(elementJson: JsonObject, name: string): JsonObject | null {
  const value = modulesOf(elementJson)[name];
  return isJsonObject(value) ? value : null;
}

/** `ConfigurationMetadataModule.convertToObject` writes a key only when it is set. */
function writeDisplayName(elementJson: JsonObject, displayName: string | null): void {
  if (displayName === null) return;
  const module = modulesOf(elementJson)[DISPLAY_NAME];
  if (isJsonObject(module)) module.display_name = displayName;
}

// --------------------------------------------- definition identity (`matches()`)

/**
 * Java `NCPFElementDefinition.matches` for the definition kinds this reader
 * produces — see the module header for the `legacy_recipe` quirk.
 */
export function definitionsMatch(a: JsonObject, b: JsonObject): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'legacy_block':
      return (
        a.name === b.name &&
        scalarEqual(a.metadata, b.metadata) &&
        blockstateEqual(a.blockstate, b.blockstate) &&
        scalarEqual(a.nbt, b.nbt)
      );
    case 'legacy_item':
      return a.name === b.name && scalarEqual(a.metadata, b.metadata) && scalarEqual(a.nbt, b.nbt);
    case 'legacy_fluid':
    case 'module':
      return a.name === b.name;
    case 'legacy_recipe':
      // `NCPFSettingsElement.matches` clears `equal` for every non-empty stack
      // set, so only recipes with empty inputs AND outputs can ever match.
      return emptyStacks(a.inputs) && emptyStacks(a.outputs) && emptyStacks(b.inputs) && emptyStacks(b.outputs);
    default:
      return false;
  }
}

function emptyStacks(value: JsonValue | undefined): boolean {
  return value === undefined || (Array.isArray(value) && value.length === 0);
}

function scalarEqual(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return Object.is(a, b);
}

function blockstateEqual(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  const left = isJsonObject(a) ? a : {};
  const right = isJsonObject(b) ? b : {};
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
    if (!Object.is(left[key], right[key])) return false;
  }
  return true;
}

/**
 * Java `NCPFLegacyBlockElement.toString()` — only used for the diagnostic
 * `postNames` map and for error messages.
 */
export function definitionToString(definition: JsonObject): string {
  const name = typeof definition.name === 'string' ? definition.name : '';
  const metadata = definition.metadata;
  const suffix = metadata === undefined ? '' : `:${String(metadata)}`;
  if (definition.type !== 'legacy_block') return `${name}${suffix}`;
  const state = isJsonObject(definition.blockstate) ? definition.blockstate : {};
  const keys = Object.keys(state).sort();
  if (keys.length === 0) return `${name}${suffix}`;
  return `${name}${suffix}[${keys.map((key) => `${key}=${String(state[key])}`).join(',')}]`;
}

// ----------------------------------------------------------- configuration view

interface AddonJson {
  readonly configuration: Map<string, JsonObject>;
  readonly metadata: JsonObject;
}

export interface ProjectJson {
  readonly configuration: Map<string, JsonObject>;
  readonly addons: AddonJson[];
  readonly designs: JsonObject[];
  readonly metadata: JsonObject;
}

/** The per-block recipe lists Java keeps as real fields on `BlockElement`. */
export interface RecipeLists {
  readonly coolers: JsonObject[];
  readonly fuels: JsonObject[];
  readonly irradiators: JsonObject[];
  readonly heaters: JsonObject[];
  readonly blankets: JsonObject[];
}

/** A fresh configuration with all of its (always-written) element lists. */
export function createConfiguration(key: string): JsonObject {
  const lists = CONFIGURATION_LISTS[key];
  if (lists === undefined) throw new LegacyFormatError(`Cannot set unrecognized configuration: ${key}!`);
  const config: JsonObject = {};
  for (const list of lists) config[list] = [];
  config.modules = { [CONFIG_METADATA]: {} };
  return config;
}

export function elementList(config: JsonObject, key: string): JsonObject[] {
  const value = config[key];
  if (!Array.isArray(value)) throw new LegacyFormatError(`configuration has no "${key}" list`);
  return value as JsonObject[];
}

export function configModules(config: JsonObject): JsonObject {
  const modules = config.modules;
  if (!isJsonObject(modules)) throw new LegacyFormatError('configuration has no modules');
  return modules;
}

/** Java `NCPFConfigurationContainer.withConfiguration` — only touches existing configs. */
export function withConfiguration(
  container: Map<string, JsonObject>,
  key: string,
  action: (config: JsonObject) => void,
): void {
  const config = container.get(key);
  if (config !== undefined) action(config);
}

export function setConfigurationMetadata(config: JsonObject, name: string | null, version: string | null): void {
  const metadata = configModules(config)[CONFIG_METADATA];
  if (!isJsonObject(metadata)) throw new LegacyFormatError('configuration metadata module missing');
  if (name !== null) metadata.name = name;
  if (version !== null) metadata.version = version;
}

/**
 * `DefinedNCPFObject.conglomerateElementList` (`DefinedNCPFObject.java:16-27`) and
 * `postLoadBlockFromIndex` (`:560-575`): main elements first, then every addon
 * element whose definition matches nothing added so far.
 */
function conglomerateList(main: readonly JsonObject[], addons: readonly (readonly JsonObject[])[]): JsonObject[] {
  const out: JsonObject[] = [...main];
  for (const addonList of addons) {
    for (const addonElement of addonList) {
      const definition = definitionOf(addonElement);
      let matched = false;
      for (const existing of out) {
        if (definitionsMatch(definitionOf(existing), definition)) {
          matched = true;
          break;
        }
      }
      if (!matched) out.push(addonElement);
    }
  }
  return out;
}

// ------------------------------------------------------------------- config2 IO

export function requireObject(config: ConfigObject, key: string): ConfigObject {
  const value = config.getObject(key);
  if (value === null) throw new LegacyFormatError(`config2: "${key}" is not an object`);
  return value;
}

export function requireList(config: ConfigObject, key: string): ConfigObject[] {
  const value = config.getList(key);
  if (value === null) throw new LegacyFormatError(`config2: "${key}" is not a list`);
  return configObjects(value);
}

/** Java `Config.getConfigList(key, new ConfigList())` — an absent key is an empty list. */
export function listOrEmpty(config: ConfigObject, key: string): ConfigObject[] {
  const value = config.getOr(key, new ConfigList());
  if (!(value instanceof ConfigList)) throw new LegacyFormatError(`config2: "${key}" is not a list`);
  return configObjects(value);
}

function configObjects(list: ConfigList): ConfigObject[] {
  return list.items.map((value, index) => {
    if (!(value instanceof ConfigObject)) {
      throw new LegacyFormatError(`config2: list entry ${index} is not a config`);
    }
    return value;
  });
}

function stringList(config: ConfigObject, key: string): string[] {
  const value = config.getList(key);
  if (value === null) throw new LegacyFormatError(`config2: "${key}" is not a list`);
  return value.items.map((entry, index) => {
    if (typeof entry !== 'string') throw new LegacyFormatError(`config2: "${key}"[${index}] is not a string`);
    return entry;
  });
}

export function numberList(config: ConfigObject, key: string): ConfigNumberList {
  const value = config.getConfigNumberList(key);
  if (value === null) throw new LegacyFormatError(`config2: "${key}" is not a number list`);
  return value;
}

/**
 * `MetadataModule.convertToObject` puts the metadata map straight into the module
 * object (the Java field is `HashMap<String,String>`, so anything else would
 * serialise as invalid JSON; every acceptance fixture has an empty map).
 */
function metadataToModule(config: ConfigObject): JsonObject {
  const module: JsonObject = {};
  for (const key of config.properties()) {
    const value = config.get(key);
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') module[key] = value;
    else if (typeof value === 'bigint') module[key] = Number(value);
  }
  return module;
}

// ------------------------------------------------------------------- per-block

function emptyRecipeLists(): RecipeLists {
  return { coolers: [], fuels: [], irradiators: [], heaters: [], blankets: [] };
}

// --------------------------------------------------------------------- reader

/**
 * LegacyNCPF v11 reader. `matches`/`read` are the interface; everything the v10
 * subclass overrides (`ncpf10.ts`) is `protected`.
 */
export class LegacyNCPF11Reader implements LegacyFormatReader {
  // Deliberately *not* literal types: every older version is a subclass that
  // re-declares these (`LegacyNCPF10Reader`, v9 … v1), and a literal type on the
  // base would make the derived declaration a TS2416 error.
  readonly name: string = 'LegacyNCPF11Reader';
  /** Mirrors `FileReader.formats`: NCPFReader first, then v11, then v10, … */
  readonly order: number = 1;

  protected readonly rules: Readonly<Record<string, RuleState>> = {
    [UH]: {
      postLoad: new Map(),
      postNames: new Map(),
      blockTypes: UNDERHAUL_BLOCK_TYPES,
      zeroTarget: AIR,
      blockConfig: UH,
    },
    [SFR]: {
      postLoad: new Map(),
      postNames: new Map(),
      blockTypes: OVERHAUL_SFR_BLOCK_TYPES,
      zeroTarget: AIR,
      blockConfig: SFR,
    },
    [MSR]: {
      postLoad: new Map(),
      postNames: new Map(),
      blockTypes: OVERHAUL_MSR_BLOCK_TYPES,
      zeroTarget: AIR,
      blockConfig: MSR,
    },
    [TURBINE]: {
      postLoad: new Map(),
      postNames: new Map(),
      blockTypes: OVERHAUL_TURBINE_BLOCK_TYPES,
      zeroTarget: `${TURBINE}:casing`,
      blockConfig: TURBINE,
    },
    [FUSION]: {
      postLoad: new Map(),
      postNames: new Map(),
      blockTypes: OVERHAUL_FUSION_BLOCK_TYPES,
      zeroTarget: AIR,
      blockConfig: FUSION,
    },
  };

  /**
   * The recipe lists of every block built from a *main* configuration (Java's
   * `BlockElement.fuels` &c.). They are not part of the JSON because Java rebuilds
   * them from `ncpf:block_recipes` when it deserialises.
   */
  protected readonly blockRecipes = new WeakMap<JsonObject, RecipeLists>();

  /** Turbine designs that referenced other designs (`:78`, `:104`). */
  protected readonly turbinePostLoadInputs = new Map<JsonObject, number[]>();

  /**
   * Non-fatal notes about places where this port deliberately does **not** copy
   * the frozen reader (each one is also documented at its call site). Java keeps
   * no equivalent — it either throws or silently corrupts its state there.
   */
  protected readonly notes: string[] = [];

  protected getTargetVersion(): number {
    return 11;
  }

  /**
   * Java `formatMatches` (`:58-70`): load the header and compare its `version`
   * byte. Every failure mode means "not my format".
   */
  matches(input: LegacyInput): boolean {
    try {
      const header = new Config2Stream(input.bytes, input.container).readConfig();
      return header.getOr('version', 0) === this.getTargetVersion();
    } catch {
      return false;
    }
  }

  /** Java `read` (`:84-117`). */
  read(input: LegacyInput): LegacyReadResult | null {
    const stream = new Config2Stream(input.bytes, input.container);
    const header = stream.readConfig();
    const multiblocks = header.getInt('count');
    const metadata: JsonObject = {};
    if (header.hasProperty('metadata')) {
      Object.assign(metadata, metadataToModule(requireObject(header, 'metadata')));
    }
    this.turbinePostLoadInputs.clear();
    this.notes.length = 0;

    const project: ProjectJson = { configuration: new Map(), addons: [], designs: [], metadata };
    this.loadConfiguration(project, stream.readConfig());
    for (let i = 0; i < multiblocks; i++) project.designs.push(this.readMultiblock(project, stream.readConfig()));
    if (this.turbinePostLoadInputs.size > 0) throw new LegacyFormatError('Not yet implemented.');
    return { raw: this.serialize(project), issues: [...this.notes] };
  }

  private serialize(project: ProjectJson): JsonObject {
    return {
      version: 1,
      addons: project.addons.map((addon) => ({
        configuration: configurationsToJson(addon.configuration),
        modules: { [METADATA]: addon.metadata },
      })),
      configuration: configurationsToJson(project.configuration),
      designs: project.designs,
      modules: { [METADATA]: project.metadata },
    };
  }

  // ------------------------------------------------------------- multiblocks

  /** `readMultiblock` (`:119-150`). */
  protected readMultiblock(project: ProjectJson, data: ConfigObject): JsonObject {
    const id = data.getInt('id');
    let design: JsonObject;
    switch (id) {
      case 0:
        design = this.readMultiblockUnderhaulSFR(project, data);
        break;
      case 1:
        design = this.readMultiblockOverhaulSFR(project, data);
        break;
      case 2:
        design = this.readMultiblockOverhaulMSR(project, data);
        break;
      case 3:
        design = this.readMultiblockOverhaulTurbine(project, data);
        break;
      case 4:
        this.readMultiblockOverhaulFusionReactor(project, data);
        throw new LegacyFormatError('fusion multiblock: the Java reader indexes an empty array here');
      default:
        throw new LegacyFormatError(`Unknown Multiblock ID: ${id}`);
    }
    if (data.hasProperty('metadata')) {
      const module = design.modules;
      if (isJsonObject(module) && isJsonObject(module[METADATA])) {
        Object.assign(module[METADATA], metadataToModule(requireObject(data, 'metadata')));
      }
    }
    return design;
  }

  /** `readMultiblockUnderhaulSFR` (`:152-183`). */
  protected readMultiblockUnderhaulSFR(project: ProjectJson, data: ConfigObject): JsonObject {
    const dimensions = numberList(data, 'dimensions');
    const x = dimensions.get(0);
    const y = dimensions.get(1);
    const z = dimensions.get(2);
    const design = createDesignJson(UH, [x + 2, y + 2, z + 2]);
    const blocks = this.conglomerate(project, UH, 'blocks');
    design.fuel = this.recoverIndex('fuel', this.conglomerate(project, UH, 'fuels'), data.getInt('fuel', -1));
    const blockIds = numberList(data, 'blocks');
    const cells = emptyCells(x + 2, y + 2, z + 2);
    if (data.getBoolean('compact')) {
      let index = 0;
      for (let cx = 0; cx < x + 2; cx++) {
        for (let cy = 0; cy < y + 2; cy++) {
          for (let cz = 0; cz < z + 2; cz++) {
            const bid = blockIds.get(index);
            if (bid > 0) cells[cx]![cy]![cz] = this.recoverElement('block', blocks, bid - 1);
            index++;
          }
        }
      }
    } else {
      for (let j = 0; j < blockIds.size(); j += 4) {
        const cx = blockIds.get(j) + 1;
        const cy = blockIds.get(j + 1) + 1;
        const cz = blockIds.get(j + 2) + 1;
        cells[cx]![cy]![cz] = this.recoverElement('block', blocks, blockIds.get(j + 3) - 1);
      }
    }
    // The active-cooler recipe array is never filled by the legacy reader, so
    // every recipe-bearing cell serialises as -1 (`NCPFObject.setRecipe3DArray`).
    writeDesign(design, cells, emptyCells(x + 2, y + 2, z + 2), blocks);
    return design;
  }

  /** `readMultiblockOverhaulSFR` (`:184-242`). */
  protected readMultiblockOverhaulSFR(project: ProjectJson, data: ConfigObject): JsonObject {
    const dimensions = numberList(data, 'dimensions');
    const x = dimensions.get(0);
    const y = dimensions.get(1);
    const z = dimensions.get(2);
    const design = createDesignJson(SFR, [x + 2, y + 2, z + 2]);
    const blocks = this.conglomerate(project, SFR, 'blocks');
    design.coolant_recipe = this.recoverIndex(
      'coolant recipe',
      this.conglomerate(project, SFR, 'coolant_recipes'),
      data.getInt('coolantRecipe', -1),
    );
    const blockIds = numberList(data, 'blocks');
    const cells = emptyCells(x + 2, y + 2, z + 2);
    if (data.getBoolean('compact')) {
      let index = 0;
      for (let cx = 0; cx < x + 2; cx++) {
        for (let cy = 0; cy < y + 2; cy++) {
          for (let cz = 0; cz < z + 2; cz++) {
            const bid = blockIds.get(index);
            if (bid > 0) cells[cx]![cy]![cz] = this.recoverElement('block', blocks, bid - 1);
            index++;
          }
        }
      }
    } else {
      for (let j = 0; j < blockIds.size(); j += 4) {
        const cx = blockIds.get(j) + 1;
        const cy = blockIds.get(j + 1) + 1;
        const cz = blockIds.get(j + 2) + 1;
        cells[cx]![cy]![cz] = this.recoverElement('block', blocks, blockIds.get(j + 3) - 1);
      }
    }
    const recipes = emptyCells(x + 2, y + 2, z + 2);
    const recipeIds = numberList(data, 'blockRecipes');
    const ports = numberList(data, 'ports');
    let recipeIndex = 0;
    let portIndex = 0;
    for (let cx = 0; cx < x + 2; cx++) {
      for (let cy = 0; cy < y + 2; cy++) {
        for (let cz = 0; cz < z + 2; cz++) {
          const block = cells[cx]![cy]![cz];
          if (block === null) continue;
          const lists = this.recipeListsOf(block);
          if (lists.fuels.length > 0) {
            const rid = recipeIds.get(recipeIndex);
            if (rid !== 0) recipes[cx]![cy]![cz] = this.recoverElement('fuel', lists.fuels, rid - 1);
            recipeIndex++;
          }
          if (lists.irradiators.length > 0) {
            const rid = recipeIds.get(recipeIndex);
            if (rid !== 0) recipes[cx]![cy]![cz] = this.recoverElement('recipe', lists.irradiators, rid - 1);
            recipeIndex++;
          }
          const modules = modulesOf(block);
          if (modules[`${SFR}:port`] !== undefined || modules[`${SFR}:coolant_vent`] !== undefined) {
            if (ports.get(portIndex) > 0) cells[cx]![cy]![cz] = toggledBlock(block, blocks);
            portIndex++;
          }
        }
      }
    }
    writeDesign(design, cells, recipes, blocks);
    return design;
  }

  /** `readMultiblockOverhaulMSR` (`:243-305`). */
  protected readMultiblockOverhaulMSR(project: ProjectJson, data: ConfigObject): JsonObject {
    const dimensions = numberList(data, 'dimensions');
    const x = dimensions.get(0);
    const y = dimensions.get(1);
    const z = dimensions.get(2);
    const design = createDesignJson(MSR, [x + 2, y + 2, z + 2]);
    const blocks = this.conglomerate(project, MSR, 'blocks');
    const blockIds = numberList(data, 'blocks');
    const cells = emptyCells(x + 2, y + 2, z + 2);
    if (data.getBoolean('compact')) {
      let index = 0;
      for (let cx = 0; cx < x + 2; cx++) {
        for (let cy = 0; cy < y + 2; cy++) {
          for (let cz = 0; cz < z + 2; cz++) {
            const bid = blockIds.get(index);
            if (bid > 0) cells[cx]![cy]![cz] = this.recoverElement('block', blocks, bid - 1);
            index++;
          }
        }
      }
    } else {
      for (let j = 0; j < blockIds.size(); j += 4) {
        const cx = blockIds.get(j) + 1;
        const cy = blockIds.get(j + 1) + 1;
        const cz = blockIds.get(j + 2) + 1;
        cells[cx]![cy]![cz] = this.recoverElement('block', blocks, blockIds.get(j + 3) - 1);
      }
    }
    const recipes = emptyCells(x + 2, y + 2, z + 2);
    const recipeIds = numberList(data, 'blockRecipes');
    const ports = numberList(data, 'ports');
    let recipeIndex = 0;
    let portIndex = 0;
    for (let cx = 0; cx < x + 2; cx++) {
      for (let cy = 0; cy < y + 2; cy++) {
        for (let cz = 0; cz < z + 2; cz++) {
          const block = cells[cx]![cy]![cz];
          if (block === null) continue;
          const lists = this.recipeListsOf(block);
          if (lists.fuels.length > 0) {
            const rid = recipeIds.get(recipeIndex);
            if (rid !== 0) recipes[cx]![cy]![cz] = this.recoverElement('fuel', lists.fuels, rid - 1);
            recipeIndex++;
          }
          if (lists.irradiators.length > 0) {
            const rid = recipeIds.get(recipeIndex);
            if (rid !== 0) recipes[cx]![cy]![cz] = this.recoverElement('recipe', lists.irradiators, rid - 1);
            recipeIndex++;
          }
          if (lists.heaters.length > 0) {
            const rid = recipeIds.get(recipeIndex);
            if (rid !== 0) recipes[cx]![cy]![cz] = this.recoverElement('recipe', lists.heaters, rid - 1);
            recipeIndex++;
          }
          if (modulesOf(block)[`${MSR}:port`] !== undefined) {
            if (ports.get(portIndex) > 0) cells[cx]![cy]![cz] = toggledBlock(block, blocks);
            portIndex++;
          }
        }
      }
    }
    writeDesign(design, cells, recipes, blocks);
    return design;
  }

  /** `readMultiblockOverhaulTurbine` (`:306-332`). */
  protected readMultiblockOverhaulTurbine(project: ProjectJson, data: ConfigObject): JsonObject {
    const dimensions = numberList(data, 'dimensions');
    const x = dimensions.get(0);
    const y = dimensions.get(1);
    const z = dimensions.get(2);
    const design = createDesignJson(TURBINE, [x + 2, y + 2, z + 2]);
    design.recipe = this.recoverIndex(
      'recipe',
      this.conglomerate(project, TURBINE, 'recipes'),
      data.getInt('recipe', -1),
    );
    if (data.hasProperty('inputs')) {
      const inputs = numberList(data, 'inputs');
      const ids: number[] = [];
      for (let i = 0; i < inputs.size(); i++) ids.push(inputs.get(i));
      this.turbinePostLoadInputs.set(design, ids);
    }
    const blocks = this.conglomerate(project, TURBINE, 'blocks');
    const blockIds = numberList(data, 'blocks');
    const cells = emptyCells(x + 2, y + 2, z + 2);
    let index = 0;
    for (let cx = 0; cx < x + 2; cx++) {
      for (let cy = 0; cy < y + 2; cy++) {
        for (let cz = 0; cz < z + 2; cz++) {
          const bid = blockIds.get(index);
          if (bid > 0) cells[cx]![cy]![cz] = this.recoverElement('block', blocks, bid - 1);
          index++;
        }
      }
    }
    // Turbine designs carry neither `block_recipes` nor a recipe array.
    design.design = blockIndices(cells, blocks);
    return design;
  }

  /**
   * `readMultiblockOverhaulFusionReactor` (`:333-367`). The Java body reads the
   * dimensions, recipe and coolant recipe first, then dereferences
   * `new int[0]` while reading the blocks — it throws for every input.
   */
  protected readMultiblockOverhaulFusionReactor(project: ProjectJson, data: ConfigObject): void {
    const dimensions = numberList(data, 'dimensions');
    void dimensions.get(3);
    this.recoverIndex('recipe', this.conglomerate(project, FUSION, 'recipes'), data.getInt('recipe', -1));
    this.recoverIndex(
      'coolant recipe',
      this.conglomerate(project, FUSION, 'coolant_recipes'),
      data.getInt('coolantRecipe', -1),
    );
    throw new LegacyFormatError('fusion multiblock: Java reads `blocks.get(index[0])` from `new int[0]` here');
  }

  // ------------------------------------------------------------ configuration

  /**
   * The five-rule-map reset Java performs at the top of `loadConfiguration`
   * (`:432-437`). `ncpf04.ts` has to repeat it: the v4 fork of that method is the
   * only one in the chain that does not go through this class's version.
   */
  protected clearRuleState(): void {
    for (const state of Object.values(this.rules)) {
      state.postLoad.clear();
      state.postNames.clear();
    }
  }

  /** `loadConfiguration` (`:431-559`). */
  protected loadConfiguration(project: ProjectJson, config: ConfigObject): void {
    this.clearRuleState();
    const partial = config.getBoolean('partial');
    const name = config.getString('name');
    const version = config.getString('version');
    const underhaulVersion = config.getString('underhaulVersion');
    const addon = config.getBoolean('addon');

    this.loadUnderhaulBlocks(project.configuration, config, !partial && !addon);
    const sfrAdditional: JsonObject[] = [];
    const msrAdditional: JsonObject[] = [];
    if (config.hasProperty('overhaul')) {
      const overhaul = requireObject(config, 'overhaul');
      this.loadOverhaulSFRBlocks(null, project.configuration, overhaul, !partial && !addon, false, addon, sfrAdditional);
      this.loadOverhaulMSRBlocks(null, project.configuration, overhaul, !partial && !addon, false, addon, msrAdditional);
      this.loadOverhaulTurbineBlocks(project.configuration, overhaul, !partial && !addon);
      this.loadOverhaulFusionGeneratorBlocks(project.configuration, overhaul, !partial && !addon);
    }
    withConfiguration(project.configuration, UH, (cfg) => setConfigurationMetadata(cfg, name, underhaulVersion));
    withConfiguration(project.configuration, SFR, (cfg) => setConfigurationMetadata(cfg, name, version));
    withConfiguration(project.configuration, MSR, (cfg) => setConfigurationMetadata(cfg, name, version));
    withConfiguration(project.configuration, TURBINE, (cfg) => setConfigurationMetadata(cfg, name, version));
    withConfiguration(project.configuration, FUSION, (cfg) => setConfigurationMetadata(cfg, name, version));

    if (config.hasProperty('addons')) {
      for (const addonConfig of requireList(config, 'addons')) project.addons.push(this.loadAddon(project, addonConfig));
    }
    if (sfrAdditional.length > 0) elementList(project.configuration.get(SFR)!, 'blocks').push(...sfrAdditional);
    if (msrAdditional.length > 0) elementList(project.configuration.get(MSR)!, 'blocks').push(...msrAdditional);

    this.resolvePostLoadRules(project);
    this.combineActiveCoolers(project);
    this.propagateRecipePortRecipes(project);
  }

  /** `loadAddon` (`:576-616`). */
  protected loadAddon(project: ProjectJson, config: ConfigObject): AddonJson {
    const configuration = new Map<string, JsonObject>();
    const name = config.getString('name');
    const version = config.getString('version');
    const underhaulVersion = config.getString('underhaulVersion');
    const isAddon = config.getBoolean('addon');
    this.loadUnderhaulBlocks(configuration, config, false);
    const sfrAdditional: JsonObject[] = [];
    const msrAdditional: JsonObject[] = [];
    if (config.hasProperty('overhaul')) {
      const overhaul = requireObject(config, 'overhaul');
      this.loadOverhaulSFRBlocks(project.configuration, configuration, overhaul, false, true, isAddon, sfrAdditional);
      this.loadOverhaulMSRBlocks(project.configuration, configuration, overhaul, false, true, isAddon, msrAdditional);
      this.loadOverhaulTurbineBlocks(configuration, overhaul, false);
      // No support for fusion addons (`:590`).
    }
    withConfiguration(configuration, UH, (cfg) => setConfigurationMetadata(cfg, name, underhaulVersion));
    withConfiguration(configuration, SFR, (cfg) => setConfigurationMetadata(cfg, name, version));
    withConfiguration(configuration, MSR, (cfg) => setConfigurationMetadata(cfg, name, version));
    withConfiguration(configuration, TURBINE, (cfg) => setConfigurationMetadata(cfg, name, version));
    withConfiguration(configuration, FUSION, (cfg) => setConfigurationMetadata(cfg, name, version));
    if (sfrAdditional.length > 0) elementList(configuration.get(SFR)!, 'blocks').push(...sfrAdditional);
    if (msrAdditional.length > 0) elementList(configuration.get(MSR)!, 'blocks').push(...msrAdditional);
    return { configuration, metadata: {} };
  }

  /** `loadUnderhaulBlocks` (`:618-700`). */
  protected loadUnderhaulBlocks(container: Map<string, JsonObject>, config: ConfigObject, loadSettings: boolean): void {
    if (!config.hasProperty('underhaul')) return;
    const underhaul = requireObject(config, 'underhaul');
    if (!underhaul.hasProperty('fissionSFR')) return;
    const configuration = createConfiguration(UH);
    const fissionSFR = requireObject(underhaul, 'fissionSFR');
    if (loadSettings) {
      configModules(configuration)[`${UH}_configuration_settings`] = {
        min_size: fissionSFR.getInt('minSize'),
        moderator_extra_power: javaFloat(fissionSFR.getFloat('moderatorExtraPower')),
        neutron_reach: fissionSFR.getInt('neutronReach'),
        max_size: fissionSFR.getInt('maxSize'),
        moderator_extra_heat: javaFloat(fissionSFR.getFloat('moderatorExtraHeat')),
        active_cooler_rate: fissionSFR.getInt('activeCoolerRate'),
      };
    }
    const blocks = elementList(configuration, 'blocks');
    for (const blockCfg of requireList(fissionSFR, 'blocks')) {
      const definition = legacyBlockDefinition(blockCfg.getString('name') ?? '');
      const block = legacyElementJson(definition, namedModules(null, null));
      blocks.push(block);
      writeDisplayName(block, blockCfg.getString('displayName'));
      if (blockCfg.hasProperty('legacyNames')) {
        modulesOf(block)[LEGACY_NAMES] = legacyNamesModule(stringList(blockCfg, 'legacyNames'));
      }
      const active = blockCfg.getString('active');
      const cooling = blockCfg.getInt('cooling', 0);
      /** The module a cooler's placement rules are attached to (`:651-663`). */
      let coolerStats: JsonObject | null = null;
      const lists = this.recipeListsFor(block);
      if (active !== null) {
        setModuleIfPresent(block, `${UH}:active_cooler`, {});
        // `((NCPFLegacyBlockElement)block.definition).metadata = null;` (`:634`) —
        // again a mutation of the shared definition, so the flat element copy
        // needs it applied too.
        delete definition.metadata;
        delete block.metadata;
        const recipe = legacyElementJson(legacyFluidDefinition(active), namedModules(null, null));
        coolerStats = { cooling };
        modulesOf(recipe)[`${UH}:cooler`] = coolerStats;
        lists.coolers.push(recipe);
      } else if (cooling !== 0) {
        coolerStats = { cooling };
        setModuleIfPresent(block, `${UH}:cooler`, coolerStats);
      }
      if (blockCfg.getBoolean('fuelCell', false)) setModuleIfPresent(block, `${UH}:fuel_cell`, {});
      if (blockCfg.getBoolean('moderator', false)) setModuleIfPresent(block, `${UH}:moderator`, {});
      if (blockCfg.getBoolean('casing', false)) setModuleIfPresent(block, `${UH}:casing`, {});
      if (blockCfg.getBoolean('controller', false)) setModuleIfPresent(block, `${UH}:controller`, {});
      if (blockCfg.hasProperty('rules')) {
        if (coolerStats === null) {
          throw new LegacyFormatError(`Rules on a block without cooler stats! (${definitionToString(definition)})`);
        }
        coolerStats.rules = requireList(blockCfg, 'rules').map((ruleCfg) =>
          this.readUnderRule(ruleCfg, definitionToString(definition)),
        );
      }
      this.applyBlockRecipes(block, ['coolers']);
    }
    for (const fuelCfg of requireList(fissionSFR, 'fuels')) {
      const fuel = legacyElementJson(
        legacyItemDefinition(fuelCfg.getString('name') ?? ''),
        namedModules(null, null),
      );
      modulesOf(fuel)[`${UH}:fuel_stats`] = {
        power: javaFloat(fuelCfg.getFloat('power')),
        heat: javaFloat(fuelCfg.getFloat('heat')),
        time: fuelCfg.getInt('time'),
      };
      writeDisplayName(fuel, fuelCfg.getString('displayName'));
      if (fuelCfg.hasProperty('legacyNames')) {
        modulesOf(fuel)[LEGACY_NAMES] = legacyNamesModule(stringList(fuelCfg, 'legacyNames'));
      }
      elementList(configuration, 'fuels').push(fuel);
    }
    container.set(UH, configuration);
  }

  /** `loadOverhaulSFRBlocks` (`:702-904`). */
  protected loadOverhaulSFRBlocks(
    parent: Map<string, JsonObject> | null,
    container: Map<string, JsonObject>,
    overhaul: ConfigObject,
    loadSettings: boolean,
    loadingAddon: boolean,
    isAddon: boolean,
    additionalBlocks: JsonObject[],
  ): void {
    if (!overhaul.hasProperty('fissionSFR')) return;
    const configuration = createConfiguration(SFR);
    const fissionSFR = requireObject(overhaul, 'fissionSFR');
    if (loadSettings) {
      configModules(configuration)[`${SFR}_configuration_settings`] = {
        min_size: fissionSFR.getInt('minSize'),
        sparsity_penalty_multiplier: javaFloat(fissionSFR.getFloat('sparsityPenaltyMult')),
        neutron_reach: fissionSFR.getInt('neutronReach'),
        max_size: fissionSFR.getInt('maxSize'),
        sparsity_penalty_threshold: javaFloat(fissionSFR.getFloat('sparsityPenaltyThreshold')),
        cooling_efficiency_leniency: fissionSFR.getInt('coolingEfficiencyLeniency'),
      };
    }
    const blocks = elementList(configuration, 'blocks');
    for (const blockCfg of requireList(fissionSFR, 'blocks')) {
      const definition = legacyBlockDefinition(blockCfg.getString('name') ?? '');
      const block = legacyElementJson(definition, namedModules(null, null));
      blocks.push(block);
      let addonRecipeBlock: JsonObject | null = null;
      if (loadingAddon) {
        const parentBlocks = parent === null ? [] : elementList(parent.get(SFR)!, 'blocks');
        for (const candidate of parentBlocks) {
          // Not `matches()` — the addon has no blockstates (`:724`).
          if (candidate.name === definition.name) addonRecipeBlock = candidate;
        }
      }
      const isFuelCell = blockCfg.hasProperty('fuelCell');
      const isIrradiator = blockCfg.hasProperty('irradiator');
      if (addonRecipeBlock === null && (isAddon || !loadingAddon)) {
        writeDisplayName(block, blockCfg.getString('displayName'));
        if (blockCfg.hasProperty('legacyNames')) {
          modulesOf(block)[LEGACY_NAMES] = legacyNamesModule(stringList(blockCfg, 'legacyNames'));
        }
        if (
          (blockCfg.hasProperty('cluster') && !blockCfg.hasProperty('functional')) ||
          blockCfg.getBoolean('conductor', false)
        ) {
          setModuleIfPresent(block, `${SFR}:conductor`, {});
        }
        if (blockCfg.getBoolean('casing', false)) {
          setModuleIfPresent(block, `${SFR}:casing`, { edge: blockCfg.getBoolean('casingEdge', false) });
        }
        if (blockCfg.getBoolean('controller', false)) setModuleIfPresent(block, `${SFR}:controller`, {});
        const coolantVentCfg = blockCfg.getObject('coolantVent');
        if (coolantVentCfg !== null) {
          // Same shared-definition mutation as the shield path (`:778`).
          definition.blockstate = { active: false };
          block.blockstate = definition.blockstate;
          setModuleIfPresent(block, `${SFR}:coolant_vent`, { output: false });
          const casing = modulesOf(block)[`${SFR}:casing`];
          if (casing === undefined) {
            throw new LegacyFormatError(`Coolant vent without casing! (${definitionToString(definition)})`);
          }
          const output = legacyElementJson(
            { ...definition, blockstate: { active: true } },
            namedModules(null, null),
          );
          modulesOf(output)[`${SFR}:casing`] = cloneJson(casing);
          modulesOf(output)[`${SFR}:coolant_vent`] = { output: true };
          writeDisplayName(output, coolantVentCfg.getString('outDisplayName'));
          additionalBlocks.push(output);
        }
        const hasRecipes = listOrEmpty(blockCfg, 'recipes').length > 0;
        if (blockCfg.hasProperty('fuelCell')) setModuleIfPresent(block, `${SFR}:fuel_cell`, {});
        if (blockCfg.hasProperty('irradiator')) setModuleIfPresent(block, `${SFR}:irradiator`, {});
        const reflectorCfg = blockCfg.getObject('reflector');
        if (reflectorCfg !== null) {
          setModuleIfPresent(block, `${SFR}:reflector`, {
            efficiency: javaFloat(reflectorCfg.getFloat('efficiency')),
            reflectivity: javaFloat(reflectorCfg.getFloat('reflectivity')),
          });
        }
        const moderatorCfg = blockCfg.getObject('moderator');
        if (moderatorCfg !== null) {
          setModuleIfPresent(block, `${SFR}:moderator`, {
            flux: moderatorCfg.getInt('flux'),
            efficiency: javaFloat(moderatorCfg.getFloat('efficiency')),
          });
        }
        const shieldCfg = blockCfg.getObject('shield');
        if (shieldCfg !== null) {
          // `((NCPFLegacyBlockElement)block.definition).blockstate.put("active", false)`
          // (`:778`): Java mutates the *shared* definition, so the change is visible
          // on the element too. Here the element is a flat copy of the definition
          // (`legacyElementJson`), so the mutation has to be applied to both.
          definition.blockstate = { active: false };
          block.blockstate = definition.blockstate;
          const shield: JsonObject = {
            heat_per_flux: shieldCfg.getInt('heat'),
            efficiency: javaFloat(shieldCfg.getFloat('efficiency')),
          };
          // `block.moderator = null;` — no double-dipping (`:781`).
          delete modulesOf(block)[`${SFR}:moderator`];
          setModuleIfPresent(block, `${SFR}:neutron_shield`, shield);
          shield.closed = { ...definition, blockstate: { active: true } };
          additionalBlocks.push(
            legacyElementJson({ ...definition, blockstate: { active: true } }, namedModules(null, null)),
          );
        }
        const heatsinkCfg = blockCfg.getObject('heatsink');
        if (heatsinkCfg !== null) {
          setModuleIfPresent(block, `${SFR}:heat_sink`, { cooling: heatsinkCfg.getInt('cooling') });
        }
        const sourceCfg = blockCfg.getObject('source');
        if (sourceCfg !== null) {
          setModuleIfPresent(block, `${SFR}:neutron_source`, {
            efficiency: javaFloat(sourceCfg.getFloat('efficiency')),
          });
        }
        if (hasRecipes && (loadingAddon || !isAddon)) {
          const portCfg = requireObject(blockCfg, 'port');
          const portDefinition = legacyBlockDefinition(portCfg.getString('name') ?? '');
          portDefinition.blockstate = { active: false };
          const input = legacyElementJson(portDefinition, namedModules(null, null));
          modulesOf(input)[`${SFR}:casing`] = { edge: false };
          modulesOf(input)[`${SFR}:port`] = { output: false };
          writeDisplayName(input, portCfg.getString('inputDisplayName'));
          blocks.push(input);
          const output = legacyElementJson(
            { ...portDefinition, blockstate: { active: true } },
            namedModules(null, null),
          );
          modulesOf(output)[`${SFR}:casing`] = { edge: false };
          modulesOf(output)[`${SFR}:port`] = { output: true };
          writeDisplayName(output, portCfg.getString('outputDisplayName'));
          additionalBlocks.push(output);
          setModuleIfPresent(block, `${SFR}:recipe_ports`, {
            input: definitionOf(input),
            output: definitionOf(output),
          });
        }
        if (blockCfg.hasProperty('rules')) {
          const heatsink = moduleIfObject(block, `${SFR}:heat_sink`);
          if (heatsink === null) {
            throw new LegacyFormatError(`Rules on a block without heatsink! (${definitionToString(definition)})`);
          }
          heatsink.rules = requireList(blockCfg, 'rules').map((ruleCfg) =>
            this.readOverSFRRule(ruleCfg, definitionToString(definition)),
          );
        }
      }
      const lists = this.recipeListsFor(block);
      for (const recipeCfg of listOrEmpty(blockCfg, 'recipes')) {
        const inputCfg = requireObject(recipeCfg, 'input');
        const recipeName = inputCfg.getString('name') ?? '';
        let recipeNames: JsonObject | null = null;
        // Java's `recip` (`:836`, `:858`): the recipe element the display name and
        // the legacy names are applied to — the *last* branch that ran wins.
        let recip: JsonObject | null = null;
        if (isFuelCell) {
          const fuel = legacyElementJson(legacyItemDefinition(recipeName), namedModules(null, null));
          const fuelCellCfg = requireObject(recipeCfg, 'fuelCell');
          modulesOf(fuel)[`${SFR}:fuel_stats`] = {
            efficiency: javaFloat(fuelCellCfg.getFloat('efficiency')),
            heat: fuelCellCfg.getInt('heat'),
            time: fuelCellCfg.getInt('time'),
            criticality: fuelCellCfg.getInt('criticality'),
            self_priming: fuelCellCfg.getBoolean('selfPriming', false),
          };
          recipeNames = modulesOf(fuel)[DISPLAY_NAME] as JsonObject;
          recip = fuel;
          lists.fuels.push(fuel);
        }
        if (isIrradiator) {
          const recipe = legacyElementJson(legacyItemDefinition(recipeName), namedModules(null, null));
          const irradiatorCfg = requireObject(recipeCfg, 'irradiator');
          modulesOf(recipe)[`${SFR}:irradiator_stats`] = {
            efficiency: javaFloat(irradiatorCfg.getFloat('efficiency')),
            heat: javaFloat(irradiatorCfg.getFloat('heat')),
          };
          recipeNames = modulesOf(recipe)[DISPLAY_NAME] as JsonObject;
          recip = recipe;
          lists.irradiators.push(recipe);
        }
        if (recipeNames === null || recip === null) {
          throw new LegacyFormatError(`Recipe on a block that is neither fuel cell nor irradiator! (${recipeName})`);
        }
        writeDisplayNameInto(recipeNames, inputCfg.getString('displayName'));
        // `recip.withModuleOrCreate(LegacyNamesModule::new, …)` (`:871-873`): the
        // module goes on the *recipe element*, not inside its display-name module.
        applyRecipeLegacyNames(modulesOf(recip), inputCfg);
      }
      this.applyBlockRecipes(block, ['fuels', 'irradiators']);
    }
    for (const coolantRecipeCfg of requireList(fissionSFR, 'coolantRecipes')) {
      const inputCfg = requireObject(coolantRecipeCfg, 'input');
      const outputCfg = requireObject(coolantRecipeCfg, 'output');
      const amounts = makeIntegerRatio(1, coolantRecipeCfg.getFloat('outputRatio'));
      const modules = namedModules(null, null);
      writeDisplayNameInto(modules[DISPLAY_NAME] as JsonObject, inputCfg.getString('displayName'));
      const recipe = legacyElementJson(
        legacyRecipeDefinition(
          [elementStack(legacyFluidDefinition(inputCfg.getString('name') ?? ''), amounts[0])],
          [elementStack(legacyFluidDefinition(outputCfg.getString('name') ?? ''), amounts[1])],
        ),
        modules,
      );
      modulesOf(recipe)[`${SFR}:coolant_recipe_stats`] = { heat: coolantRecipeCfg.getInt('heat') };
      applyRecipeLegacyNames(modules, inputCfg);
      elementList(configuration, 'coolant_recipes').push(recipe);
    }
    container.set(SFR, configuration);
  }

  /** `loadOverhaulMSRBlocks` (`:905-1080`). */
  protected loadOverhaulMSRBlocks(
    parent: Map<string, JsonObject> | null,
    container: Map<string, JsonObject>,
    overhaul: ConfigObject,
    loadSettings: boolean,
    loadingAddon: boolean,
    isAddon: boolean,
    additionalBlocks: JsonObject[],
  ): void {
    if (!overhaul.hasProperty('fissionMSR')) return;
    const configuration = createConfiguration(MSR);
    const fissionMSR = requireObject(overhaul, 'fissionMSR');
    if (loadSettings) {
      configModules(configuration)[`${MSR}_configuration_settings`] = {
        min_size: fissionMSR.getInt('minSize'),
        sparsity_penalty_multiplier: javaFloat(fissionMSR.getFloat('sparsityPenaltyMult')),
        neutron_reach: fissionMSR.getInt('neutronReach'),
        max_size: fissionMSR.getInt('maxSize'),
        sparsity_penalty_threshold: javaFloat(fissionMSR.getFloat('sparsityPenaltyThreshold')),
        cooling_efficiency_leniency: fissionMSR.getInt('coolingEfficiencyLeniency'),
      };
    }
    const blocks = elementList(configuration, 'blocks');
    for (const blockCfg of requireList(fissionMSR, 'blocks')) {
      const definition = legacyBlockDefinition(blockCfg.getString('name') ?? '');
      const block = legacyElementJson(definition, namedModules(null, null));
      blocks.push(block);
      let addonRecipeBlock: JsonObject | null = null;
      if (loadingAddon) {
        const parentBlocks = parent === null ? [] : elementList(parent.get(MSR)!, 'blocks');
        for (const candidate of parentBlocks) {
          if (candidate.name === definition.name) addonRecipeBlock = candidate;
        }
      }
      const isFuelVessel = blockCfg.hasProperty('fuelVessel');
      const isIrradiator = blockCfg.hasProperty('irradiator');
      const isHeater = blockCfg.hasProperty('heater');
      if (addonRecipeBlock === null && (isAddon || !loadingAddon)) {
        writeDisplayName(block, blockCfg.getString('displayName'));
        if (blockCfg.hasProperty('legacyNames')) {
          modulesOf(block)[LEGACY_NAMES] = legacyNamesModule(stringList(blockCfg, 'legacyNames'));
        }
        if (
          (blockCfg.hasProperty('cluster') && !blockCfg.hasProperty('functional')) ||
          blockCfg.getBoolean('conductor', false)
        ) {
          setModuleIfPresent(block, `${MSR}:conductor`, {});
        }
        if (blockCfg.getBoolean('casing', false)) {
          setModuleIfPresent(block, `${MSR}:casing`, { edge: blockCfg.getBoolean('casingEdge', false) });
        }
        if (blockCfg.getBoolean('controller', false)) setModuleIfPresent(block, `${MSR}:controller`, {});
        const hasRecipes = listOrEmpty(blockCfg, 'recipes').length > 0;
        if (blockCfg.hasProperty('fuelVessel')) setModuleIfPresent(block, `${MSR}:fuel_vessel`, {});
        if (blockCfg.hasProperty('irradiator')) setModuleIfPresent(block, `${MSR}:irradiator`, {});
        const reflectorCfg = blockCfg.getObject('reflector');
        if (reflectorCfg !== null) {
          setModuleIfPresent(block, `${MSR}:reflector`, {
            efficiency: javaFloat(reflectorCfg.getFloat('efficiency')),
            reflectivity: javaFloat(reflectorCfg.getFloat('reflectivity')),
          });
        }
        const moderatorCfg = blockCfg.getObject('moderator');
        if (moderatorCfg !== null) {
          setModuleIfPresent(block, `${MSR}:moderator`, {
            flux: moderatorCfg.getInt('flux'),
            efficiency: javaFloat(moderatorCfg.getFloat('efficiency')),
          });
        }
        const shieldCfg = blockCfg.getObject('shield');
        if (shieldCfg !== null) {
          // Same shape as the SFR shield path above (`:1055`): Java mutates the
          // shared definition, the flat element copy needs it applied as well.
          definition.blockstate = { active: false };
          block.blockstate = definition.blockstate;
          const shield: JsonObject = {
            heat_per_flux: shieldCfg.getInt('heat'),
            efficiency: javaFloat(shieldCfg.getFloat('efficiency')),
          };
          delete modulesOf(block)[`${MSR}:moderator`];
          setModuleIfPresent(block, `${MSR}:neutron_shield`, shield);
          shield.closed = { ...definition, blockstate: { active: true } };
          additionalBlocks.push(
            legacyElementJson({ ...definition, blockstate: { active: true } }, namedModules(null, null)),
          );
        }
        const heaterCfg = blockCfg.getObject('heater');
        if (heaterCfg !== null) {
          delete modulesOf(block)[`${MSR}:moderator`];
          setModuleIfPresent(block, `${MSR}:heater`, {});
        }
        const sourceCfg = blockCfg.getObject('source');
        if (sourceCfg !== null) {
          setModuleIfPresent(block, `${MSR}:neutron_source`, {
            efficiency: javaFloat(sourceCfg.getFloat('efficiency')),
          });
        }
        if (hasRecipes && (loadingAddon || !isAddon)) {
          const portCfg = requireObject(blockCfg, 'port');
          const portDefinition = legacyBlockDefinition(portCfg.getString('name') ?? '');
          portDefinition.blockstate = { active: false };
          const input = legacyElementJson(portDefinition, namedModules(null, null));
          modulesOf(input)[`${MSR}:casing`] = { edge: false };
          modulesOf(input)[`${MSR}:port`] = { output: false };
          writeDisplayName(input, portCfg.getString('inputDisplayName'));
          blocks.push(input);
          const output = legacyElementJson(
            { ...portDefinition, blockstate: { active: true } },
            namedModules(null, null),
          );
          modulesOf(output)[`${MSR}:casing`] = { edge: false };
          modulesOf(output)[`${MSR}:port`] = { output: true };
          writeDisplayName(output, portCfg.getString('outputDisplayName'));
          additionalBlocks.push(output);
          setModuleIfPresent(block, `${MSR}:recipe_ports`, {
            input: definitionOf(input),
            output: definitionOf(output),
          });
        }
        if (blockCfg.hasProperty('rules')) {
          const heater = moduleIfObject(block, `${MSR}:heater`);
          if (heater === null) {
            throw new LegacyFormatError(`Rules on a block without heater! (${definitionToString(definition)})`);
          }
          heater.rules = requireList(blockCfg, 'rules').map((ruleCfg) =>
            this.readOverMSRRule(ruleCfg, definitionToString(definition)),
          );
        }
      }
      const lists = this.recipeListsFor(block);
      for (const recipeCfg of listOrEmpty(blockCfg, 'recipes')) {
        const inputCfg = requireObject(recipeCfg, 'input');
        const recipeName = inputCfg.getString('name') ?? '';
        let recipeNames: JsonObject | null = null;
        // Java's `recip` — the last recipe branch that ran.
        let recip: JsonObject | null = null;
        if (isFuelVessel) {
          const fuel = legacyElementJson(legacyFluidDefinition(recipeName), namedModules(null, null));
          const fuelVesselCfg = requireObject(recipeCfg, 'fuelVessel');
          modulesOf(fuel)[`${MSR}:fuel_stats`] = {
            efficiency: javaFloat(fuelVesselCfg.getFloat('efficiency')),
            // some plannerator-generated files saved this as a float (`:1038`)
            heat: fuelVesselCfg.getAsInt('heat'),
            time: fuelVesselCfg.getInt('time'),
            criticality: fuelVesselCfg.getInt('criticality'),
            self_priming: fuelVesselCfg.getBoolean('selfPriming', false),
          };
          recipeNames = modulesOf(fuel)[DISPLAY_NAME] as JsonObject;
          recip = fuel;
          lists.fuels.push(fuel);
        }
        if (isIrradiator) {
          const recipe = legacyElementJson(legacyItemDefinition(recipeName), namedModules(null, null));
          const irradiatorCfg = requireObject(recipeCfg, 'irradiator');
          modulesOf(recipe)[`${MSR}:irradiator_stats`] = {
            efficiency: javaFloat(irradiatorCfg.getFloat('efficiency')),
            heat: javaFloat(irradiatorCfg.getFloat('heat')),
          };
          recipeNames = modulesOf(recipe)[DISPLAY_NAME] as JsonObject;
          recip = recipe;
          lists.irradiators.push(recipe);
        }
        if (isHeater) {
          const recipe = legacyElementJson(legacyFluidDefinition(recipeName), namedModules(null, null));
          const heaterCfg = requireObject(recipeCfg, 'heater');
          modulesOf(recipe)[`${MSR}:heater_stats`] = { cooling: heaterCfg.getInt('cooling') };
          recipeNames = modulesOf(recipe)[DISPLAY_NAME] as JsonObject;
          recip = recipe;
          lists.heaters.push(recipe);
        }
        if (recipeNames === null || recip === null) {
          throw new LegacyFormatError(`Recipe on a block with no recipe function! (${recipeName})`);
        }
        writeDisplayNameInto(recipeNames, inputCfg.getString('displayName'));
        // `recip.withModuleOrCreate(LegacyNamesModule::new, …)` (`:871-873`): the
        // module goes on the *recipe element*, not inside its display-name module.
        applyRecipeLegacyNames(modulesOf(recip), inputCfg);
      }
      this.applyBlockRecipes(block, ['fuels', 'irradiators', 'heaters']);
    }
    container.set(MSR, configuration);
  }

  /** `loadOverhaulTurbineBlocks` (`:1081-1167`). */
  protected loadOverhaulTurbineBlocks(
    container: Map<string, JsonObject>,
    overhaul: ConfigObject,
    loadSettings: boolean,
  ): void {
    if (!overhaul.hasProperty('turbine')) return;
    const configuration = createConfiguration(TURBINE);
    const turbine = requireObject(overhaul, 'turbine');
    if (loadSettings) {
      configModules(configuration)[`${TURBINE}_configuration_settings`] = {
        min_width: turbine.getInt('minWidth'),
        max_size: turbine.getInt('maxSize'),
        throughput_efficiency_leniency_multiplier: javaFloat(turbine.getFloat('throughputEfficiencyLeniencyMult')),
        throughput_factor: javaFloat(turbine.getFloat('throughputFactor')),
        min_length: turbine.getInt('minLength'),
        fluid_per_blade: turbine.getInt('fluidPerBlade'),
        throughput_efficiency_leniency_threshold: javaFloat(
          turbine.getFloat('throughputEfficiencyLeniencyThreshold'),
        ),
        power_bonus: javaFloat(turbine.getFloat('powerBonus')),
      };
    }
    for (const blockCfg of requireList(turbine, 'blocks')) {
      const definition = legacyBlockDefinition(blockCfg.getString('name') ?? '');
      const block = legacyElementJson(definition, namedModules(null, null));
      elementList(configuration, 'blocks').push(block);
      writeDisplayName(block, blockCfg.getString('displayName'));
      if (blockCfg.hasProperty('legacyNames')) {
        modulesOf(block)[LEGACY_NAMES] = legacyNamesModule(stringList(blockCfg, 'legacyNames'));
      }
      const bladeCfg = blockCfg.getObject('blade');
      if (bladeCfg !== null) {
        if (bladeCfg.getBoolean('stator', false)) {
          setModuleIfPresent(block, `${TURBINE}:stator`, { expansion: javaFloat(bladeCfg.getFloat('expansion')) });
        } else {
          setModuleIfPresent(block, `${TURBINE}:blade`, {
            efficiency: javaFloat(bladeCfg.getFloat('efficiency')),
            expansion: javaFloat(bladeCfg.getFloat('expansion')),
          });
        }
      }
      const coilCfg = blockCfg.getObject('coil');
      if (coilCfg !== null) {
        setModuleIfPresent(block, `${TURBINE}:coil`, { efficiency: javaFloat(coilCfg.getFloat('efficiency')) });
      }
      if (blockCfg.getBoolean('bearing', false)) setModuleIfPresent(block, `${TURBINE}:bearing`, {});
      if (blockCfg.getBoolean('shaft', false)) setModuleIfPresent(block, `${TURBINE}:shaft`, {});
      if (blockCfg.getBoolean('connector', false)) setModuleIfPresent(block, `${TURBINE}:connector`, {});
      if (blockCfg.getBoolean('controller', false)) setModuleIfPresent(block, `${TURBINE}:controller`, {});
      if (blockCfg.getBoolean('casing', false)) {
        setModuleIfPresent(block, `${TURBINE}:casing`, { edge: blockCfg.getBoolean('casingEdge', false) });
      }
      if (blockCfg.getBoolean('inlet', false)) setModuleIfPresent(block, `${TURBINE}:inlet`, {});
      if (blockCfg.getBoolean('outlet', false)) setModuleIfPresent(block, `${TURBINE}:outlet`, {});
      if (blockCfg.hasProperty('rules')) {
        const coil = moduleIfObject(block, `${TURBINE}:coil`);
        const connector = moduleIfObject(block, `${TURBINE}:connector`);
        // `:1139-1140` — the rule is **built twice**, once per module, and each
        // copy is its own object. The indexed targets are resolved after all
        // blocks exist (`resolvePostLoadRules`), so the copies must stay the ones
        // registered in `postLoad` — cloning them here would orphan the fixup.
        for (const ruleCfg of requireList(blockCfg, 'rules')) {
          if (coil !== null) {
            coil.rules = [...turbineRules(coil), this.readOverTurbineRule(ruleCfg, definitionToString(definition))];
          }
          if (connector !== null) {
            connector.rules = [
              ...turbineRules(connector),
              this.readOverTurbineRule(ruleCfg, definitionToString(definition)),
            ];
          }
        }
      }
    }
    for (const recipeCfg of requireList(turbine, 'recipes')) {
      const inputCfg = requireObject(recipeCfg, 'input');
      const modules = namedModules(null, null);
      writeDisplayNameInto(modules[DISPLAY_NAME] as JsonObject, inputCfg.getString('displayName'));
      const recipe = legacyElementJson(legacyFluidDefinition(inputCfg.getString('name') ?? ''), modules);
      modulesOf(recipe)[`${TURBINE}:recipe_stats`] = {
        coefficient: recipeCfg.getDouble('coefficient'),
        power: recipeCfg.getDouble('power'),
      };
      applyRecipeLegacyNames(modules, inputCfg);
      elementList(configuration, 'recipes').push(recipe);
    }
    container.set(TURBINE, configuration);
  }

  /** `loadOverhaulFusionGeneratorBlocks` (`:1168-1309`). */
  protected loadOverhaulFusionGeneratorBlocks(
    container: Map<string, JsonObject>,
    overhaul: ConfigObject,
    loadSettings: boolean,
  ): void {
    if (!overhaul.hasProperty('fusion')) return;
    const configuration = createConfiguration(FUSION);
    const fusion = requireObject(overhaul, 'fusion');
    if (loadSettings) {
      configModules(configuration)[`${FUSION}_configuration_settings`] = {
        min_inner_radius: fusion.getInt('minInnerRadius'),
        min_core_size: fusion.getInt('minCoreSize'),
        min_toroid_width: fusion.getInt('minToroidWidth'),
        min_lining_thickness: fusion.getInt('minLiningThickness'),
        max_inner_radius: fusion.getInt('maxInnerRadius'),
        max_core_size: fusion.getInt('maxCoreSize'),
        max_toroid_width: fusion.getInt('maxToroidWidth'),
        max_lining_thickness: fusion.getInt('maxLiningThickness'),
        sparsity_penalty_multiplier: javaFloat(fusion.getFloat('sparsityPenaltyMult')),
        sparsity_penalty_threshold: javaFloat(fusion.getFloat('sparsityPenaltyThreshold')),
        cooling_efficiency_leniency: fusion.getInt('coolingEfficiencyLeniency'),
      };
    }
    for (const blockCfg of requireList(fusion, 'blocks')) {
      const definition = legacyBlockDefinition(blockCfg.getString('name') ?? '');
      const block = legacyElementJson(definition, namedModules(null, null));
      elementList(configuration, 'blocks').push(block);
      writeDisplayName(block, blockCfg.getString('displayName'));
      if (blockCfg.hasProperty('legacyNames')) {
        modulesOf(block)[LEGACY_NAMES] = legacyNamesModule(stringList(blockCfg, 'legacyNames'));
      }
      if (
        (blockCfg.hasProperty('cluster') && !blockCfg.hasProperty('functional')) ||
        blockCfg.getBoolean('conductor', false)
      ) {
        setModuleIfPresent(block, `${FUSION}:conductor`, {});
      }
      if (blockCfg.getBoolean('connector', false)) setModuleIfPresent(block, `${FUSION}:connector`, {});
      if (blockCfg.getBoolean('core', false)) setModuleIfPresent(block, `${FUSION}:core`, {});
      if (blockCfg.getBoolean('electromagnet', false)) {
        setModuleIfPresent(block, `${FUSION}:toroidal_electromagnet`, {});
        setModuleIfPresent(block, `${FUSION}:poloidal_electromagnet`, {});
      }
      if (blockCfg.getBoolean('heatingBlanket', false)) setModuleIfPresent(block, `${FUSION}:heating_blanket`, {});
      if (blockCfg.hasProperty('breedingBlanket')) setModuleIfPresent(block, `${FUSION}:breeding_blanket`, {});
      const shieldingCfg = blockCfg.getObject('shielding');
      if (shieldingCfg !== null) {
        setModuleIfPresent(block, `${FUSION}:shielding`, {
          shieldiness: javaFloat(shieldingCfg.getFloat('shieldiness')),
        });
      }
      const reflectorCfg = blockCfg.getObject('reflector');
      if (reflectorCfg !== null) {
        setModuleIfPresent(block, `${FUSION}:reflector`, { efficiency: javaFloat(reflectorCfg.getFloat('efficiency')) });
      }
      const heatsinkCfg = blockCfg.getObject('heatsink');
      if (heatsinkCfg !== null) {
        setModuleIfPresent(block, `${FUSION}:heatsink`, { cooling: heatsinkCfg.getInt('cooling') });
      }
      if (blockCfg.hasProperty('rules')) {
        const heatsink = moduleIfObject(block, `${FUSION}:heatsink`);
        if (heatsink === null) {
          throw new LegacyFormatError(`Rules on a block without heatsink! (${definitionToString(definition)})`);
        }
        heatsink.rules = requireList(blockCfg, 'rules').map((ruleCfg) =>
          this.readOverFusionRule(ruleCfg, definitionToString(definition)),
        );
      }
      const lists = this.recipeListsFor(block);
      for (const recipeCfg of listOrEmpty(blockCfg, 'recipes')) {
        const inputCfg = requireObject(recipeCfg, 'input');
        const modules = namedModules(null, null);
        writeDisplayNameInto(modules[DISPLAY_NAME] as JsonObject, inputCfg.getString('displayName'));
        const recipe = legacyElementJson(legacyItemDefinition(inputCfg.getString('name') ?? ''), modules);
        const blanketCfg = requireObject(recipeCfg, 'breedingBlanket');
        modulesOf(recipe)[`${FUSION}:breeding_blanket_stats`] = {
          efficiency: javaFloat(blanketCfg.getFloat('efficiency')),
          heat: javaFloat(blanketCfg.getFloat('heat')),
          augmented: blanketCfg.getBoolean('augmented', false),
        };
        applyRecipeLegacyNames(modules, inputCfg);
        lists.blankets.push(recipe);
      }
      this.applyBlockRecipes(block, ['blankets']);
    }
    for (const recipeCfg of requireList(fusion, 'recipes')) {
      const inputCfg = requireObject(recipeCfg, 'input');
      const modules = namedModules(null, null);
      writeDisplayNameInto(modules[DISPLAY_NAME] as JsonObject, inputCfg.getString('displayName'));
      const recipe = legacyElementJson(legacyFluidDefinition(inputCfg.getString('name') ?? ''), modules);
      modulesOf(recipe)[`${FUSION}:recipe_stats`] = {
        efficiency: javaFloat(recipeCfg.getFloat('efficiency')),
        heat: recipeCfg.getInt('heat'),
        fluxiness: javaFloat(recipeCfg.getFloat('fluxiness')),
        time: recipeCfg.getInt('time'),
      };
      applyRecipeLegacyNames(modules, inputCfg);
      elementList(configuration, 'recipes').push(recipe);
    }
    for (const coolantRecipeCfg of requireList(fusion, 'coolantRecipes')) {
      const inputCfg = requireObject(coolantRecipeCfg, 'input');
      const outputCfg = requireObject(coolantRecipeCfg, 'output');
      const amounts = makeIntegerRatio(1, coolantRecipeCfg.getFloat('outputRatio'));
      const modules = namedModules(null, null);
      writeDisplayNameInto(modules[DISPLAY_NAME] as JsonObject, inputCfg.getString('displayName'));
      const recipe = legacyElementJson(
        legacyRecipeDefinition(
          [elementStack(legacyFluidDefinition(inputCfg.getString('name') ?? ''), amounts[0])],
          [elementStack(legacyFluidDefinition(outputCfg.getString('name') ?? ''), amounts[1])],
        ),
        modules,
      );
      modulesOf(recipe)[`${FUSION}:coolant_recipe_stats`] = { heat: coolantRecipeCfg.getInt('heat') };
      applyRecipeLegacyNames(modules, inputCfg);
      elementList(configuration, 'coolant_recipes').push(recipe);
    }
    container.set(FUSION, configuration);
  }

  // ------------------------------------------------------------------- rules

  /** `readGenericRule` (`:384-413`). */
  protected readGenericRule(state: RuleState, ruleCfg: ConfigObject, blockName: string): JsonObject {
    const rule: JsonObject = {};
    const typeByte = ruleCfg.getByte('type');
    const type = RULE_TYPES[typeByte];
    if (type === undefined) throw new LegacyFormatError(`Found rule with invalid type: ${typeByte}`);
    rule.type = type;
    switch (type) {
      case 'between':
      case 'axial':
        this.readRuleTarget(state, rule, ruleCfg, blockName);
        rule.min = ruleCfg.getByte('min');
        rule.max = ruleCfg.getByte('max');
        break;
      case 'vertex':
      case 'edge':
        this.readRuleTarget(state, rule, ruleCfg, blockName);
        break;
      case 'or':
      case 'and':
        rule.rules = requireList(ruleCfg, 'rules').map((sub) => this.readGenericRule(state, sub, blockName));
        break;
    }
    return rule;
  }

  /** `readRuleTarget` (`:369-374`). */
  protected readRuleTarget(state: RuleState, rule: JsonObject, ruleCfg: ConfigObject, blockName: string): void {
    if (ruleCfg.getBoolean('isSpecificBlock')) this.readRuleBlock(state, rule, ruleCfg, blockName);
    else this.readRuleBlockType(state, rule, ruleCfg);
    // `rule.setReferences(null, false)` only rewrites the reference *type*, which
    // is not visible in the serialised definition.
  }

  /** `readRuleBlockType` (`:376-378`). */
  protected readRuleBlockType(state: RuleState, rule: JsonObject, ruleCfg: ConfigObject): void {
    const index = ruleCfg.getByte('blockType');
    const name = state.blockTypes[index];
    if (name === undefined) throw new LegacyFormatError(`Invalid block type index: ${index}!`);
    rule.block = moduleDefinition(name);
  }

  /** `readRuleBlock` (`:380-383`) — v11 stores the index as an int. */
  protected readRuleBlock(state: RuleState, rule: JsonObject, ruleCfg: ConfigObject, blockName: string): void {
    state.postLoad.set(rule, ruleCfg.getInt('block'));
    state.postNames.set(rule, blockName);
  }

  protected readUnderRule(ruleCfg: ConfigObject, blockName: string): JsonObject {
    return this.readGenericRule(this.rules[UH]!, ruleCfg, blockName);
  }

  protected readOverSFRRule(ruleCfg: ConfigObject, blockName: string): JsonObject {
    return this.readGenericRule(this.rules[SFR]!, ruleCfg, blockName);
  }

  protected readOverMSRRule(ruleCfg: ConfigObject, blockName: string): JsonObject {
    return this.readGenericRule(this.rules[MSR]!, ruleCfg, blockName);
  }

  protected readOverTurbineRule(ruleCfg: ConfigObject, blockName: string): JsonObject {
    return this.readGenericRule(this.rules[TURBINE]!, ruleCfg, blockName);
  }

  protected readOverFusionRule(ruleCfg: ConfigObject, blockName: string): JsonObject {
    return this.readGenericRule(this.rules[FUSION]!, ruleCfg, blockName);
  }

  /** `:481-540` — resolve every indexed rule target against the conglomeration. */
  protected resolvePostLoadRules(project: ProjectJson): void {
    for (const state of Object.values(this.rules)) {
      if (state.postLoad.size === 0) continue;
      const list = this.conglomerate(project, state.blockConfig, 'blocks');
      for (const [rule, index] of state.postLoad) {
        if (index === 0) {
          rule.block = moduleDefinition(state.zeroTarget);
          continue;
        }
        const block = list[index - 1];
        if (block === undefined) {
          throw new LegacyFormatError(
            `Invalid block index ${index} for rules of ${state.postNames.get(rule) ?? '?'}!`,
          );
        }
        rule.block = definitionOf(block);
      }
    }
  }

  /** `activeCoolerCombiner` (`:541-557`) — the main configuration only. */
  protected combineActiveCoolers(project: ProjectJson): void {
    const config = project.configuration.get(UH);
    if (config === undefined) return;
    const blocks = elementList(config, 'blocks');
    let activeCooler: JsonObject | null = null;
    for (let i = 0; i < blocks.length; ) {
      const block = blocks[i]!;
      if (modulesOf(block)[`${UH}:active_cooler`] !== undefined) {
        if (activeCooler === null) {
          activeCooler = block;
          i++;
          continue;
        }
        const merged = this.recipeListsFor(activeCooler);
        merged.coolers.push(...this.recipeListsFor(block).coolers);
        blocks.splice(i, 1);
        this.applyBlockRecipes(activeCooler, ['coolers']);
        continue;
      }
      i++;
    }
  }

  /**
   * The reference pass `Project.conglomerate` → `configuration.setReferences(false)`
   * performs on the **main** configuration: `RecipePortsModule.setLocalReferences`
   * points the input/output port blocks at their parent
   * (`overhaulSFR/RecipePortsModule.java:13-19`), which then hands them the
   * parent's recipe list (`DefinedPlanneratorRecipe.setReferences`, `:32-34`).
   * Addons are never passed through this, which is why only the main
   * configuration's ports carry `ncpf:block_recipes` in the goldens.
   */
  protected propagateRecipePortRecipes(project: ProjectJson): void {
    for (const [key, config] of project.configuration) {
      const portModule = `${key}:recipe_ports`;
      const blocks = elementList(config, 'blocks');
      for (const block of blocks) {
        const ports = modulesOf(block)[portModule];
        if (!isJsonObject(ports)) continue;
        const recipes = modulesOf(block)[BLOCK_RECIPES];
        if (recipes === undefined) continue;
        for (const end of ['input', 'output'] as const) {
          const definition = ports[end];
          if (!isJsonObject(definition)) continue;
          for (const portBlock of blocks) {
            if (!definitionsMatch(definitionOf(portBlock), definition)) continue;
            modulesOf(portBlock)[BLOCK_RECIPES] = cloneJson(recipes);
            break;
          }
        }
      }
    }
  }

  // -------------------------------------------------------------- bookkeeping

  /**
   * The Java per-block recipe lists. Blocks built here always come from a main
   * configuration, so the map is exact. A conglomeration block that Java copied
   * out of an addon is not tracked; for those the lists are reconstructed from
   * `ncpf:block_recipes` (`DefinedPlanneratorRecipe.convertFromObject` gives every
   * present recipe function module the *whole* module list).
   */
  protected recipeListsOf(block: JsonObject): RecipeLists {
    const known = this.blockRecipes.get(block);
    if (known !== undefined) return known;
    const modules = modulesOf(block);
    const recipes = modules[BLOCK_RECIPES];
    const all = isJsonObject(recipes) && Array.isArray(recipes.recipes) ? (recipes.recipes as JsonObject[]) : [];
    return {
      coolers: modules[`${UH}:active_cooler`] !== undefined ? all : [],
      fuels:
        modules[`${SFR}:fuel_cell`] !== undefined || modules[`${MSR}:fuel_vessel`] !== undefined ? all : [],
      irradiators: modules[`${SFR}:irradiator`] !== undefined || modules[`${MSR}:irradiator`] !== undefined ? all : [],
      heaters: modules[`${MSR}:heater`] !== undefined ? all : [],
      blankets: modules[`${FUSION}:breeding_blanket`] !== undefined ? all : [],
    };
  }

  protected recipeListsFor(block: JsonObject): RecipeLists {
    let lists = this.blockRecipes.get(block);
    if (lists === undefined) {
      lists = emptyRecipeLists();
      this.blockRecipes.set(block, lists);
    }
    return lists;
  }

  /**
   * `DefinedNCPFModularObject.setRecipes` (`:96-106`) and
   * `DefinedPlanneratorRecipe.convertToObject` (`:42-44`): every recipe module is
   * serialised on its own, so a non-empty list *replaces* `ncpf:block_recipes`
   * (clear + copy) while an empty one leaves the module container untouched.
   */
  protected applyBlockRecipes(block: JsonObject, order: readonly (keyof RecipeLists)[]): void {
    const lists = this.recipeListsFor(block);
    for (const key of order) {
      const recipes = lists[key];
      if (recipes.length === 0) continue;
      modulesOf(block)[BLOCK_RECIPES] = { recipes: recipes.map((recipe) => cloneJson(recipe)) };
    }
  }

  /** `postLoadBlockFromIndex` (`:560-575`) — the conglomeration index space. */
  protected conglomerate(project: ProjectJson, configKey: string, listKey: string): JsonObject[] {
    const main = project.configuration.get(configKey);
    const mainList = main === undefined ? [] : elementList(main, listKey);
    const addonLists: JsonObject[][] = [];
    for (const addon of project.addons) {
      const config = addon.configuration.get(configKey);
      if (config !== undefined) addonLists.push(elementList(config, listKey));
    }
    return conglomerateList(mainList, addonLists);
  }

  /** `NonRecoveryHandler.recoverFallbackID` (`NonRecoveryHandler.java:10-13`). */
  protected recoverElement(type: string, list: readonly JsonObject[], index: number): JsonObject {
    const found = list[index];
    if (index >= 0 && found !== undefined) return found;
    throw new LegacyFormatError(`Invalid ${type} index: ${index}!`);
  }

  /**
   * `NCPFObject.setIndex` (`:294-296`): the serialised value is
   * `indexof(element, list)` — the first element with a matching definition, or
   * -1. Reading validates the index the way the recovery handler does.
   */
  protected recoverIndex(type: string, list: readonly JsonObject[], index: number): number {
    const found = this.recoverElement(type, list, index);
    const definition = definitionOf(found);
    for (let i = 0; i < list.length; i++) {
      if (definitionsMatch(definitionOf(list[i]!), definition)) return i;
    }
    return -1;
  }
}

// ------------------------------------------------------------------ utilities

function configurationsToJson(configurations: Map<string, JsonObject>): JsonObject {
  const out: JsonObject = {};
  for (const [key, config] of configurations) out[key] = config;
  return out;
}

/** `inputCfg.legacyNames` for a recipe (`:866-875`). */
function applyRecipeLegacyNames(modules: JsonObject, inputCfg: ConfigObject): void {
  if (inputCfg.hasProperty('legacyNames')) {
    modules[LEGACY_NAMES] = legacyNamesModule(stringList(inputCfg, 'legacyNames'));
  }
}

function writeDisplayNameInto(module: JsonObject, displayName: string | null): void {
  if (displayName !== null) module.display_name = displayName;
}

/** The design object skeleton: type, dimensions and the metadata module. */
export function createDesignJson(type: string, dimensions: readonly number[]): JsonObject {
  return { type, dimensions: [...dimensions], modules: { [METADATA]: {} } };
}

export type Cell = JsonObject | null;

export function emptyCells(x: number, y: number, z: number): Cell[][][] {
  return Array.from({ length: x }, () => Array.from({ length: y }, () => Array.from({ length: z }, () => null as Cell)));
}

/** `NCPFObject.setDefined3DArray` (`:83-97`): every cell, -1 for null. */
export function blockIndices(cells: Cell[][][], blocks: readonly JsonObject[]): number[][][] {
  const indices: number[][][] = [];
  for (let x = 0; x < cells.length; x++) {
    const plane: number[][] = [];
    for (let y = 0; y < cells[x]!.length; y++) {
      const row: number[] = [];
      for (let z = 0; z < cells[x]![y]!.length; z++) {
        const cell = cells[x]![y]![z];
        row.push(cell === null ? -1 : indexOfDefinition(blocks, definitionOf(cell)));
      }
      plane.push(row);
    }
    indices.push(plane);
  }
  return indices;
}

/**
 * `NCPFObject.setDefined3DArray` + `setRecipe3DArray` (`:83-97`, `:172-189`): the
 * block index array plus the *compacted* recipe array — a row is only present
 * when it holds at least one recipe-bearing cell, and each such cell contributes
 * `indexof(recipes[cell], cell.blockRecipes.recipes)` (-1 for a null recipe).
 */
export function writeDesign(design: JsonObject, cells: Cell[][][], recipes: Cell[][][], blocks: readonly JsonObject[]): void {
  design.design = blockIndices(cells, blocks);
  const recipeIndices: number[][][] = [];
  for (let x = 0; x < cells.length; x++) {
    const plane: number[][] = [];
    for (let y = 0; y < cells[x]!.length; y++) {
      const row: number[] = [];
      for (let z = 0; z < cells[x]![y]!.length; z++) {
        const cell = cells[x]![y]![z];
        if (cell === null) continue;
        const module = modulesOf(cell)[BLOCK_RECIPES];
        if (!isJsonObject(module) || !Array.isArray(module.recipes)) continue;
        const recipe = recipes[x]![y]![z];
        row.push(recipe === null ? -1 : indexOfDefinition(module.recipes as JsonObject[], definitionOf(recipe)));
      }
      if (row.length > 0) plane.push(row);
    }
    if (plane.length > 0) recipeIndices.push(plane);
  }
  design.block_recipes = recipeIndices;
}

/** `NCPFObject.indexof` (`:282-288`). */
function indexOfDefinition(list: readonly JsonObject[], definition: JsonObject): number {
  for (let i = 0; i < list.length; i++) {
    if (definitionsMatch(definitionOf(list[i]!), definition)) return i;
  }
  return -1;
}

/**
 * `block.toggled`, as set by the reference pass:
 *  - a coolant vent finds the last vent in the list with the opposite `output`
 *    (`overhaulSFR/CoolantVentModule.java:22-28`);
 *  - a neutron shield points at its `closed` reference
 *    (`NeutronShieldModule.java:21-26`);
 *  - a recipe port is paired with its sibling by `RecipePortsModule`
 *    (`overhaulSFR/RecipePortsModule.java:13-19`), i.e. the same definition with
 *    the `active` blockstate flipped.
 */
export function toggledBlock(block: JsonObject, blocks: readonly JsonObject[]): JsonObject {
  const modules = modulesOf(block);
  const vent = modules[`${SFR}:coolant_vent`];
  if (isJsonObject(vent)) {
    let other: JsonObject | null = null;
    for (const candidate of blocks) {
      const candidateVent = modulesOf(candidate)[`${SFR}:coolant_vent`];
      if (isJsonObject(candidateVent) && candidateVent.output !== vent.output) other = candidate;
    }
    return other ?? block;
  }
  const shield = modules[`${SFR}:neutron_shield`] ?? modules[`${MSR}:neutron_shield`];
  if (isJsonObject(shield) && isJsonObject(shield.closed)) {
    for (const candidate of blocks) {
      if (definitionsMatch(definitionOf(candidate), shield.closed)) return candidate;
    }
  }
  const definition = definitionOf(block);
  const state = isJsonObject(definition.blockstate) ? definition.blockstate : {};
  const target: JsonObject = { ...definition, blockstate: { ...state, active: state.active !== true } };
  for (const candidate of blocks) {
    if (definitionsMatch(definitionOf(candidate), target)) return candidate;
  }
  return block;
}
