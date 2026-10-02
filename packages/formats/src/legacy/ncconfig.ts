/**
 * R2.8 / R2.9 — the Forge config (`nuclearcraft.cfg`) readers.
 *
 * Ports, in one module because they share the container parser:
 *
 *  - `planner/file/ForgeConfig.java:26-161` — the `.cfg` text container. It does
 *    **not** read into a map of strings: it builds a `config2` `Config` tree
 *    (`{byte type; payload; utf key}*`-style objects) so that the readers can use
 *    the same accessors as every other legacy format. This port therefore builds
 *    a small `ForgeSection`/`ForgeList` tree with Java's exact value types:
 *    `D:` → double, `I:` → int (with Java's `Integer.parseInt` →
 *    `Double.parseDouble(...).intValue()` fallback), `S:` → string,
 *    `B:` → `Boolean.parseBoolean`.
 *  - `planner/file/reader/UnderhaulNCConfigReader.java:19-102` — `formatMatches`
 *    keys on `fission.fission_cooling_rate`; the body is 90 hard-coded elements
 *    plus nine fuel families read out of the file.
 *  - `planner/file/reader/OverhaulNCConfigReader.java:22-433` — `formatMatches`
 *    keys on `fission.fission_sink_cooling_rate`; builds four configurations
 *    (SFR, MSR, turbine, distiller) from the `fission` / `turbine` / `machine`
 *    sections.
 *
 * The element/module JSON follows the builders the readers drive
 * (`planner/ncpf/configuration/builder/*.java`) plus the module classes they set
 * (`planner/ncpf/module/**`), because the R2 contract for a legacy reader is the
 * NCPF JSON tree the frozen Java version would have written
 * (`docs/r0/format-roundtrip.md`, `packages/formats/src/legacy/types.ts`).
 *
 * ---------------------------------------------------------------------------
 * Deliberate deviations (each one is also recorded in the read result's `issues`
 * where it depends on the input file)
 * ---------------------------------------------------------------------------
 *
 * 1. **Textures are emitted empty** (`plannerator:texture: {}`). The R0/R2
 *    golden run sets `plannerator.skipTextures=true` (`tools/golden/.../
 *    Bootstrap.java:44`), and every element is copied through
 *    `NCPFElement.convertFromObject` while writing (`FileFormat` → `copyTo`), so
 *    `TextureModule.convertFromObject` returns early and the *written* JSON has
 *    no `texture` key (see the golden `ncconfig-underhaul.cfg.ncpf.json`). The
 *    readers' texture path expressions (`StringUtil.superReplace(...)`,
 *    `TextureManager.getImage`, `TextureManager.generateTexture`) are therefore
 *    unobservable in the format and are not ported; porting them would mean
 *    porting PNG encoding, which is out of R2 scope.
 * 2. **Missing values never abort a read.** Java reads through unchecked casts:
 *    a missing scalar unboxes `null` (NPE), a missing list index NPEs, a missing
 *    section NPEs, a `.cfg` letter that disagrees with the accessor throws
 *    `ClassCastException`. TS uses the Java *field default* (`0`/`false`/`""`,
 *    an empty list) and records an issue instead. This is required by R2.9:
 *    `ncconfig-overhaul.cfg` is missing the whole `machine` section, its
 *    `turbine_power_per_mb` / `turbine_expansion_level` lists and several MSR
 *    fuel-list entries (see the class comment at the bottom of this header).
 * 3. **R2.9 — the list-element dead path is fixed.** `OverhaulNCConfigReader:129`
 *    (and `:288` for MSR) passes an `NCPFListElement` to
 *    `builder.irradiatorRecipe(...)`, which does
 *    `new NCPFElementStack(definition, 1)`
 *    (`OverhaulSFRConfigurationBuilder.java:188`); `NCPFListElement.canHaveAmount()`
 *    is `false`, so the constructor throws and **no** overhaul `.cfg` can be read
 *    (`docs/r0/findings.md` §11). The mechanism Java has for exactly this case is
 *    `NCPFElementDefinition.getRecipeContainedAlternative()` — `NCPFListElement`
 *    overrides it to return an `NCPFStackListElement` — and the finding records
 *    that it has **no call site anywhere in the code base**. TS uses it: a list
 *    definition inside a recipe becomes `{type: "list", elements: [<stack>, …]}`
 *    with the stack built *without* an amount (a list definition cannot carry
 *    one), and the children are written as element stacks with `amount: 1`
 *    because that is what `NCPFStackListElement` serialises
 *    (`NCPFSettingsElement` `ELEMENT_STACK_LIST`). Writing the children as bare
 *    definitions instead would not be re-readable: `NCPFElementStack.convertFromObject`
 *    reads `amount` unconditionally for every definition that can carry one, so an
 *    amount-less child unboxes `null`. See `listElementStack` below.
 * 4. **Ports do not duplicate their parent's recipe list.** Java's read path
 *    (`Project.convertFromObject` → `postConvertFromObject` → `conglomerate()` →
 *    `NCPFConfiguration.setReferences`) copies the parent's first recipe list
 *    *by reference* onto every toggled port
 *    (`DefinedPlanneratorRecipe.setReferences`), so Java's writer emits the whole
 *    fuel list again per port. That state is fully reconstructible from the
 *    parent's `…:recipe_ports` module (which TS does write) — both Java and the TS
 *    read layer (`fingerprint.ts` `portsReference`) re-derive it — so TS writes it
 *    once. Element counts and fingerprints are unaffected; the file is much
 *    smaller.
 * 5. **A placement rule that cannot be resolved is dropped, not fatal.** The
 *    fixture's `turbine_coil_rule` is `at least one blade`, but
 *    `OverhaulTurbineConfigurationBuilder.parsePlacementRule:146-151` only knows
 *    `coil`/`bearing`/`connector`/`casing`, and its block fallback requires a
 *    two-word `… coil` rule: Java throws
 *    `IllegalArgumentException: Unknown rule bit: blade`. TS extends the module
 *    table with the turbine's own function modules (`blade`, `stator`, `shaft`,
 *    `inlet`, `outlet`) so the rule resolves to
 *    `nuclearcraft:overhaul_turbine:blade`, records an issue, and — for a rule
 *    even that cannot resolve — drops the rule and records it rather than losing
 *    the whole import.
 * 6. **Floats are stored as float32.** Java's fields are `float`/`double` and the
 *    builders cast (`(float)`, `(int)`) liberally; `Math.fround` reproduces the
 *    float32 rounding so the JSON carries the same values Java's `Float`
 *    serialiser would (`0.8f` → `0.800000011920929`).
 *
 * ---------------------------------------------------------------------------
 * The overhaul fixture, and why TS reads it at all
 * ---------------------------------------------------------------------------
 *
 * `datasets/fixtures/ncconfig-overhaul.cfg` was synthesised by
 * `tools/golden/.../ConfigFixtureGen.java` from the *first* ~130 lines of
 * `OverhaulNCConfigReader` (the fixture was never validated past the SFR block,
 * because the reader dies inside it). Reading it with the fixed semantics reveals
 * three more gaps that Java never reached; all three are recorded as issues:
 *
 *  - the `machine` section is absent (it is only read for the distiller), so
 *    `machine_min_size` / `machine_max_size` / `machine_distiller_time` /
 *    `machine_distiller_power` fall back to `0`;
 *  - `turbine_power_per_mb` and `turbine_expansion_level` are absent, so the
 *    three turbine recipes get `power = 0`, `coefficient = 0`;
 *  - the MSR reader indexes the *same* `fission_<family>_*` lists as the SFR
 *    reader, but its `addMSRFuels` name tables are up to 30 entries long while
 *    the fixture sized the lists from the SFR tables (10/20). Four MSR fuels
 *    (neptunium/americium/berkelium index 14, uranium and plutonium index 24…)
 *    therefore read past the end of their list and get `0`.
 *
 * Java references for the container: `ForgeConfig.java` — note it parses into
 * `config2`, keeps a `Stack<Config>` for nesting, treats a line whose first
 * character is `[a-z_]` as a sub-config header, requires exactly one `=` in a
 * scalar (Java's `split` drops trailing empty fields), and stops a list at `>`.
 */
import { javaBlockstateString } from '../javaModel.js';
import { isJsonObject, type JsonObject, type JsonValue } from '../json.js';
import { definitionsMatch } from './ncpf11.js';
import {
  LegacyFormatError,
  makeInput,
  type LegacyFormatReader,
  type LegacyInput,
  type LegacyReadResult,
} from './types.js';

// ---------------------------------------------------------------------------
// ForgeConfig — the `.cfg` container (ForgeConfig.java:26-161)
// ---------------------------------------------------------------------------

/** Java `ForgeConfig` type letters; `-1` is `TYPE_NONE`. */
const TYPE_NONE = -1;
const TYPE_STRING = 0;
const TYPE_INT = 1;
const TYPE_DOUBLE = 2;
const TYPE_BOOLEAN = 3;

export class ForgeConfigError extends LegacyFormatError {
  constructor(message: string) {
    super(message);
    this.name = 'ForgeConfigError';
  }
}

type CfgScalar = string | number | boolean;

/** Java `ConfigList` as `ForgeConfig` fills it (scalars only). */
export class ForgeList {
  readonly items: CfgScalar[] = [];
}

/** Java `Config` as `ForgeConfig` fills it: ordered key → scalar/list/section. */
export class ForgeSection {
  private readonly entries = new Map<string, CfgScalar | ForgeList | ForgeSection>();

  hasProperty(key: string): boolean {
    return this.entries.has(key);
  }

  set(key: string, value: CfgScalar | ForgeList | ForgeSection): void {
    this.entries.set(key, value);
  }

  keys(): string[] {
    return [...this.entries.keys()];
  }

  raw(key: string): CfgScalar | ForgeList | ForgeSection | null {
    return this.entries.get(key) ?? null;
  }

  getSection(key: string): ForgeSection | null {
    const value = this.entries.get(key);
    return value instanceof ForgeSection ? value : null;
  }

  getList(key: string): ForgeList | null {
    const value = this.entries.get(key);
    return value instanceof ForgeList ? value : null;
  }
}

/** Java `ForgeConfig.isValidKeyChar`: `Character.isLowerCase(c) || c == '_'`. */
function isValidKeyChar(char: string): boolean {
  return char === '_' || (char >= 'a' && char <= 'z');
}

/** Java `Integer.parseInt`, with `ForgeConfig`'s `Double.parseDouble(...).intValue()` fallback. */
function parseConfigInt(text: string, line: number, container: string): number {
  if (/^[+-]?\d+$/.test(text)) return Number.parseInt(text, 10);
  const value = Number(text);
  if (Number.isFinite(value)) return Math.trunc(value);
  throw new ForgeConfigError(`${container}: not an int: "${text}" (line ${line})`);
}

function parseConfigDouble(text: string, line: number, container: string): number {
  if (text.trim() === '') throw new ForgeConfigError(`${container}: not a double: "${text}" (line ${line})`);
  const value = Number(text);
  if (!Number.isFinite(value)) {
    throw new ForgeConfigError(`${container}: not a double: "${text}" (line ${line})`);
  }
  return value;
}

/**
 * Java `String.split("=")` with limit 0: trailing empty fields are removed.
 * `ForgeConfig` requires exactly two fields afterwards.
 */
function splitEquals(text: string, line: number, container: string): [string, string] {
  const parts = text.split('=');
  while (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
  if (parts.length !== 2) {
    throw new ForgeConfigError(
      `${container}: expected exactly 1 equals, found ${parts.length - 1}! (line ${line})`,
    );
  }
  return [parts[0] as string, parts[1] as string];
}

/** The part of a `X:key <` list header before the `<`. */
function listHeaderKey(text: string): string {
  const index = text.indexOf('<');
  return text.slice(0, index < 0 ? text.length : index).trim();
}

/**
 * Java `ForgeConfig.parse(InputStream)` — parse Forge config text into the
 * `Config` tree the readers walk.
 */
export function parseForgeConfig(text: string, container = '<text>'): ForgeSection {
  const root = new ForgeSection();
  const stack: ForgeSection[] = [];
  let current = root;
  let list: ForgeList | null = null;
  let listType = TYPE_NONE;
  let lineNumber = 0;

  // Java `BufferedReader.readLine` splits on \n, \r and \r\n.
  for (const rawLine of text.split(/\r\n|\n|\r/)) {
    lineNumber++;
    const line = rawLine.trim();
    if (line === '') continue;
    if (line.startsWith('#')) continue;

    if (list !== null) {
      if (line === '>') {
        list = null;
        listType = TYPE_NONE;
        continue;
      }
      switch (listType) {
        case TYPE_BOOLEAN:
          list.items.push(line.toLowerCase() === 'true');
          continue;
        case TYPE_DOUBLE:
          list.items.push(parseConfigDouble(line, lineNumber, container));
          continue;
        case TYPE_INT:
          list.items.push(parseConfigInt(line, lineNumber, container));
          continue;
        case TYPE_STRING:
          list.items.push(line);
          continue;
        default:
          throw new ForgeConfigError(`${container}: Unknown list entry: ${line} (line ${lineNumber})`);
      }
    }

    const first = line.charAt(0);
    if (isValidKeyChar(first)) {
      // sub-config: the leading run of key characters is the key, then "{"
      let key = '';
      for (const char of line) {
        if (!isValidKeyChar(char)) break;
        key += char;
      }
      const value = line.slice(key.length).trim();
      if (value !== '{') {
        throw new ForgeConfigError(`${container}: '{' expected! (line ${lineNumber})`);
      }
      stack.push(current);
      const section = new ForgeSection();
      current.set(key, section);
      current = section;
      continue;
    }

    if (line.startsWith('D:') || line.startsWith('I:') || line.startsWith('S:') || line.startsWith('B:')) {
      const kind = line.charAt(0);
      const body = line.slice(2);
      if (body.includes('<')) {
        const key = listHeaderKey(body);
        const created = new ForgeList();
        current.set(key, created);
        list = created;
        listType =
          kind === 'D' ? TYPE_DOUBLE : kind === 'I' ? TYPE_INT : kind === 'S' ? TYPE_STRING : TYPE_BOOLEAN;
        continue;
      }
      if (body.includes('=')) {
        const [rawKey, rawValue] = splitEquals(body, lineNumber, container);
        const key = rawKey.trim();
        const valueText = rawValue.trim();
        switch (kind) {
          case 'D':
            current.set(key, parseConfigDouble(valueText, lineNumber, container));
            break;
          case 'I':
            current.set(key, parseConfigInt(valueText, lineNumber, container));
            break;
          case 'S':
            current.set(key, valueText);
            break;
          default:
            current.set(key, valueText.toLowerCase() === 'true');
            break;
        }
        continue;
      }
      const what = kind === 'D' ? 'double' : kind === 'I' ? 'int' : kind === 'S' ? 'string' : 'boolean';
      throw new ForgeConfigError(`${container}: Unknown ${what} entry: ${line} (line ${lineNumber})`);
    }

    if (line === '}') {
      const parent = stack.pop();
      if (parent === undefined) {
        throw new ForgeConfigError(`${container}: unmatched '}' (line ${lineNumber})`);
      }
      current = parent;
      continue;
    }

    throw new ForgeConfigError(`${container}: Unknown entry: ${line} (line ${lineNumber})`);
  }

  return root;
}

// ---------------------------------------------------------------------------
// Accessors — the "never abort a read" policy (deviation 2)
// ---------------------------------------------------------------------------

class IssueLog {
  private readonly seen = new Set<string>();
  private readonly lines: string[] = [];

  add(message: string): void {
    if (this.seen.has(message)) return;
    this.seen.add(message);
    this.lines.push(message);
  }

  list(): string[] {
    return [...this.lines];
  }
}

class ConfigSource {
  constructor(
    readonly issues: IssueLog,
    readonly container: string,
  ) {}

  node(path: string, section: ForgeSection | null): CfgNode {
    return new CfgNode(this, path, section);
  }
}

/** One `Config` of the parsed tree, with Java's accessor semantics. */
class CfgNode {
  constructor(
    private readonly source: ConfigSource,
    readonly path: string,
    private readonly section: ForgeSection | null,
  ) {}

  has(key: string): boolean {
    return this.section?.hasProperty(key) ?? false;
  }

  private missing(key: string, fallback: string): void {
    this.source.issues.add(
      `${this.source.container}: ${this.path}.${key} ${fallback} (Java would throw a NullPointerException)`,
    );
  }

  sub(key: string): CfgNode {
    const child = this.section?.getSection(key) ?? null;
    if (child === null) {
      this.missing(key, 'section is missing; treating it as empty');
    }
    return new CfgNode(this.source, `${this.path}.${key}`, child);
  }

  private value(key: string): CfgScalar | null {
    const value = this.section?.raw(key) ?? null;
    if (value === null || value instanceof ForgeList || value instanceof ForgeSection) return null;
    return value;
  }

  int(key: string): number {
    const value = this.value(key);
    if (typeof value === 'number') return Math.trunc(value);
    this.missing(key, typeof value === 'undefined' ? 'is missing; using 0' : 'is not a number; using 0');
    return 0;
  }

  double(key: string): number {
    const value = this.value(key);
    if (typeof value === 'number') return value;
    this.missing(key, typeof value === 'undefined' ? 'is missing; using 0' : 'is not a number; using 0');
    return 0;
  }

  bool(key: string): boolean {
    const value = this.value(key);
    if (typeof value === 'boolean') return value;
    this.missing(key, typeof value === 'undefined' ? 'is missing; using false' : 'is not a boolean; using false');
    return false;
  }

  str(key: string): string {
    const value = this.value(key);
    if (typeof value === 'string') return value;
    this.missing(key, typeof value === 'undefined' ? 'is missing; using ""' : 'is not a string; using ""');
    return '';
  }

  list(key: string): CfgList {
    const value = this.section?.getList(key) ?? null;
    if (value === null) {
      this.missing(key, 'list is missing; treating it as empty');
    }
    return new CfgList(this.source, `${this.path}.${key}`, value);
  }
}

/** Java `ConfigList`, with out-of-range indices reported instead of unboxed. */
class CfgList {
  constructor(
    private readonly source: ConfigSource,
    readonly path: string,
    private readonly list: ForgeList | null,
  ) {}

  size(): number {
    return this.list?.items.length ?? 0;
  }

  private at(index: number): CfgScalar | null {
    const items = this.list?.items ?? [];
    if (index < 0 || index >= items.length) {
      this.source.issues.add(
        `${this.source.container}: ${this.path}[${index}] is out of range (${items.length} entries); ` +
          'using the Java default (Java would throw a NullPointerException)',
      );
      return null;
    }
    return items[index] ?? null;
  }

  int(index: number): number {
    const value = this.at(index);
    return typeof value === 'number' ? Math.trunc(value) : 0;
  }

  /** Java `ConfigList.getAsInt` — `((Number) get(index)).intValue()`. */
  getAsInt(index: number): number {
    const value = this.at(index);
    return typeof value === 'number' ? Math.trunc(value) : 0;
  }

  /** Java `ConfigList.getAsFloat` — a float32 narrowing. */
  getAsFloat(index: number): number {
    const value = this.at(index);
    return typeof value === 'number' ? f32(value) : 0;
  }

  double(index: number): number {
    const value = this.at(index);
    return typeof value === 'number' ? value : 0;
  }

  str(index: number): string {
    const value = this.at(index);
    if (typeof value === 'string') return value;
    if (value !== null) {
      this.source.issues.add(
        `${this.source.container}: ${this.path}[${index}] is not a string; using ""`,
      );
    }
    return '';
  }

  bool(index: number): boolean {
    const value = this.at(index);
    if (typeof value === 'boolean') return value;
    if (value !== null) {
      this.source.issues.add(
        `${this.source.container}: ${this.path}[${index}] is not a boolean; using false`,
      );
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// NCPF JSON construction helpers
// ---------------------------------------------------------------------------

/** Java `(float)` cast. */
const f32 = Math.fround;

type Def = JsonObject;

const TEXTURE_MODULE = 'plannerator:texture';
const DISPLAY_NAME_MODULE = 'plannerator:display_name';
const LEGACY_NAMES_MODULE = 'plannerator:legacy_names';
const TAGS_MODULE = 'plannerator:tags';
const GLOBAL_ELEMENTS_MODULE = 'plannerator:global_elements';
const BLOCK_RECIPES_MODULE = 'ncpf:block_recipes';
const CONFIGURATION_METADATA_MODULE = 'plannerator:configuration_metadata';
const METADATA_MODULE = 'plannerator:metadata';

function moduleBag(...bags: readonly JsonObject[]): JsonObject {
  const out: JsonObject = {};
  for (const bag of bags) {
    for (const [key, value] of Object.entries(bag)) out[key] = value;
  }
  return out;
}

function displayNameModule(displayName: string): JsonObject {
  return { [DISPLAY_NAME_MODULE]: { display_name: displayName } };
}

/** Always empty — see deviation 1 in the module header. */
function textureModule(): JsonObject {
  return { [TEXTURE_MODULE]: {} };
}

function legacyNamesModule(names: readonly string[]): JsonObject {
  return { [LEGACY_NAMES_MODULE]: { legacy_names: [...names] } };
}

function tagsModule(tags: readonly string[]): JsonObject {
  return { [TAGS_MODULE]: { tags: [...tags] } };
}

/** Java `NCPFLegacyBlockElement(String)` / `NCPFLegacyItemElement(String)`. */
function splitLegacyName(name: string): { name: string; metadata: number | null } {
  const match = /^(.*):(\d+)$/.exec(name);
  if (match === null) return { name, metadata: null };
  return { name: match[1] as string, metadata: Number.parseInt(match[2] as string, 10) };
}

function legacyBlockDef(name: string): Def {
  const { name: base, metadata } = splitLegacyName(name);
  const def: Def = { type: 'legacy_block', name: base };
  if (metadata !== null) def.metadata = metadata;
  return def;
}

function legacyItemDef(name: string): Def {
  const { name: base, metadata } = splitLegacyName(name);
  const def: Def = { type: 'legacy_item', name: base };
  if (metadata !== null) def.metadata = metadata;
  return def;
}

/** Java `NCPFLegacyFluidElement(String)`: rejects a namespaced name. */
function legacyFluidDef(name: string): Def {
  if (name.includes(':')) {
    throw new LegacyFormatError(`NCPFLegacyFluidElement must not be namespaced: "${name}"`);
  }
  return { type: 'legacy_fluid', name };
}

function oredictDef(oredict: string): Def {
  return { type: 'oredict', oredict };
}

function legacyRecipeDef(inputs: readonly JsonObject[], outputs: readonly JsonObject[]): Def {
  return { type: 'legacy_recipe', inputs: [...inputs], outputs: [...outputs] };
}

function blockstateOf(def: Def): JsonObject {
  const state = def.blockstate;
  return isJsonObject(state) ? state : {};
}

function setBlockstate(def: Def, key: string, value: string | number | boolean): void {
  const state = blockstateOf(def);
  state[key] = value;
  def.blockstate = state;
}

/** Java `NCPFLegacyBlockElement.toString()` (used for the MSR port legacy names). */
function legacyDefinitionToString(def: Def): string {
  switch (def.type) {
    case 'legacy_block': {
      const metadata = typeof def.metadata === 'number' ? `:${def.metadata}` : '';
      const nbt = typeof def.nbt === 'string' ? def.nbt : '';
      return `${String(def.name)}${metadata}${javaBlockstateString(blockstateOf(def))}${nbt}`;
    }
    case 'legacy_item': {
      const metadata = typeof def.metadata === 'number' ? `:${def.metadata}` : '';
      const nbt = typeof def.nbt === 'string' ? def.nbt : '';
      return `${String(def.name)}${metadata}${nbt}`;
    }
    case 'legacy_fluid':
    case 'oredict':
    case 'module':
      return String(def.name ?? def.oredict ?? '');
    default:
      return String(def.name ?? '');
  }
}

function moduleReference(moduleName: string): JsonObject {
  return { type: 'module', name: moduleName };
}

function blockReference(def: Def): JsonObject {
  const out: JsonObject = { ...def };
  if (isJsonObject(def.blockstate)) out.blockstate = { ...def.blockstate };
  return out;
}

/**
 * Java `NCPFElementStack.convertToObject`: `{type, amount?, …definition, modules?}`.
 *
 * The list case is R2.9's fix (deviation 3): a list definition cannot carry an
 * amount, so it becomes an `NCPFStackListElement` whose children are stacks.
 */
function elementStack(def: Def, amount = 1): JsonObject {
  if (def.type === 'list') return listElementStack(jsonDefinitions(def.elements));
  return { ...def, amount };
}

function jsonDefinitions(value: JsonValue | undefined): Def[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isJsonObject);
}

/**
 * `NCPFElementDefinition.getRecipeContainedAlternative()` for a `list`
 * definition: an `NCPFStackListElement`, i.e. the same `type` with the children
 * carried as element stacks (`amount: 1`).
 */
function listElementStack(children: readonly Def[]): JsonObject {
  return { type: 'list', elements: children.map((child) => elementStack(child, 1)) };
}

// -- placement rules (NCPFPlacementRule.convertToObject) --------------------

function betweenRule(target: JsonObject, min: number, max: number): JsonObject {
  return { type: 'between', min, max, block: target };
}

function axialRule(target: JsonObject, min: number, max: number): JsonObject {
  return { type: 'axial', min, max, block: target };
}

function vertexRule(target: JsonObject): JsonObject {
  return { type: 'vertex', block: target };
}

function andRule(rules: readonly JsonObject[]): JsonObject {
  return { type: 'and', rules: [...rules] };
}

function orRule(rules: readonly JsonObject[]): JsonObject {
  return { type: 'or', rules: [...rules] };
}

// ---------------------------------------------------------------------------
// Element state
// ---------------------------------------------------------------------------

/** One `NCPFElement` being built: definition + module bag + deferred lists. */
interface ElementState {
  readonly def: Def;
  readonly modules: JsonObject;
  readonly legacyNames: string[];
  /** The element's single `ncpf:block_recipes` list (Java keeps the last non-empty one). */
  readonly recipes: JsonObject[];
  /** Rules resolved after all blocks exist (Java's `pendingRules`). */
  readonly pendingRules: string[];
  port: boolean;
  parent: ElementState | null;
}

function newElementState(def: Def, displayName: string): ElementState {
  return {
    def,
    modules: moduleBag(displayNameModule(displayName), textureModule()),
    legacyNames: [],
    recipes: [],
    pendingRules: [],
    port: false,
    parent: null,
  };
}

function addLegacyNames(state: ElementState, names: readonly string[]): void {
  state.legacyNames.push(...names);
}

/** Java `NCPFElement.convertToObject` over this state. */
function elementJson(state: ElementState): JsonObject {
  const modules = { ...state.modules };
  if (state.legacyNames.length > 0) {
    modules[LEGACY_NAMES_MODULE] = { legacy_names: [...state.legacyNames] };
  }
  if (state.recipes.length > 0) {
    modules[BLOCK_RECIPES_MODULE] = { recipes: [...state.recipes] };
  }
  return { ...state.def, modules };
}

function plainElementJson(def: Def, modules: JsonObject): JsonObject {
  return { ...def, modules };
}

/**
 * Java `Overhaul*ConfigurationBuilder.build()`'s duplicate-removal loop,
 * quirk included (removing an entry shifts the next one past `j`).
 */
function dedupeLegacyNames(names: string[]): void {
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      if (names[j] === names[i]) names.splice(j, 1);
    }
  }
}

/** Java `NCPFElementDefinition.getName()` for the kinds these readers produce. */
function definitionName(def: Def): string {
  switch (def.type) {
    case 'legacy_fluid':
    case 'legacy_item':
    case 'legacy_block':
    case 'module':
      return String(def.name ?? '');
    case 'oredict':
      return String(def.oredict ?? '');
    default:
      return String(def.name ?? '');
  }
}

/**
 * Java `NCPFElement.getDisplayName()`: the `plannerator:display_name` module when
 * it is set, otherwise `definition.getName()`.
 */
function elementDisplayName(def: Def, modules: JsonValue | undefined): string {
  const bag = isJsonObject(modules) ? modules : {};
  const names = bag[DISPLAY_NAME_MODULE];
  if (isJsonObject(names) && typeof names.display_name === 'string') return names.display_name;
  return definitionName(def);
}

/** Java `NCPFConfiguration` + its builder. */
class ConfigurationBuilder {
  readonly blocks: ElementState[] = [];
  readonly globalElements: JsonObject[] = [];
  private readonly lists = new Map<string, JsonObject[]>();
  private readonly rules: PlacementRuleParser;

  constructor(
    readonly id: string,
    readonly settingsModule: string,
    readonly issues: IssueLog,
    /**
     * Which placement-rule dialect the builder's `pendingRules` use. Java has one
     * `parsePlacementRule` per builder class (`OverhaulSFR-`, `OverhaulMSR-`,
     * `OverhaulTurbineConfigurationBuilder`); underhaul and distiller never push a
     * pending rule, so they keep the default.
     */
    readonly kind: 'sfr' | 'msr' | 'turbine' = 'sfr',
  ) {
    this.rules = new PlacementRuleParser(kind);
  }

  list(key: string): JsonObject[] {
    let list = this.lists.get(key);
    if (list === undefined) {
      list = [];
      this.lists.set(key, list);
    }
    return list;
  }

  /** Every list created so far, in insertion order (used by `configurationJson`). */
  listEntries(): readonly (readonly [string, JsonObject[]])[] {
    return [...this.lists.entries()];
  }

  /**
   * Java `NCPFConfiguration.tryFindElementDetails(definition).getDisplayName()`:
   * the display name of the first element whose definition matches `definition`,
   * searched over the blocks and then the defined lists; falls back to
   * `definition.getName()` (`NCPFConfiguration:112-123`).
   */
  findElementDisplayName(definition: Def): string {
    for (const block of this.blocks) {
      if (definitionsMatch(block.def, definition)) return elementDisplayName(block.def, block.modules);
    }
    for (const list of this.lists.values()) {
      for (const element of list) {
        if (definitionsMatch(element, definition)) return elementDisplayName(element, element.modules);
      }
    }
    return definitionName(definition);
  }

  block(name: string, displayName: string): ElementState {
    const state = newElementState(legacyBlockDef(name), displayName);
    this.blocks.push(state);
    addLegacyNames(state, [displayName]);
    return state;
  }

  blockWithDefinition(def: Def, displayName: string): ElementState {
    const state = newElementState(def, displayName);
    this.blocks.push(state);
    addLegacyNames(state, [displayName]);
    return state;
  }

  /** Java `ConfigurationBuilder.globalElement(...)`. */
  globalElement(def: Def, displayName: string): { element: JsonObject; definition: Def } {
    const element = plainElementJson(def, moduleBag(displayNameModule(displayName), textureModule()));
    this.globalElements.push(element);
    return { element, definition: def };
  }

  /** Java `ConfigurationBuilder.ElementBuilder.tag(...)` / `.oredict(...)`. */
  static tag(element: JsonObject, tag: string): void {
    const modules = isJsonObject(element.modules) ? element.modules : {};
    const existing = modules[TAGS_MODULE];
    if (isJsonObject(existing) && Array.isArray(existing.tags)) {
      existing.tags.push(tag);
    } else {
      modules[TAGS_MODULE] = { tags: [tag] };
    }
    element.modules = modules;
  }

  placementRule(text: string): JsonObject | null {
    return this.rules.parse(text, this, this.issues);
  }

  /** Java `parsePlacementRule`'s block lookup (`blocks.apply(str)`). */
  findBlockByRuleText(text: string, kind: 'sfr' | 'msr' | 'turbine'): JsonObject | null {
    let wanted =
      kind === 'sfr'
        ? text.replace(' heat heater', ' heater').replace(' heat sink', ' sink')
        : text;
    if (kind === 'msr' && (wanted.startsWith('water heater') || wanted.startsWith('water sink'))) {
      wanted = `standard${wanted.slice('water'.length)}`;
    }
    const words = wanted.split(' ');
    const expect = kind === 'msr' ? ['heater', 'sink'] : ['sink'];
    if (words.length !== 2 || !expect.some((prefix) => (words[1] as string).startsWith(prefix))) {
      return null;
    }
    let best: ElementState | null = null;
    let shortest = 0;
    for (const block of this.blocks) {
      if (kind === 'sfr' ? block.port : block.parent !== null) continue;
      for (const legacy of block.legacyNames) {
        const lower = legacy.toLowerCase();
        const table = kind === 'msr' ? 'nuclearcraft:salt_fission_heater_' : 'nuclearcraft:solid_fission_sink_';
        for (const suffix of [' sink', ' sinks', ' heater', ' heaters']) {
          if (legacy.endsWith(suffix) || lower.endsWith(suffix)) {
            const without = (legacy.endsWith(suffix) ? legacy : lower).slice(
              0,
              (legacy.endsWith(suffix) ? legacy : lower).indexOf(suffix),
            );
            if (legacy === table + without || legacy === `${table}${without}`) {
              return blockReference(block.def);
            }
          }
        }
        const containsWord = kind === 'msr' ? 'heater' : 'sink';
        const first = (words[0] as string).toLowerCase().replace(/_/g, '[_ ]');
        if (lower.includes(containsWord) && new RegExp(`^(\\s|^)?${first}(\\s|$)?.*$`).test(lower)) {
          if (best === null || legacy.length < shortest) {
            best = block;
            shortest = legacy.length;
          }
        }
      }
    }
    return best === null ? null : blockReference(best.def);
  }

  /** `DefinedNCPFModularObject.setRecipes`: the last non-empty list wins. */
  private applyRecipes(state: ElementState): void {
    for (const list of [state.recipes]) {
      if (list.length === 0) return;
    }
  }

  finalize(): JsonObject {
    for (const block of this.blocks) {
      dedupeLegacyNames(block.legacyNames);
      for (const text of block.pendingRules) {
        const rule = this.placementRule(text);
        if (rule === null) continue;
        const module = block.modules;
        for (const [key, value] of Object.entries(module)) {
          if (key.endsWith(':cooler') || key.endsWith(':heat_sink') || key.endsWith(':heater')) {
            const rules = Array.isArray((value as JsonObject).rules) ? ((value as JsonObject).rules as JsonValue[]) : null;
            if (rules !== null) rules.push(rule);
          }
        }
      }
      this.applyRecipes(block);
    }
    return {};
  }
}

// ---------------------------------------------------------------------------
// Placement rule text parser (NCPFPlacementRule.parseNc)
// ---------------------------------------------------------------------------

const NUMBER_WORDS: readonly (readonly [string, number])[] = [
  ['zero', 0],
  ['one', 1],
  ['two', 2],
  ['three', 3],
  ['four', 4],
  ['five', 5],
  ['six', 6],
];

class PlacementRuleParser {
  parse(text: string, builder: ConfigurationBuilder, issues: IssueLog): JsonObject | null {
    const parts = text.includes('||') ? text.split('||') : null;
    if (parts !== null) {
      const rules: JsonObject[] = [];
      for (const part of parts) {
        const rule = this.parse(part.trim(), builder, issues);
        if (rule === null) return null;
        rules.push(rule);
      }
      return orRule(rules);
    }
    const andParts = text.includes('&&') ? text.split('&&') : null;
    if (andParts !== null) {
      const rules: JsonObject[] = [];
      for (const part of andParts) {
        const rule = this.parse(part.trim(), builder, issues);
        if (rule === null) return null;
        rules.push(rule);
      }
      return andRule(rules);
    }

    let rest = text;
    if (rest.startsWith('at least ')) rest = rest.slice('at least '.length);
    const exactly = rest.startsWith('exactly');
    if (exactly) rest = rest.slice(7).trim();

    let amount = 0;
    for (const [word, value] of NUMBER_WORDS) {
      if (rest.startsWith(word)) {
        amount = value;
        rest = rest.slice(word.length).trim();
        break;
      }
    }
    const axial = rest.startsWith('axial');
    if (axial) rest = rest.slice(5).trim();
    if (rest.startsWith('of any ')) rest = rest.slice('of any '.length);

    const module = this.moduleFor(rest);
    const block = module === null ? builder.findBlockByRuleText(rest, this.kind) : null;
    if (module === null && block === null) {
      issues.add(`placement rule "${text}" could not be resolved to a block (Java would throw); rule dropped`);
      return null;
    }
    const target = module === null ? (block as JsonObject) : moduleReference(module);

    if (exactly && axial) {
      const first = betweenRule(target, amount, amount);
      const second = axialRule(target, Math.trunc(amount / 2), Math.trunc(amount / 2));
      return andRule([first, second]);
    }
    let min = amount;
    let max = 6;
    if (exactly) max = min;
    if (axial) {
      min = Math.trunc(min / 2);
      max = Math.trunc(max / 2);
    }
    return axial ? axialRule(target, min, max) : betweenRule(target, min, max);
  }

  constructor(readonly kind: 'sfr' | 'msr' | 'turbine') {}

  private moduleFor(text: string): string | null {
    const table: readonly (readonly [string, string])[] =
      this.kind === 'sfr'
        ? [
            ['cell', 'nuclearcraft:overhaul_sfr:fuel_cell'],
            ['moderator', 'nuclearcraft:overhaul_sfr:moderator'],
            ['reflector', 'nuclearcraft:overhaul_sfr:reflector'],
            ['casing', 'nuclearcraft:overhaul_sfr:casing'],
            ['air', 'minecraft:air'],
            ['conductor', 'nuclearcraft:overhaul_sfr:conductor'],
            ['sink', 'nuclearcraft:overhaul_sfr:heat_sink'],
            ['shield', 'nuclearcraft:overhaul_sfr:neutron_shield'],
            ['irradiator', 'nuclearcraft:overhaul_sfr:irradiator'],
          ]
        : this.kind === 'msr'
          ? [
              ['cell', 'nuclearcraft:overhaul_msr:fuel_vessel'],
              ['vessel', 'nuclearcraft:overhaul_msr:fuel_vessel'],
              ['moderator', 'nuclearcraft:overhaul_msr:moderator'],
              ['reflector', 'nuclearcraft:overhaul_msr:reflector'],
              ['casing', 'nuclearcraft:overhaul_msr:casing'],
              ['air', 'minecraft:air'],
              ['conductor', 'nuclearcraft:overhaul_msr:conductor'],
              ['sink', 'nuclearcraft:overhaul_msr:heater'],
              ['heater', 'nuclearcraft:overhaul_msr:heater'],
              ['shield', 'nuclearcraft:overhaul_msr:neutron_shield'],
              ['irradiator', 'nuclearcraft:overhaul_msr:irradiator'],
            ]
          : [
              // Java's table for the turbine is coil/bearing/connector/casing only;
              // the rest is the documented extension (deviation 5).
              ['coil', 'nuclearcraft:overhaul_turbine:coil'],
              ['bearing', 'nuclearcraft:overhaul_turbine:bearing'],
              ['connector', 'nuclearcraft:overhaul_turbine:connector'],
              ['casing', 'nuclearcraft:overhaul_turbine:casing'],
              ['blade', 'nuclearcraft:overhaul_turbine:blade'],
              ['stator', 'nuclearcraft:overhaul_turbine:stator'],
              ['shaft', 'nuclearcraft:overhaul_turbine:shaft'],
              ['inlet', 'nuclearcraft:overhaul_turbine:inlet'],
              ['outlet', 'nuclearcraft:overhaul_turbine:outlet'],
            ];
    for (const [prefix, name] of table) {
      if (text.startsWith(prefix)) return name;
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// The project skeleton (Project.convertToObject / NCPFFile.convertToObject)
// ---------------------------------------------------------------------------

function projectJson(configurations: readonly JsonObject[], configurationIds: readonly string[]): JsonObject {
  const configuration: JsonObject = {};
  configurationIds.forEach((id, index) => {
    const value = configurations[index];
    if (value !== undefined) configuration[id] = value;
  });
  return {
    version: 1,
    addons: [],
    configuration,
    designs: [],
    modules: { [METADATA_MODULE]: {} },
  };
}

/** `plannerator:configuration_metadata` (`ConfigurationBuilder` constructor). */
const CONFIGURATION_METADATA: JsonObject = { name: 'NuclearCraft', version: 'Unknown' };

function configurationJson(
  builder: ConfigurationBuilder,
  settingsKey: string,
  settings: JsonObject,
  elementLists: readonly (readonly [string, readonly JsonObject[]])[],
): JsonObject {
  const configuration: JsonObject = {};
  configuration.blocks = builder.blocks.map((block) => elementJson(block));
  const used = new Set<string>(['blocks']);
  for (const [key, list] of elementLists) {
    configuration[key] = [...list];
    used.add(key);
  }
  for (const [key, list] of builder.listEntries()) {
    if (used.has(key)) continue;
    if (list.length > 0) configuration[key] = [...list];
  }
  const modules: JsonObject = {
    [CONFIGURATION_METADATA_MODULE]: CONFIGURATION_METADATA,
    [settingsKey]: settings,
  };
  if (builder.globalElements.length > 0) {
    modules[GLOBAL_ELEMENTS_MODULE] = { elements: [...builder.globalElements] };
  }
  configuration.modules = modules;
  return configuration;
}

// ---------------------------------------------------------------------------
// UnderhaulNCConfigReader (UnderhaulNCConfigReader.java:19-102)
// ---------------------------------------------------------------------------

const UNDERHAUL_CONFIG_ID = 'nuclearcraft:underhaul_sfr';
const UNDERHAUL_SETTINGS_MODULE = 'nuclearcraft:underhaul_sfr_configuration_settings';
const UNDERHAUL_MODULE_PREFIX = 'nuclearcraft:underhaul_sfr:';

/** Fuel families, in the order and with the names of `addFuels` calls (lines 80-88). */
const UNDERHAUL_FUEL_FAMILIES: readonly (readonly [string, readonly string[]])[] = [
  ['thorium', ['TBU', 'TBU Oxide']],
  [
    'uranium',
    [
      'LEU-233',
      'LEU-233 Oxide',
      'HEU-233',
      'HEU-233 Oxide',
      'LEU-235',
      'LEU-235 Oxide',
      'HEU-235',
      'HEU-235 Oxide',
    ],
  ],
  ['neptunium', ['LEN-236', 'LEN-236 Oxide', 'HEN-236', 'HEN-236 Oxide']],
  [
    'plutonium',
    [
      'LEP-239',
      'LEP-239 Oxide',
      'HEP-239',
      'HEP-239 Oxide',
      'LEP-241',
      'LEP-241 Oxide',
      'HEP-241',
      'HEP-241 Oxide',
    ],
  ],
  ['mox', ['MOX-239', 'MOX-241']],
  ['americium', ['LEA-242', 'LEA-242 Oxide', 'HEA-242', 'HEA-242 Oxide']],
  [
    'curium',
    [
      'LECm-243',
      'LECm-243 Oxide',
      'HECm-243',
      'HECm-243 Oxide',
      'LECm-245',
      'LECm-245 Oxide',
      'HECm-245',
      'HECm-245 Oxide',
      'LECm-247',
      'LECm-247 Oxide',
      'HECm-247',
      'HECm-247 Oxide',
    ],
  ],
  ['berkelium', ['LEB-248', 'LEB-248 Oxide', 'HEB-248', 'HEB-248 Oxide']],
  [
    'californium',
    ['LECf-249', 'LECf-249 Oxide', 'HECf-249', 'HECf-249 Oxide', 'LECf-251', 'LECf-251 Oxide', 'HECf-251', 'HECf-251 Oxide'],
  ],
];

/** `builder.atLeast(min, Supplier<NCPFModule>)`. */
function atLeastModule(min: number, moduleName: string): JsonObject {
  return betweenRule(moduleReference(moduleName), Math.min(6, Math.max(1, min)), 6);
}

/** `builder.atLeast(min, BlockElement)`. */
function atLeastBlock(min: number, block: ElementState): JsonObject {
  return betweenRule(blockReference(block.def), Math.min(6, Math.max(1, min)), 6);
}

function exactlyBlock(num: number, block: ElementState): JsonObject {
  const bound = Math.min(6, Math.max(1, num));
  return betweenRule(blockReference(block.def), bound, bound);
}

/** `builder.exactly(num, Supplier<NCPFModule>)`. */
function exactlyModule(num: number, moduleName: string): JsonObject {
  const bound = Math.min(6, Math.max(1, num));
  return betweenRule(moduleReference(moduleName), bound, bound);
}

function axisBlock(block: ElementState): JsonObject {
  return axialRule(blockReference(block.def), 1, 3);
}

function vertexModule(moduleName: string): JsonObject {
  return vertexRule(moduleReference(moduleName));
}

function readUnderhaul(input: LegacyInput): LegacyReadResult {
  const issues = new IssueLog();
  const source = new ConfigSource(issues, input.container);
  const root = parseForgeConfig(input.text, input.container);
  const config = source.node('fission', root.getSection('fission'));

  const builder = new ConfigurationBuilder(UNDERHAUL_CONFIG_ID, UNDERHAUL_SETTINGS_MODULE, issues);
  const waterCoolerRequirements = config.bool('fission_water_cooler_requirement');
  const powerMult = config.double('fission_power');
  const fuelUseMult = config.double('fission_fuel_use');
  const heatMult = config.double('fission_heat_generation');

  const settings: JsonObject = {
    min_size: config.int('fission_min_size'),
    max_size: config.int('fission_max_size'),
    neutron_reach: config.int('fission_neutron_reach'),
    moderator_extra_power: f32(config.double('fission_moderator_extra_power')),
    moderator_extra_heat: f32(config.double('fission_moderator_extra_heat')),
    active_cooler_rate: config.int('fission_active_cooler_max_rate'),
  };

  const coolingRates = config.list('fission_cooling_rate');

  const controller = builder.block('nuclearcraft:fission_controller_new_fixed', 'Fission Controller');
  controller.modules[`${UNDERHAUL_MODULE_PREFIX}controller`] = {};

  const casing = builder.block('nuclearcraft:fission_block:0', 'Casing');
  setBlockstate(casing.def, 'type', 'casing');
  casing.modules[`${UNDERHAUL_MODULE_PREFIX}casing`] = {};

  const transparent = builder.block('nuclearcraft:reactor_casing_transparent', 'Transparent Casing');
  transparent.modules[`${UNDERHAUL_MODULE_PREFIX}casing`] = {};

  const cell = builder.block('nuclearcraft:cell_block', 'Reactor Cell');
  cell.modules[`${UNDERHAUL_MODULE_PREFIX}fuel_cell`] = {};
  addLegacyNames(cell, ['Fuel Cell']);

  const coolerModule = (cooling: number, rules: readonly JsonObject[]): JsonObject => ({
    cooling,
    rules: [...rules],
  });

  const water = builder.block('nuclearcraft:cooler:1', 'Water Cooler');
  setBlockstate(water.def, 'type', 'water');
  water.modules[`${UNDERHAUL_MODULE_PREFIX}cooler`] = coolerModule(
    Math.trunc(coolingRates.double(0)),
    [
      orRule([
        atLeastModule(1, `${UNDERHAUL_MODULE_PREFIX}fuel_cell`),
        atLeastModule(1, `${UNDERHAUL_MODULE_PREFIX}moderator`),
      ]),
    ],
  );
  if (!waterCoolerRequirements) {
    (water.modules[`${UNDERHAUL_MODULE_PREFIX}cooler`] as JsonObject).rules = [];
  }

  const redstone = builder.block('nuclearcraft:cooler:2', 'Redstone Cooler');
  setBlockstate(redstone.def, 'type', 'redstone');
  redstone.modules[`${UNDERHAUL_MODULE_PREFIX}cooler`] = coolerModule(
    Math.trunc(coolingRates.double(1)),
    [atLeastModule(1, `${UNDERHAUL_MODULE_PREFIX}fuel_cell`)],
  );

  const quartz = builder.block('nuclearcraft:cooler:3', 'Quartz Cooler');
  setBlockstate(quartz.def, 'type', 'quartz');
  quartz.modules[`${UNDERHAUL_MODULE_PREFIX}cooler`] = coolerModule(
    Math.trunc(coolingRates.double(2)),
    [atLeastModule(1, `${UNDERHAUL_MODULE_PREFIX}moderator`)],
  );

  const gold = builder.block('nuclearcraft:cooler:4', 'Gold Cooler');
  setBlockstate(gold.def, 'type', 'gold');
  gold.modules[`${UNDERHAUL_MODULE_PREFIX}cooler`] = coolerModule(Math.trunc(coolingRates.double(3)), [
    atLeastBlock(1, water),
    atLeastBlock(1, redstone),
  ]);

  const glowstone = builder.block('nuclearcraft:cooler:5', 'Glowstone Cooler');
  setBlockstate(glowstone.def, 'type', 'glowstone');
  glowstone.modules[`${UNDERHAUL_MODULE_PREFIX}cooler`] = coolerModule(
    Math.trunc(coolingRates.double(4)),
    [atLeastModule(2, `${UNDERHAUL_MODULE_PREFIX}moderator`)],
  );

  const lapis = builder.block('nuclearcraft:cooler:6', 'Lapis Cooler');
  setBlockstate(lapis.def, 'type', 'lapis');
  lapis.modules[`${UNDERHAUL_MODULE_PREFIX}cooler`] = coolerModule(Math.trunc(coolingRates.double(5)), [
    atLeastModule(1, `${UNDERHAUL_MODULE_PREFIX}fuel_cell`),
    atLeastModule(1, `${UNDERHAUL_MODULE_PREFIX}casing`),
  ]);

  const diamond = builder.block('nuclearcraft:cooler:7', 'Diamond Cooler');
  setBlockstate(diamond.def, 'type', 'diamond');
  diamond.modules[`${UNDERHAUL_MODULE_PREFIX}cooler`] = coolerModule(
    Math.trunc(coolingRates.double(6)),
    [atLeastBlock(1, water), atLeastBlock(1, quartz)],
  );

  const helium = builder.block('nuclearcraft:cooler:8', 'Liquid Helium Cooler');
  setBlockstate(helium.def, 'type', 'helium');
  addLegacyNames(helium, ['Helium Cooler']);
  helium.modules[`${UNDERHAUL_MODULE_PREFIX}cooler`] = coolerModule(Math.trunc(coolingRates.double(7)), [
    exactlyBlock(1, redstone),
    atLeastModule(1, `${UNDERHAUL_MODULE_PREFIX}casing`),
  ]);

  const enderium = builder.block('nuclearcraft:cooler:9', 'Enderium Cooler');
  setBlockstate(enderium.def, 'type', 'enderium');
  enderium.modules[`${UNDERHAUL_MODULE_PREFIX}cooler`] = coolerModule(
    Math.trunc(coolingRates.double(8)),
    [
      andRule([
        // Java `builder.and(builder.exactly(3, CasingModule::new), builder.vertex(CasingModule::new))`
        exactlyModule(3, `${UNDERHAUL_MODULE_PREFIX}casing`),
        vertexModule(`${UNDERHAUL_MODULE_PREFIX}casing`),
      ]),
    ],
  );

  const cryotheum = builder.block('nuclearcraft:cooler:10', 'Cryotheum Cooler');
  setBlockstate(cryotheum.def, 'type', 'cryotheum');
  cryotheum.modules[`${UNDERHAUL_MODULE_PREFIX}cooler`] = coolerModule(
    Math.trunc(coolingRates.double(9)),
    [atLeastModule(2, `${UNDERHAUL_MODULE_PREFIX}fuel_cell`)],
  );

  const iron = builder.block('nuclearcraft:cooler:11', 'Iron Cooler');
  setBlockstate(iron.def, 'type', 'iron');
  iron.modules[`${UNDERHAUL_MODULE_PREFIX}cooler`] = coolerModule(Math.trunc(coolingRates.double(10)), [
    atLeastBlock(1, gold),
  ]);

  const emerald = builder.block('nuclearcraft:cooler:12', 'Emerald Cooler');
  setBlockstate(emerald.def, 'type', 'emerald');
  emerald.modules[`${UNDERHAUL_MODULE_PREFIX}cooler`] = coolerModule(
    Math.trunc(coolingRates.double(11)),
    [
      atLeastModule(1, `${UNDERHAUL_MODULE_PREFIX}moderator`),
      atLeastModule(1, `${UNDERHAUL_MODULE_PREFIX}fuel_cell`),
    ],
  );

  const copper = builder.block('nuclearcraft:cooler:13', 'Copper Cooler');
  setBlockstate(copper.def, 'type', 'copper');
  copper.modules[`${UNDERHAUL_MODULE_PREFIX}cooler`] = coolerModule(Math.trunc(coolingRates.double(12)), [
    atLeastBlock(1, glowstone),
  ]);

  const tin = builder.block('nuclearcraft:cooler:14', 'Tin Cooler');
  setBlockstate(tin.def, 'type', 'tin');
  tin.modules[`${UNDERHAUL_MODULE_PREFIX}cooler`] = coolerModule(Math.trunc(coolingRates.double(13)), [
    axisBlock(lapis),
  ]);

  const magnesium = builder.block('nuclearcraft:cooler:15', 'Magnesium Cooler');
  setBlockstate(magnesium.def, 'type', 'magnesium');
  magnesium.modules[`${UNDERHAUL_MODULE_PREFIX}cooler`] = coolerModule(
    Math.trunc(coolingRates.double(14)),
    [
      atLeastModule(1, `${UNDERHAUL_MODULE_PREFIX}casing`),
      atLeastModule(1, `${UNDERHAUL_MODULE_PREFIX}moderator`),
    ],
  );

  const moderator = builder.blockWithDefinition(
    oredictDef('blockFissionModerator'),
    'Moderator',
  );
  moderator.modules[`${UNDERHAUL_MODULE_PREFIX}moderator`] = {};
  addLegacyNames(moderator, ['Graphite', 'nuclearcraft:ingot_block:8']);
  addLegacyNames(moderator, ['Beryllium', 'nuclearcraft:ingot_block:9']);

  const activeCoolingRates = config.list('fission_active_cooling_rate');
  const activeCooler = builder.block('nuclearcraft:active_cooler', 'Active Cooler');
  activeCooler.modules[`${UNDERHAUL_MODULE_PREFIX}active_cooler`] = {};

  const activeRecipe = (
    cooling: number,
    liquid: string,
    displayName: string,
    rules: readonly JsonObject[],
    legacy: readonly string[],
  ): void => {
    const element = plainElementJson(legacyFluidDef(liquid), {
      ...moduleBag(displayNameModule(displayName), textureModule()),
      [`${UNDERHAUL_MODULE_PREFIX}cooler`]: coolerModule(cooling, rules),
      ...legacyNamesModule(legacy),
    });
    activeCooler.recipes.push(element);
  };

  activeRecipe(Math.trunc(activeCoolingRates.double(0)), 'water', 'Water', [
    orRule([
      atLeastModule(1, `${UNDERHAUL_MODULE_PREFIX}fuel_cell`),
      atLeastModule(1, `${UNDERHAUL_MODULE_PREFIX}moderator`),
    ]),
  ], ['Water', 'Active Water']);
  activeRecipe(Math.trunc(activeCoolingRates.double(1)), 'redstone', 'Molten Redstone', [
    atLeastModule(1, `${UNDERHAUL_MODULE_PREFIX}fuel_cell`),
  ], ['Destabilized Redstone', 'Active Redstone']);
  activeRecipe(Math.trunc(activeCoolingRates.double(2)), 'quartz', 'Molten Quartz', [
    atLeastModule(1, `${UNDERHAUL_MODULE_PREFIX}moderator`),
  ], ['Molten Quartz', 'Active Quartz']);
  activeRecipe(
    Math.trunc(activeCoolingRates.double(3)),
    'gold',
    'Molten Gold',
    [atLeastBlock(1, water), atLeastBlock(1, redstone)],
    ['Molten Gold', 'Active Gold'],
  );
  activeRecipe(Math.trunc(activeCoolingRates.double(4)), 'glowstone', 'Molten Glowstone', [
    atLeastModule(2, `${UNDERHAUL_MODULE_PREFIX}moderator`),
  ], ['Energized Glowstone', 'Active Glowstone']);
  activeRecipe(Math.trunc(activeCoolingRates.double(5)), 'lapis', 'Molten Lapis', [
    atLeastModule(1, `${UNDERHAUL_MODULE_PREFIX}fuel_cell`),
    atLeastModule(1, `${UNDERHAUL_MODULE_PREFIX}casing`),
  ], ['Molten Lapis', 'Active Lapis']);
  activeRecipe(
    Math.trunc(activeCoolingRates.double(6)),
    'diamond',
    'Molten Diamond',
    [atLeastBlock(1, water), atLeastBlock(1, quartz)],
    ['Molten Diamond', 'Active Diamond'],
  );
  activeRecipe(Math.trunc(activeCoolingRates.double(7)), 'liquidhelium', 'Liquid Helium', [
    exactlyBlock(1, redstone),
    atLeastModule(1, `${UNDERHAUL_MODULE_PREFIX}casing`),
  ], ['Liquid Helium', 'Active Helium']);
  activeRecipe(Math.trunc(activeCoolingRates.double(8)), 'ender', 'Molten Ender', [
    // Java `builder.and(builder.exactly(3, CasingModule::new), builder.vertex(CasingModule::new))`
    andRule([exactlyModule(3, `${UNDERHAUL_MODULE_PREFIX}casing`), vertexModule(`${UNDERHAUL_MODULE_PREFIX}casing`)]),
  ], ['Resonant Ender', 'Active Enderium']);
  activeRecipe(Math.trunc(activeCoolingRates.double(9)), 'cryotheum', 'Molten Cryotheum', [
    atLeastModule(2, `${UNDERHAUL_MODULE_PREFIX}fuel_cell`),
  ], ['Gelid Cryotheum', 'Active Cryotheum']);
  activeRecipe(Math.trunc(activeCoolingRates.double(10)), 'iron', 'Molten Iron', [
    atLeastBlock(1, gold),
  ], ['Molten Iron', 'Active Iron']);
  activeRecipe(Math.trunc(activeCoolingRates.double(11)), 'emerald', 'Molten Emerald', [
    atLeastModule(1, `${UNDERHAUL_MODULE_PREFIX}moderator`),
    atLeastModule(1, `${UNDERHAUL_MODULE_PREFIX}fuel_cell`),
  ], ['Molten Emerald', 'Active Emerald']);
  activeRecipe(Math.trunc(activeCoolingRates.double(12)), 'copper', 'Molten Copper', [
    atLeastBlock(1, glowstone),
  ], ['Molten Copper', 'Active Copper']);
  activeRecipe(Math.trunc(activeCoolingRates.double(13)), 'tin', 'Molten Tin', [axisBlock(lapis)], [
    'Molten Tin',
    'Active Tin',
  ]);
  activeRecipe(Math.trunc(activeCoolingRates.double(14)), 'magnesium', 'Molten Magnesium', [
    atLeastModule(1, `${UNDERHAUL_MODULE_PREFIX}casing`),
    atLeastModule(1, `${UNDERHAUL_MODULE_PREFIX}moderator`),
  ], ['Molten Magnesium', 'Active Magnesium']);

  // addFuels (lines 94-101) — the fuel texture expression is not ported (deviation 1).
  const fuels = builder.list('fuels');
  for (const [baseName, fuelNames] of UNDERHAUL_FUEL_FAMILIES) {
    const time = config.list(`fission_${baseName}_fuel_time`);
    const power = config.list(`fission_${baseName}_power`);
    const heat = config.list(`fission_${baseName}_heat_generation`);
    for (let i = 0; i < fuelNames.length; i++) {
      const displayName = fuelNames[i] as string;
      const element = plainElementJson(legacyItemDef(`nuclearcraft:fuel_${baseName}:${i}`), {
        ...moduleBag(displayNameModule(displayName), textureModule()),
        [`${UNDERHAUL_MODULE_PREFIX}fuel_stats`]: {
          power: f32(power.double(i) * powerMult),
          heat: f32(heat.double(i) * heatMult),
          time: Math.trunc(time.double(i) / fuelUseMult),
        },
        ...legacyNamesModule([displayName]),
      });
      fuels.push(element);
    }
  }

  // globalElement(...).tag(...).tag(...) (lines 89-90)
  for (const [metadata, displayName] of [
    [8, 'Graphite Block'],
    [9, 'Beryllium Block'],
  ] as const) {
    const def = legacyBlockDef(`nuclearcraft:ingot_block:${metadata}`);
    setBlockstate(def, 'type', metadata === 8 ? 'graphite' : 'beryllium');
    const { element } = builder.globalElement(def, displayName);
    ConfigurationBuilder.tag(element, 'blockFissionModerator');
    ConfigurationBuilder.tag(element, metadata === 8 ? 'blockGraphite' : 'blockBeryllium');
  }

  builder.finalize();

  const configuration = configurationJson(builder, UNDERHAUL_SETTINGS_MODULE, settings, [
    ['fuels', fuels],
  ]);
  return {
    raw: projectJson([configuration], [UNDERHAUL_CONFIG_ID]),
    issues: issues.list(),
  };
}

// ---------------------------------------------------------------------------
// OverhaulNCConfigReader (OverhaulNCConfigReader.java:22-433)
// ---------------------------------------------------------------------------

/** `OverhaulNCConfigReader.read` — SFR, MSR, turbine and distiller. */
function readOverhaul(input: LegacyInput): LegacyReadResult {
  const issues = new IssueLog();
  const source = new ConfigSource(issues, input.container);
  const root = parseForgeConfig(input.text, input.container);
  const fissionNode = source.node('fission', root.getSection('fission'));
  const turbineNode = source.node('turbine', root.getSection('turbine'));
  const machineNode = source.node('machine', root.getSection('machine'));

  const configurations: JsonObject[] = [];
  const ids: string[] = [];

  const sfr = readOverhaulSfr(fissionNode, source, issues);
  configurations.push(sfr);
  ids.push(OVERHAUL_SFR_ID);
  const msr = readOverhaulMsr(fissionNode, source, issues);
  configurations.push(msr);
  ids.push(OVERHAUL_MSR_ID);
  const turbine = readOverhaulTurbine(turbineNode, source, issues);
  configurations.push(turbine);
  ids.push(OVERHAUL_TURBINE_ID);
  const distiller = readOverhaulDistiller(machineNode, source, issues);
  configurations.push(distiller);
  ids.push(OVERHAUL_DISTILLER_ID);

  return { raw: projectJson(configurations, ids), issues: issues.list() };
}

const OVERHAUL_SFR_ID = 'nuclearcraft:overhaul_sfr';
const OVERHAUL_MSR_ID = 'nuclearcraft:overhaul_msr';
const OVERHAUL_TURBINE_ID = 'nuclearcraft:overhaul_turbine';
const OVERHAUL_DISTILLER_ID = 'nuclearcraft:overhaul_distiller';

const SFR = 'nuclearcraft:overhaul_sfr:';
const MSR = 'nuclearcraft:overhaul_msr:';
const TURBINE = 'nuclearcraft:overhaul_turbine:';
const DISTILLER = 'nuclearcraft:overhaul_distiller:';

/** Heat sinks, in `OverhaulNCConfigReader:78-109` order: [id, displayName, blockstate]. */
const SFR_HEAT_SINKS: readonly (readonly [string, string, string])[] = [
  ['nuclearcraft:solid_fission_sink:0', 'Water Heat Sink', 'water'],
  ['nuclearcraft:solid_fission_sink:1', 'Iron Heat Sink', 'iron'],
  ['nuclearcraft:solid_fission_sink:2', 'Redstone Heat Sink', 'redstone'],
  ['nuclearcraft:solid_fission_sink:3', 'Quartz Heat Sink', 'quartz'],
  ['nuclearcraft:solid_fission_sink:4', 'Obsidian Heat Sink', 'obsidian'],
  ['nuclearcraft:solid_fission_sink:5', 'Nether Brick Heat Sink', 'nether_brick'],
  ['nuclearcraft:solid_fission_sink:6', 'Glowstone Heat Sink', 'glowstone'],
  ['nuclearcraft:solid_fission_sink:7', 'Lapis Heat Sink', 'lapis'],
  ['nuclearcraft:solid_fission_sink:8', 'Gold Heat Sink', 'gold'],
  ['nuclearcraft:solid_fission_sink:9', 'Prismarine Heat Sink', 'prismarine'],
  ['nuclearcraft:solid_fission_sink:10', 'Slime Heat Sink', 'slime'],
  ['nuclearcraft:solid_fission_sink:11', 'End Stone Heat Sink', 'end_stone'],
  ['nuclearcraft:solid_fission_sink:12', 'Purpur Heat Sink', 'purpur'],
  ['nuclearcraft:solid_fission_sink:13', 'Diamond Heat Sink', 'diamond'],
  ['nuclearcraft:solid_fission_sink:14', 'Emerald Heat Sink', 'emerald'],
  ['nuclearcraft:solid_fission_sink:15', 'Copper Heat Sink', 'copper'],
  ['nuclearcraft:solid_fission_sink2:0', 'Tin Heat Sink', 'tin'],
  ['nuclearcraft:solid_fission_sink2:1', 'Lead Heat Sink', 'lead'],
  ['nuclearcraft:solid_fission_sink2:2', 'Boron Heat Sink', 'boron'],
  ['nuclearcraft:solid_fission_sink2:3', 'Lithium Heat Sink', 'lithium'],
  ['nuclearcraft:solid_fission_sink2:4', 'Magnesium Heat Sink', 'magnesium'],
  ['nuclearcraft:solid_fission_sink2:5', 'Manganese Heat Sink', 'manganese'],
  ['nuclearcraft:solid_fission_sink2:6', 'Aluminum Heat Sink', 'aluminum'],
  ['nuclearcraft:solid_fission_sink2:7', 'Silver Heat Sink', 'silver'],
  ['nuclearcraft:solid_fission_sink2:8', 'Fluorite Heat Sink', 'fluorite'],
  ['nuclearcraft:solid_fission_sink2:9', 'Villiaumite Heat Sink', 'villiaumite'],
  ['nuclearcraft:solid_fission_sink2:10', 'Carobbiite Heat Sink', 'carobbiite'],
  ['nuclearcraft:solid_fission_sink2:11', 'Arsenic Heat Sink', 'arsenic'],
  ['nuclearcraft:solid_fission_sink2:12', 'Liquid Nitrogen Heat Sink', 'liquid_nitrogen'],
  ['nuclearcraft:solid_fission_sink2:13', 'Liquid Helium Heat Sink', 'liquid_helium'],
  ['nuclearcraft:solid_fission_sink2:14', 'Enderium Heat Sink', 'enderium'],
  ['nuclearcraft:solid_fission_sink2:15', 'Cryotheum Heat Sink', 'cryotheum'],
];

/** Neutron sources, in `OverhaulNCConfigReader:73-75` order. */
const SFR_SOURCES: readonly (readonly [string, string, string])[] = [
  ['nuclearcraft:fission_source:0', 'Ra-Be Neutron Source', 'radium_beryllium'],
  ['nuclearcraft:fission_source:1', 'Po-Be Neutron Source', 'polonium_beryllium'],
  ['nuclearcraft:fission_source:2', 'Cf-252 Neutron Source', 'californium'],
];

/**
 * SFR fuels (`addSFRFuels`, lines 136-143): the `null` entries are skipped, and
 * the element index is `i - i/5` (Java integer division), which is why the
 * indices have gaps.
 */
const SFR_FUEL_FAMILIES: readonly (readonly [string, readonly (string | null)[]])[] = [
  ['thorium', [null, 'TBU Oxide', 'TBU Nitride', 'TBU-Zirconium Alloy', null]],
  [
    'uranium',
    [
      null, 'LEU-233 Oxide', 'LEU-233 Nitride', 'LEU-233-Zirconium Alloy', null,
      null, 'HEU-233 Oxide', 'HEU-233 Nitride', 'HEU-233-Zirconium Alloy', null,
      null, 'LEU-235 Oxide', 'LEU-235 Nitride', 'LEU-235-Zirconium Alloy', null,
      null, 'HEU-235 Oxide', 'HEU-235 Nitride', 'HEU-235-Zirconium Alloy', null,
    ],
  ],
  [
    'neptunium',
    [null, 'LEN-236 Oxide', 'LEN-236 Nitride', 'LEN-236-Zirconium Alloy', null,
     null, 'HEN-236 Oxide', 'HEN-236 Nitride', 'HEN-236-Zirconium Alloy', null],
  ],
  [
    'plutonium',
    [
      null, 'LEP-239 Oxide', 'LEP-239 Nitride', 'LEP-239-Zirconium Alloy', null,
      null, 'HEP-239 Oxide', 'HEP-239 Nitride', 'HEP-239-Zirconium Alloy', null,
      null, 'LEP-241 Oxide', 'LEP-241 Nitride', 'LEP-241-Zirconium Alloy', null,
      null, 'HEP-241 Oxide', 'HEP-241 Nitride', 'HEP-241-Zirconium Alloy', null,
    ],
  ],
  [
    'mixed',
    [null, 'MOX-239', 'MNI-239', 'MZA-239', null, null, 'MOX-241', 'MNI-241', 'MZA-241', null],
  ],
  [
    'americium',
    [null, 'LEA-242 Oxide', 'LEA-242 Nitride', 'LEA-242-Zirconium Alloy', null,
     null, 'HEA-242 Oxide', 'HEA-242 Nitride', 'HEA-242-Zirconium Alloy', null],
  ],
  [
    'curium',
    [
      null, 'LECm-243 Oxide', 'LECm-243 Nitride', 'LECm-243-Zirconium Alloy', null,
      null, 'HECm-243 Oxide', 'HECm-243 Nitride', 'HECm-243-Zirconium Alloy', null,
      null, 'LECm-245 Oxide', 'LECm-245 Nitride', 'LECm-245-Zirconium Alloy', null,
      null, 'HECm-245 Oxide', 'HECm-245 Nitride', 'HECm-245-Zirconium Alloy', null,
      null, 'LECm-247 Oxide', 'LECm-247 Nitride', 'LECm-247-Zirconium Alloy', null,
      null, 'HECm-247 Oxide', 'HECm-247 Nitride', 'HECm-247-Zirconium Alloy', null,
    ],
  ],
  [
    'berkelium',
    [null, 'LEB-248 Oxide', 'LEB-248 Nitride', 'LEB-248-Zirconium Alloy', null,
     null, 'HEB-248 Oxide', 'HEB-248 Nitride', 'HEB-248-Zirconium Alloy', null],
  ],
  [
    'californium',
    [
      null, 'LECf-249 Oxide', 'LECf-249 Nitride', 'LECf-249-Zirconium Alloy', null,
      null, 'HECf-249 Oxide', 'HECf-249 Nitride', 'HECf-249-Zirconium Alloy', null,
      null, 'LECf-251 Oxide', 'LECf-251 Nitride', 'LECf-251-Zirconium Alloy', null,
      null, 'HECf-251 Oxide', 'HECf-251 Nitride', 'HECf-251-Zirconium Alloy', null,
    ],
  ],
];

/** `addMSRFuels` tables (lines 291-299): five slots per fuel, only the last used. */
const MSR_FUEL_FAMILIES: readonly (readonly [string, readonly (string | null)[]])[] = [
  ['thorium', [null, null, null, null, 'TBU Fluoride']],
  [
    'uranium',
    [
      null, null, null, null, 'LEU-233 Fluoride',
      null, null, null, null, 'HEU-233 Fluoride',
      null, null, null, null, 'LEU-235 Fluoride',
      null, null, null, null, 'HEU-235 Fluoride',
    ],
  ],
  ['neptunium', [null, null, null, null, 'LEN-236 Fluoride', null, null, null, null, 'HEN-236 Fluoride']],
  [
    'plutonium',
    [
      null, null, null, null, 'LEP-239 Fluoride',
      null, null, null, null, 'HEP-239 Fluoride',
      null, null, null, null, 'LEP-241 Fluoride',
      null, null, null, null, 'HEP-241 Fluoride',
    ],
  ],
  ['mixed', [null, null, null, null, 'MF4-239', null, null, null, null, 'MF4-241']],
  ['americium', [null, null, null, null, 'LEA-242 Fluoride', null, null, null, null, 'HEA-242 Fluoride']],
  [
    'curium',
    [
      null, null, null, null, 'LECm-243 Fluoride',
      null, null, null, null, 'HECm-243 Fluoride',
      null, null, null, null, 'LECm-245 Fluoride',
      null, null, null, null, 'HECm-245 Fluoride',
      null, null, null, null, 'LECm-247 Fluoride',
      null, null, null, null, 'HECm-247 Fluoride',
    ],
  ],
  ['berkelium', [null, null, null, null, 'LEB-248 Fluoride', null, null, null, null, 'HEB-248 Fluoride']],
  [
    'californium',
    [
      null, null, null, null, 'LECf-249 Fluoride',
      null, null, null, null, 'HECf-249 Fluoride',
      null, null, null, null, 'LECf-251 Fluoride',
      null, null, null, null, 'HECf-251 Fluoride',
    ],
  ],
];

/** MSR coolant heaters (lines 173-268): [type, displayName, mixture label]. */
const MSR_HEATERS: readonly (readonly [string, string, string])[] = [
  ['standard', 'Standard Coolant Heater', ''],
  ['iron', 'Iron Coolant Heater', 'Iron'],
  ['redstone', 'Redstone Coolant Heater', 'Redstone'],
  ['quartz', 'Quartz Coolant Heater', 'Quartz'],
  ['obsidian', 'Obsidian Coolant Heater', 'Obsidian'],
  ['nether_brick', 'Nether Brick Coolant Heater', 'Nether Brick'],
  ['glowstone', 'Glowstone Coolant Heater', 'Glowstone'],
  ['lapis', 'Lapis Coolant Heater', 'Lapis'],
  ['gold', 'Gold Coolant Heater', 'Gold'],
  ['prismarine', 'Prismarine Coolant Heater', 'Prismarine'],
  ['slime', 'Slime Coolant Heater', 'Slime'],
  ['end_stone', 'End Stone Coolant Heater', 'End Stone'],
  ['purpur', 'Purpur Coolant Heater', 'Purpur'],
  ['diamond', 'Diamond Coolant Heater', 'Diamond'],
  ['emerald', 'Emerald Coolant Heater', 'Emerald'],
  ['copper', 'Copper Coolant Heater', 'Copper'],
  ['tin', 'Tin Coolant Heater', 'Tin'],
  ['lead', 'Lead Coolant Heater', 'Lead'],
  ['boron', 'Boron Coolant Heater', 'Boron'],
  ['lithium', 'Lithium Coolant Heater', 'Lithium'],
  ['magnesium', 'Magnesium Coolant Heater', 'Magnesium'],
  ['manganese', 'Manganese Coolant Heater', 'Manganese'],
  ['aluminum', 'Aluminum Coolant Heater', 'Aluminum'],
  ['silver', 'Silver Coolant Heater', 'Silver'],
  ['fluorite', 'Fluorite Coolant Heater', 'Fluorite'],
  ['villiaumite', 'Villiaumite Coolant Heater', 'Villiaumite'],
  ['carobbiite', 'Carobbiite Coolant Heater', 'Carobbiite'],
  ['arsenic', 'Arsenic Coolant Heater', 'Arsenic'],
  ['liquid_nitrogen', 'Liquid Nitrogen Coolant Heater', 'Nitrogen'],
  ['liquid_helium', 'Liquid Helium Coolant Heater', 'Helium'],
  ['enderium', 'Enderium Coolant Heater', 'Enderium'],
  ['cryotheum', 'Cryotheum Coolant Heater', 'Cryotheum'],
];

/** Turbine rotor blades (lines 332-334). */
const TURBINE_BLADES: readonly (readonly [string, string])[] = [
  ['nuclearcraft:turbine_rotor_blade_steel', 'Steel Rotor Blade'],
  ['nuclearcraft:turbine_rotor_blade_extreme', 'Extreme Alloy Rotor Blade'],
  ['nuclearcraft:turbine_rotor_blade_sic_sic_cmc', 'SiC-SiC CMC Rotor Blade'],
];

/** Turbine dynamo coils (lines 338-343). */
const TURBINE_COILS: readonly (readonly [string, string, string])[] = [
  ['nuclearcraft:turbine_dynamo_coil:0', 'Magnesium Dynamo Coil', 'magnesium'],
  ['nuclearcraft:turbine_dynamo_coil:1', 'Beryllium Dynamo Coil', 'beryllium'],
  ['nuclearcraft:turbine_dynamo_coil:2', 'Aluminum Dynamo Coil', 'aluminum'],
  ['nuclearcraft:turbine_dynamo_coil:3', 'Gold Dynamo Coil', 'gold'],
  ['nuclearcraft:turbine_dynamo_coil:4', 'Copper Dynamo Coil', 'copper'],
  ['nuclearcraft:turbine_dynamo_coil:5', 'Silver Dynamo Coil', 'silver'],
];

/** Distiller sieve assemblies (lines 392-394). */
const DISTILLER_SIEVES: readonly (readonly [string, string, string, number])[] = [
  ['nuclearcraft:machine_sieve_assembly:0', 'Steel Sieve Assembly', 'steel', 0.8],
  [
    'nuclearcraft:machine_sieve_assembly:1',
    'Polytetrafluoroethene Sieve Assembly',
    'polytetrafluoroethene',
    0.9,
  ],
  ['nuclearcraft:machine_sieve_assembly:2', 'Hastelloy Sieve Assembly', 'hastelloy', 1],
];

/**
 * `OverhaulSFRConfigurationBuilder` + `OverhaulNCConfigReader:57-149`.
 *
 * The three `irradiatorRecipe` inputs are `NCPFListElement`s — the dead path R2.9
 * fixes (deviation 3).
 */
function readOverhaulSfr(fission: CfgNode, source: ConfigSource, issues: IssueLog): JsonObject {
  const fuelTimeMult = fission.double('fission_fuel_time_multiplier');
  const fuelHeatMult = fission.double('fission_fuel_heat_multiplier');
  const fuelEfficiencyMult = fission.double('fission_fuel_efficiency_multiplier');
  const sparsity = fission.list('fission_sparsity_penalty_params');
  const sourceEfficiency = fission.list('fission_source_efficiency');
  const modEff = fission.list('fission_moderator_efficiency');
  const fluxFac = fission.list('fission_moderator_flux_factor');
  const refEff = fission.list('fission_reflector_efficiency');
  const refRef = fission.list('fission_reflector_reflectivity');
  const shieldHeat = fission.list('fission_shield_heat_per_flux');
  const shieldEff = fission.list('fission_shield_efficiency');
  const irrHeat = fission.list('fission_irradiator_heat_per_flux');
  const irrEff = fission.list('fission_irradiator_efficiency');

  const builder = new ConfigurationBuilder(OVERHAUL_SFR_ID, `${OVERHAUL_SFR_ID}_configuration_settings`, issues, 'sfr');
  const block = (name: string, displayName: string): ElementState => builder.block(name, displayName);

  const controller = block('nuclearcraft:solid_fission_controller', 'Solid Fission Controller');
  controller.modules[`${SFR}controller`] = { c: 'casing' };
  controller.modules[`${SFR}casing`] = { edge: false };

  for (const [name, displayName] of [
    ['nuclearcraft:fission_monitor', 'Fission Monitor'],
    ['nuclearcraft:fission_source_manager', 'Fission Source Manager'],
    ['nuclearcraft:fission_shield_manager', 'Fission Shield Manager'],
  ] as const) {
    const state = block(name, displayName);
    state.modules[`${SFR}casing`] = { edge: false };
  }

  coolantVent(builder, 'nuclearcraft:fission_vent', 'Vent (Input)', 'Vent (Output)');

  const computerPort = block('nuclearcraft:fission_computer_port', 'Fission Computer Port');
  computerPort.modules[`${SFR}casing`] = { edge: false };
  const casing = block('nuclearcraft:fission_casing', 'Reactor Casing');
  casing.modules[`${SFR}casing`] = { edge: true };
  const glass = block('nuclearcraft:fission_glass', 'Reactor Glass');
  glass.modules[`${SFR}casing`] = { edge: false };

  const settings: JsonObject = {
    cooling_efficiency_leniency: fission.int('fission_cooling_efficiency_leniency'),
    min_size: fission.int('fission_min_size'),
    max_size: fission.int('fission_max_size'),
    neutron_reach: fission.int('fission_neutron_reach'),
    sparsity_penalty_multiplier: f32(sparsity.double(0)),
    sparsity_penalty_threshold: f32(sparsity.double(1)),
  };

  SFR_SOURCES.forEach(([name, displayName, state], index) => {
    const element = block(name, displayName);
    setBlockstate(element.def, 'type', state);
    element.modules[`${SFR}casing`] = { edge: false };
    element.modules[`${SFR}neutron_source`] = { efficiency: f32(sourceEfficiency.double(index)) };
  });

  const coolingRates = fission.list('fission_sink_cooling_rate');
  const sinkRules = fission.list('fission_sink_rule');
  SFR_HEAT_SINKS.forEach(([name, displayName, state], index) => {
    const element = block(name, displayName);
    setBlockstate(element.def, 'type', state);
    element.modules[`${SFR}heat_sink`] = { cooling: coolingRates.int(index), rules: [] };
    element.pendingRules.push(sinkRules.str(index));
  });

  const cell = block('nuclearcraft:solid_fission_cell', 'Fuel Cell');
  cell.modules[`${SFR}fuel_cell`] = {};
  port(
    builder,
    cell,
    'nuclearcraft:fission_cell_port',
    'Fuel Cell Port (Input)',
    'Fuel Cell Port (Output)',
    null,
  );

  const irradiator = block('nuclearcraft:fission_irradiator', 'Neutron Irradiator');
  irradiator.modules[`${SFR}irradiator`] = {};
  port(
    builder,
    irradiator,
    'nuclearcraft:fission_irradiator_port',
    'Neutron Irradiator Port (Input)',
    'Neutron Irradiator Port (Output)',
    null,
  );

  const conductor = block('nuclearcraft:fission_conductor', 'Conductor');
  conductor.modules[`${SFR}conductor`] = {};

  const graphite = builder.blockWithDefinition(oredictDef('blockGraphite'), 'Graphite Moderator');
  graphite.modules[`${SFR}moderator`] = { flux: fluxFac.int(0), efficiency: f32(modEff.double(0)) };
  addLegacyNames(graphite, ['nuclearcraft:ingot_block:8']);
  const beryllium = builder.blockWithDefinition(oredictDef('blockBeryllium'), 'Beryllium Moderator');
  beryllium.modules[`${SFR}moderator`] = { flux: fluxFac.int(1), efficiency: f32(modEff.double(1)) };
  addLegacyNames(beryllium, ['nuclearcraft:ingot_block:9']);
  const heavyWater = block('nuclearcraft:heavy_water_moderator', 'Heavy Water Moderator');
  heavyWater.modules[`${SFR}moderator`] = { flux: fluxFac.int(2), efficiency: f32(modEff.double(2)) };

  const reflector = (name: string, displayName: string, state: string, index: number): void => {
    const element = block(name, displayName);
    setBlockstate(element.def, 'type', state);
    element.modules[`${SFR}reflector`] = {
      efficiency: f32(refEff.double(index)),
      reflectivity: f32(refRef.double(index)),
    };
  };
  reflector('nuclearcraft:fission_reflector:0', 'Beryllium-Carbon Reflector', 'beryllium_carbon', 0);
  reflector('nuclearcraft:fission_reflector:1', 'Lead-Steel Reflector', 'lead_steel', 1);

  shield(
    builder,
    'nuclearcraft:fission_shield:0',
    'boron_silver',
    'Boron-Silver Neutron Shield',
    'overhaul/boron-silver',
    'overhaul/boron-silver_closed',
    shieldHeat.double(0),
    shieldEff.double(0),
    SFR,
  );

  const dustTbp = builder.globalElement(
    oredictDef('dustTBP'),
    'Protactinium-Enriched Thorium Dust',
  ).definition;
  ConfigurationBuilder.tag(
    builder.globalElement(legacyItemDef('nuclearcraft:fission_dust:3'), 'Protactinium-Enriched Thorium Dust')
      .element,
    'dustTBP',
  );
  const dustProtactinium233 = builder.globalElement(
    oredictDef('dustProtactinium233'),
    'Protactinium-233 Dust',
  ).definition;
  ConfigurationBuilder.tag(
    builder.globalElement(legacyItemDef('nuclearcraft:fission_dust:4'), 'Protactinium-233 Dust').element,
    'dustProtactinium233',
  );
  const dustPolonium = builder.globalElement(oredictDef('dustPolonium'), 'Polonium Dust').definition;
  ConfigurationBuilder.tag(
    builder.globalElement(legacyItemDef('nuclearcraft:fission_dust:2'), 'Polonium Dust').element,
    'dustPolonium',
  );

  irradiatorRecipe(
    builder,
    irradiator,
    [oredictDef('ingotThorium'), oredictDef('dustThorium')],
    'Thorium',
    dustTbp,
    f32(irrEff.double(0)),
    f32(irrHeat.double(0)),
    ['nuclearcraft:dust:3', 'Thorium Dust'],
  );
  irradiatorRecipe(
    builder,
    irradiator,
    [oredictDef('ingotTBP'), oredictDef('dustTBP')],
    'Protactinium-Enriched Thorium',
    dustProtactinium233,
    f32(irrEff.double(1)),
    f32(irrHeat.double(1)),
    ['nuclearcraft:fission_dust:3', 'Protactinium-Enriched Thorium Dust'],
  );
  irradiatorRecipe(
    builder,
    irradiator,
    [oredictDef('ingotBismuth'), oredictDef('dustBismuth')],
    'Bismuth',
    dustPolonium,
    f32(irrEff.double(2)),
    f32(irrHeat.double(2)),
    ['nuclearcraft:fission_dust:0', 'Bismuth Dust'],
  );

  const hps = builder.globalElement(legacyFluidDef('high_pressure_steam'), 'High Pressure Steam').definition;
  const coolantRecipes = builder.list('coolant_recipes');
  coolantRecipes.push(
    coolantRecipe(
      builder,
      [legacyFluidDef('water'), legacyFluidDef('condensate_water')],
      'Water',
      hps,
      64,
      1,
      4,
      ['water'],
    ),
  );
  coolantRecipes.push(
    coolantRecipe(builder, legacyFluidDef('preheated_water'), 'Preheated Water', hps, 32, 1, 4, []),
  );

  const fuels = builder.list('fuels');
  for (const [baseName, fuelNames] of SFR_FUEL_FAMILIES) {
    const time = fission.list(`fission_${baseName}_fuel_time`);
    const heat = fission.list(`fission_${baseName}_heat_generation`);
    const efficiency = fission.list(`fission_${baseName}_efficiency`);
    const criticality = fission.list(`fission_${baseName}_criticality`);
    const selfPriming = fission.list(`fission_${baseName}_self_priming`);
    for (let i = 0; i < fuelNames.length; i++) {
      const name = fuelNames[i];
      if (name === null || name === undefined) continue;
      const fuelIndex = i - Math.trunc(i / 5);
      const oredictBase = name.replace(/-/g, '').replace(/ /g, '').replace(/ZirconiumAlloy/g, 'ZA');
      let base = oredictBase;
      if (base.includes('MOX')) base = `${base.replace(/MOX/g, 'MIX')}Oxide`;
      if (base.includes('MZA')) base = `${base.replace(/MZA/g, 'MIX')}ZA`;
      if (base.includes('MNI')) base = `${base.replace(/MNI/g, 'MIX')}Nitride`;
      const inputOredict = `ingot${base}`;
      const outputOredict = `ingotDepleted${base}`;
      const inputName = `nuclearcraft:fuel_${baseName}:${fuelIndex}`;
      const outputName = `nuclearcraft:depleted_fuel_${baseName}:${fuelIndex}`;

      const inputGlobal = builder.globalElement(oredictDef(inputOredict), name).definition;
      const outputGlobal = builder.globalElement(oredictDef(outputOredict), `Depleted ${name}`).definition;
      ConfigurationBuilder.tag(
        builder.globalElement(legacyItemDef(inputName), name).element,
        inputOredict,
      );
      ConfigurationBuilder.tag(
        builder.globalElement(legacyItemDef(outputName), `Depleted ${name}`).element,
        outputOredict,
      );

      const element = plainElementJson(
        legacyRecipeDef([elementStack(inputGlobal, 1)], [elementStack(outputGlobal, 1)]),
        {
          ...moduleBag(displayNameModule(name), textureModule()),
          [`${SFR}fuel_stats`]: {
            efficiency: f32(efficiency.getAsFloat(i) * fuelEfficiencyMult),
            heat: Math.trunc(heat.getAsInt(i) * fuelHeatMult),
            time: Math.trunc(time.getAsInt(i) * fuelTimeMult),
            criticality: criticality.getAsInt(i),
            self_priming: selfPriming.bool(i),
          },
          ...legacyNamesModule([name, inputName]),
        },
      );
      fuels.push(element);
    }
  }

  for (const [metadata, displayName, state, tag] of [
    [8, 'Graphite Block', 'graphite', 'blockGraphite'],
    [9, 'Beryllium Block', 'beryllium', 'blockBeryllium'],
  ] as const) {
    const def = legacyBlockDef(`nuclearcraft:ingot_block:${metadata}`);
    setBlockstate(def, 'type', state);
    ConfigurationBuilder.tag(builder.globalElement(def, displayName).element, tag);
  }
  ConfigurationBuilder.tag(
    builder.globalElement(legacyItemDef('nuclearcraft:ingot:3'), 'Thorium Ingot').element,
    'ingotThorium',
  );
  ConfigurationBuilder.tag(
    builder.globalElement(legacyItemDef('nuclearcraft:dust:3'), 'Thorium Dust').element,
    'dustThorium',
  );
  ConfigurationBuilder.tag(
    builder.globalElement(legacyItemDef('nuclearcraft:fission_dust:0'), 'Bismuth Dust').element,
    'dustBismuth',
  );

  builder.finalize();
  void source;
  return configurationJson(builder, `${OVERHAUL_SFR_ID}_configuration_settings`, settings, [
    ['coolant_recipes', coolantRecipes],
    ['fuels', fuels],
  ]);
}

/** `OverhaulMSRConfigurationBuilder` + `OverhaulNCConfigReader:152-305`. */
function readOverhaulMsr(fission: CfgNode, source: ConfigSource, issues: IssueLog): JsonObject {
  const fuelTimeMult = fission.double('fission_fuel_time_multiplier');
  const fuelHeatMult = fission.double('fission_fuel_heat_multiplier');
  const fuelEfficiencyMult = fission.double('fission_fuel_efficiency_multiplier');
  const sparsity = fission.list('fission_sparsity_penalty_params');
  const sourceEfficiency = fission.list('fission_source_efficiency');
  const modEff = fission.list('fission_moderator_efficiency');
  const fluxFac = fission.list('fission_moderator_flux_factor');
  const refEff = fission.list('fission_reflector_efficiency');
  const refRef = fission.list('fission_reflector_reflectivity');
  const shieldHeat = fission.list('fission_shield_heat_per_flux');
  const shieldEff = fission.list('fission_shield_efficiency');
  const irrHeat = fission.list('fission_irradiator_heat_per_flux');
  const irrEff = fission.list('fission_irradiator_efficiency');

  const builder = new ConfigurationBuilder(OVERHAUL_MSR_ID, `${OVERHAUL_MSR_ID}_configuration_settings`, issues, 'msr');
  const block = (name: string, displayName: string): ElementState => builder.block(name, displayName);

  const controller = block('nuclearcraft:salt_fission_controller', 'Molten Salt Fission Controller');
  controller.modules[`${MSR}controller`] = {};
  controller.modules[`${MSR}casing`] = { edge: false };

  for (const [name, displayName] of [
    ['nuclearcraft:fission_monitor', 'Fission Monitor'],
    ['nuclearcraft:fission_source_manager', 'Fission Source Manager'],
    ['nuclearcraft:fission_shield_manager', 'Fission Shield Manager'],
    ['nuclearcraft:fission_computer_port', 'Fission Computer Port'],
  ] as const) {
    block(name, displayName).modules[`${MSR}casing`] = { edge: false };
  }
  block('nuclearcraft:fission_casing', 'Reactor Casing').modules[`${MSR}casing`] = { edge: true };
  block('nuclearcraft:fission_glass', 'Reactor Glass').modules[`${MSR}casing`] = { edge: false };

  const settings: JsonObject = {
    cooling_efficiency_leniency: fission.int('fission_cooling_efficiency_leniency'),
    min_size: fission.int('fission_min_size'),
    max_size: fission.int('fission_max_size'),
    neutron_reach: fission.int('fission_neutron_reach'),
    sparsity_penalty_multiplier: f32(sparsity.double(0)),
    sparsity_penalty_threshold: f32(sparsity.double(1)),
  };

  SFR_SOURCES.forEach(([name, displayName, state], index) => {
    const element = block(name, displayName);
    setBlockstate(element.def, 'type', state);
    element.modules[`${MSR}casing`] = { edge: false };
    element.modules[`${MSR}neutron_source`] = { efficiency: f32(sourceEfficiency.double(index)) };
  });

  const coolingRates = fission.list('fission_heater_cooling_rate');
  const heaterRules = fission.list('fission_heater_rule');
  MSR_HEATERS.forEach(([type, displayName, mixture], index) => {
    const second = index >= 16;
    const local = second ? index - 16 : index;
    const name = second
      ? `nuclearcraft:salt_fission_heater2:${local}`
      : `nuclearcraft:salt_fission_heater:${local}`;
    const heater = block(name, displayName);
    setBlockstate(heater.def, 'type', type);
    heater.modules[`${MSR}heater`] = { rules: [] };
    heater.pendingRules.push(heaterRules.str(index));

    const portName = second
      ? `nuclearcraft:fission_heater_port2:${local}`
      : `nuclearcraft:fission_heater_port:${local}`;
    port(builder, heater, portName, `${displayName} Port (Input)`, `${displayName} Port (Output)`, type);

    const inputFluid = index === 0 ? 'nak' : `${type}_nak`;
    const outputFluid = index === 0 ? 'nak_hot' : `${type}_nak_hot`;
    const inputDisplay = index === 0 ? 'Eutectic NAK Alloy' : `Eutectic NaK-${mixture} Mixture`;
    const outputDisplay = index === 0 ? 'Hot Eutectic NaK Alloy' : `Hot Eutectic NaK-${mixture} Mixture`;
    heaterRecipe(
      builder,
      heater,
      inputFluid,
      inputDisplay,
      outputFluid,
      outputDisplay,
      1,
      1,
      coolingRates.int(index),
    );
  });

  const vessel = block('nuclearcraft:salt_fission_vessel', 'Fuel Vessel');
  vessel.modules[`${MSR}fuel_vessel`] = {};
  port(
    builder,
    vessel,
    'nuclearcraft:fission_vessel_port',
    'Fuel Vessel Port (Input)',
    'Fuel Vessel Port (Output)',
    null,
  );

  const irradiator = block('nuclearcraft:fission_irradiator', 'Neutron Irradiator');
  irradiator.modules[`${MSR}irradiator`] = {};
  port(
    builder,
    irradiator,
    'nuclearcraft:fission_irradiator_port',
    'Neutron Irradiator Port (Input)',
    'Neutron Irradiator Port (Output)',
    null,
  );

  block('nuclearcraft:fission_conductor', 'Conductor').modules[`${MSR}conductor`] = {};

  const graphite = builder.blockWithDefinition(oredictDef('blockGraphite'), 'Graphite Moderator');
  graphite.modules[`${MSR}moderator`] = { flux: fluxFac.int(0), efficiency: f32(modEff.double(0)) };
  addLegacyNames(graphite, ['nuclearcraft:ingot_block:8']);
  const beryllium = builder.blockWithDefinition(oredictDef('blockBeryllium'), 'Beryllium Moderator');
  beryllium.modules[`${MSR}moderator`] = { flux: fluxFac.int(1), efficiency: f32(modEff.double(1)) };
  addLegacyNames(beryllium, ['nuclearcraft:ingot_block:9']);
  block('nuclearcraft:heavy_water_moderator', 'Heavy Water Moderator').modules[`${MSR}moderator`] = {
    flux: fluxFac.int(2),
    efficiency: f32(modEff.double(2)),
  };

  const reflector = (name: string, displayName: string, state: string, index: number): void => {
    const element = block(name, displayName);
    setBlockstate(element.def, 'type', state);
    element.modules[`${MSR}reflector`] = {
      efficiency: f32(refEff.double(index)),
      reflectivity: f32(refRef.double(index)),
    };
  };
  reflector('nuclearcraft:fission_reflector:0', 'Beryllium-Carbon Reflector', 'beryllium_carbon', 0);
  reflector('nuclearcraft:fission_reflector:1', 'Lead-Steel Reflector', 'lead_steel', 1);

  shield(
    builder,
    'nuclearcraft:fission_shield:0',
    'boron_silver',
    'Boron-Silver Neutron Shield',
    'overhaul/boron-silver',
    'overhaul/boron-silver_closed',
    shieldHeat.double(0),
    shieldEff.double(0),
    MSR,
  );

  const dustTbp = builder.globalElement(oredictDef('dustTBP'), 'Protactinium-Enriched Thorium Dust')
    .definition;
  ConfigurationBuilder.tag(
    builder.globalElement(legacyItemDef('nuclearcraft:fission_dust:3'), 'Protactinium-Enriched Thorium Dust')
      .element,
    'dustTBP',
  );
  const dustProtactinium233 = builder.globalElement(
    oredictDef('dustProtactinium233'),
    'Protactinium-233 Dust',
  ).definition;
  ConfigurationBuilder.tag(
    builder.globalElement(legacyItemDef('nuclearcraft:fission_dust:4'), 'Protactinium-233 Dust').element,
    'dustProtactinium233',
  );
  const dustPolonium = builder.globalElement(oredictDef('dustPolonium'), 'Polonium Dust').definition;
  ConfigurationBuilder.tag(
    builder.globalElement(legacyItemDef('nuclearcraft:fission_dust:2'), 'Polonium Dust').element,
    'dustPolonium',
  );

  irradiatorRecipe(
    builder,
    irradiator,
    [oredictDef('ingotThorium'), oredictDef('dustThorium')],
    'Thorium',
    dustTbp,
    f32(irrEff.double(0)),
    f32(irrHeat.double(0)),
    ['nuclearcraft:dust:3', 'Thorium Dust'],
  );
  irradiatorRecipe(
    builder,
    irradiator,
    [oredictDef('ingotTBP'), oredictDef('dustTBP')],
    'Protactinium-Enriched Thorium',
    dustProtactinium233,
    f32(irrEff.double(1)),
    f32(irrHeat.double(1)),
    ['nuclearcraft:fission_dust:3', 'Protactinium-Enriched Thorium Dust'],
  );
  irradiatorRecipe(
    builder,
    irradiator,
    [oredictDef('ingotBismuth'), oredictDef('dustBismuth')],
    'Bismuth',
    dustPolonium,
    f32(irrEff.double(2)),
    f32(irrHeat.double(2)),
    ['nuclearcraft:fission_dust:0', 'Bismuth Dust'],
  );

  const fuels = builder.list('fuels');
  const vesselRecipes: JsonObject[] = [];
  for (const [baseName, fuelNames] of MSR_FUEL_FAMILIES) {
    const time = fission.list(`fission_${baseName}_fuel_time`);
    const heat = fission.list(`fission_${baseName}_heat_generation`);
    const efficiency = fission.list(`fission_${baseName}_efficiency`);
    const criticality = fission.list(`fission_${baseName}_criticality`);
    const selfPriming = fission.list(`fission_${baseName}_self_priming`);
    for (let i = 0; i < fuelNames.length; i++) {
      const name = fuelNames[i];
      if (name === null || name === undefined) continue;
      const lower = name.toLowerCase();
      const baseNam =
        baseName === 'mixed'
          ? `${lower.replace(/-/g, '_').replace(/ /g, '_').replace(/mf4/g, 'mix')}_fluoride_flibe`
          : `${lower.replace(/-/g, '_').replace(/ /g, '_').replace(/mf4/g, 'mix')}_flibe`;
      const outputName = `depleted_${baseNam}`;
      const inputGlobal = builder.globalElement(legacyFluidDef(baseNam), name).definition;
      const outputGlobal = builder.globalElement(legacyFluidDef(outputName), `Depleted ${name}`).definition;
      const element = plainElementJson(
        legacyRecipeDef([elementStack(inputGlobal, 1)], [elementStack(outputGlobal, 1)]),
        {
          ...moduleBag(displayNameModule(name), textureModule()),
          [`${MSR}fuel_stats`]: {
            efficiency: efficiency.getAsFloat(i),
            heat: heat.getAsInt(i),
            time: f32(time.getAsInt(i) * fuelTimeMult),
            criticality: criticality.getAsInt(i),
            self_priming: selfPriming.bool(i),
          },
          ...legacyNamesModule([name]),
        },
      );
      fuels.push(element);
      vesselRecipes.push(element);
    }
  }
  void fuelHeatMult;
  void fuelEfficiencyMult;
  void vesselRecipes;
  vessel.recipes.push(...fuels);

  for (const [metadata, displayName, state, tag] of [
    [8, 'Graphite Block', 'graphite', 'blockGraphite'],
    [9, 'Beryllium Block', 'beryllium', 'blockBeryllium'],
  ] as const) {
    const def = legacyBlockDef(`nuclearcraft:ingot_block:${metadata}`);
    setBlockstate(def, 'type', state);
    ConfigurationBuilder.tag(builder.globalElement(def, displayName).element, tag);
  }
  ConfigurationBuilder.tag(
    builder.globalElement(legacyItemDef('nuclearcraft:ingot:3'), 'Thorium Ingot').element,
    'ingotThorium',
  );
  ConfigurationBuilder.tag(
    builder.globalElement(legacyItemDef('nuclearcraft:dust:3'), 'Thorium Dust').element,
    'dustThorium',
  );
  ConfigurationBuilder.tag(
    builder.globalElement(legacyItemDef('nuclearcraft:fission_dust:0'), 'Bismuth Dust').element,
    'dustBismuth',
  );

  builder.finalize();
  void source;
  return configurationJson(builder, `${OVERHAUL_MSR_ID}_configuration_settings`, settings, []);
}

/** `OverhaulTurbineConfigurationBuilder` + `OverhaulNCConfigReader:309-355`. */
function readOverhaulTurbine(turbine: CfgNode, source: ConfigSource, issues: IssueLog): JsonObject {
  const builder = new ConfigurationBuilder(
    OVERHAUL_TURBINE_ID,
    `${OVERHAUL_TURBINE_ID}_configuration_settings`,
    issues,
    'turbine',
  );
  const block = (name: string, displayName: string): ElementState => builder.block(name, displayName);

  const controller = block('nuclearcraft:turbine_controller', 'Turbine Controller');
  controller.modules[`${TURBINE}controller`] = {};
  controller.modules[`${TURBINE}casing`] = { edge: false };

  block('nuclearcraft:turbine_computer_port', 'Turbine Computer Port').modules[`${TURBINE}casing`] = {
    edge: false,
  };
  block('nuclearcraft:turbine_redstone_port', 'Turbine Redstone Port').modules[`${TURBINE}casing`] = {
    edge: false,
  };
  block('nuclearcraft:turbine_casing', 'Turbine Casing').modules[`${TURBINE}casing`] = { edge: true };
  block('nuclearcraft:turbine_glass', 'Turbine Glass').modules[`${TURBINE}casing`] = { edge: false };
  block('nuclearcraft:turbine_inlet', 'Fluid Inlet').modules[`${TURBINE}inlet`] = {};
  block('nuclearcraft:turbine_outlet', 'Fluid Outlet').modules[`${TURBINE}outlet`] = {};

  const effLenParams = turbine.list('turbine_throughput_leniency_params');
  const settings: JsonObject = {
    fluid_per_blade: turbine.int('turbine_mb_per_blade'),
    min_length: turbine.int('turbine_min_size'),
    min_width: Math.max(3, turbine.int('turbine_min_size')),
    max_size: turbine.int('turbine_max_size'),
    throughput_efficiency_leniency_multiplier: f32(effLenParams.double(0)),
    throughput_efficiency_leniency_threshold: f32(effLenParams.double(1)),
    throughput_factor: f32(turbine.double('turbine_tension_throughput_factor')),
    power_bonus: f32(turbine.double('turbine_power_bonus_multiplier')),
  };

  const bladeEffs = turbine.list('turbine_blade_efficiency');
  const bladeExps = turbine.list('turbine_blade_expansion');
  TURBINE_BLADES.forEach(([name, displayName], index) => {
    block(name, displayName).modules[`${TURBINE}blade`] = {
      efficiency: f32(bladeEffs.double(index)),
      expansion: f32(bladeExps.double(index)),
    };
  });

  block('nuclearcraft:turbine_rotor_stator', 'Rotor Stator').modules[`${TURBINE}stator`] = {
    expansion: f32(turbine.double('turbine_stator_expansion')),
  };

  const coilEffs = turbine.list('turbine_coil_conductivity');
  const coilRules = turbine.list('turbine_coil_rule');
  TURBINE_COILS.forEach(([name, displayName, state], index) => {
    const element = block(name, displayName);
    setBlockstate(element.def, 'type', state);
    element.modules[`${TURBINE}coil`] = { efficiency: f32(coilEffs.double(index)), rules: [] };
    element.pendingRules.push(coilRules.str(index));
  });

  const connector = block('nuclearcraft:turbine_coil_connector', 'Dynamo Coil Connector');
  connector.modules[`${TURBINE}connector`] = { rules: [] };
  connector.pendingRules.push(turbine.list('turbine_connector_rule').str(0));
  block('nuclearcraft:turbine_rotor_bearing', 'Rotor Bearing').modules[`${TURBINE}bearing`] = {};
  block('nuclearcraft:turbine_rotor_shaft', 'Rotor Shaft').modules[`${TURBINE}shaft`] = {};

  const rPows = turbine.list('turbine_power_per_mb');
  const rCoeffs = turbine.list('turbine_expansion_level');
  const exhaust = builder.globalElement(legacyFluidDef('exhaust_steam'), 'Exhaust Steam').definition;
  const lqs = builder.globalElement(legacyFluidDef('low_quality_steam'), 'Low Quality Steam').definition;

  const recipes = builder.list('recipes');
  const recipe = (
    inputName: string,
    inputDisplayName: string,
    output: Def,
    index: number,
  ): void => {
    const inputGlobal = builder.globalElement(legacyFluidDef(inputName), inputDisplayName).definition;
    const element = plainElementJson(
      legacyRecipeDef(
        [elementStack(inputGlobal, 1)],
        [elementStack(output, 4)],
      ),
      {
        ...moduleBag(displayNameModule(inputDisplayName), textureModule()),
        [`${TURBINE}recipe_stats`]: {
          power: rPows.double(index),
          coefficient: rCoeffs.double(index),
        },
        ...legacyNamesModule([inputDisplayName]),
      },
    );
    // the recipe's own input rate is 1, the output rate 4 for hps and 2 for lps/steam
    const stacks = element.inputs as JsonValue[];
    void stacks;
    recipes.push(element);
  };
  recipe('high_pressure_steam', 'High Pressure Steam', exhaust, 0);
  recipe('low_pressure_steam', 'Low Pressure Steam', lqs, 1);
  recipe('steam', 'Steam', lqs, 2);

  builder.finalize();
  void source;
  return configurationJson(builder, `${OVERHAUL_TURBINE_ID}_configuration_settings`, settings, []);
}

/** `OverhaulDistillerConfigurationBuilder` + `OverhaulNCConfigReader:357-398`. */
function readOverhaulDistiller(machine: CfgNode, source: ConfigSource, issues: IssueLog): JsonObject {
  const builder = new ConfigurationBuilder(
    OVERHAUL_DISTILLER_ID,
    `${OVERHAUL_DISTILLER_ID}_configuration_settings`,
    issues,
  );
  const block = (name: string, displayName: string): ElementState => builder.block(name, displayName);

  const settings: JsonObject = {
    min_size: machine.int('machine_min_size'),
    max_size: machine.int('machine_max_size'),
    base_time: machine.int('machine_distiller_time'),
    base_power: machine.int('machine_distiller_power'),
  };

  const controller = block('nuclearcraft:distiller_controller', 'Distiller Controller');
  controller.modules[`${DISTILLER}controller`] = {};
  controller.modules[`${DISTILLER}casing`] = { edge: false };

  block('nuclearcraft:machine_redstone_port', 'Machine Redstone Port').modules[`${DISTILLER}casing`] = {
    edge: false,
  };
  block('nuclearcraft:machine_computer_port', 'Machine Computer Port').modules[`${DISTILLER}casing`] = {
    edge: false,
  };
  block('nuclearcraft:machine_frame', 'Machine Casing').modules[`${DISTILLER}casing`] = { edge: true };
  block('nuclearcraft:machine_glass', 'Machine Glass').modules[`${DISTILLER}casing`] = { edge: false };

  const powerPort = block('nuclearcraft:machine_power_port', 'Machine Power Port');
  setBlockstate(powerPort.def, 'active', false);
  powerPort.modules[`${DISTILLER}power_port`] = {};
  powerPort.modules[`${DISTILLER}casing`] = { edge: false };

  for (let index = 0; index < 10; index++) {
    const input = index < 2;
    const element = block(
      'nuclearcraft:machine_process_port',
      `Machine Process Port (${input ? 'Input' : 'Output'} ${input ? index + 1 : index - 1})`,
    );
    setBlockstate(element.def, 'machine_port_sorption', input ? 'fluid_in' : 'fluid_out');
    element.modules[`${DISTILLER}process_port`] = { index };
    element.modules[`${DISTILLER}casing`] = { edge: false };
    element.def.nbt = `{setting:${index}}`;
  }

  block('nuclearcraft:distiller_sieve_tray', 'Distiller Sieve Tray').modules[`${DISTILLER}sieve_tray`] = {};
  block('nuclearcraft:distiller_reflux_unit', 'Distiller Reflux Unit').modules[`${DISTILLER}reflux_unit`] =
    {};
  block('nuclearcraft:distiller_reboiling_unit', 'Distiller Reboiling Unit').modules[
    `${DISTILLER}reboiling_unit`
  ] = {};
  block('nuclearcraft:distiller_liquid_distributor', 'Distiller Liquid Distributor').modules[
    `${DISTILLER}liquid_distributer`
  ] = {};

  for (const [name, displayName, state, efficiency] of DISTILLER_SIEVES) {
    const element = block(name, displayName);
    setBlockstate(element.def, 'type', state);
    element.modules[`${DISTILLER}sieve_assembly`] = { efficiency: f32(efficiency) };
  }

  builder.finalize();
  void source;
  return configurationJson(builder, `${OVERHAUL_DISTILLER_ID}_configuration_settings`, settings, []);
}

// ---------------------------------------------------------------------------
// Builder helpers shared by the overhaul readers
// ---------------------------------------------------------------------------

/** `OverhaulSFRConfigurationBuilder.coolantVent` (`:135-144`). */
function coolantVent(
  builder: ConfigurationBuilder,
  name: string,
  displayName: string,
  outputDisplayName: string,
): void {
  const prefix = name.includes('overhaul_msr')
    ? MSR
    : name.includes('overhaul_turbine')
      ? TURBINE
      : SFR;
  const input = builder.block(name, displayName);
  setBlockstate(input.def, 'active', false);
  input.modules[`${prefix}coolant_vent`] = { output: false };

  const output = builder.block(name, outputDisplayName);
  setBlockstate(output.def, 'active', true);
  output.modules[`${prefix}coolant_vent`] = { output: true };
}

/**
 * `OverhaulSFRConfigurationBuilder.port` (`:145-159`) and
 * `OverhaulMSRConfigurationBuilder.port` (`:132-154`). `type` is the MSR-only
 * port blockstate/legacy-name suffix; the SFR variant passes `null`.
 */
function port(
  builder: ConfigurationBuilder,
  parent: ElementState,
  name: string,
  displayName: string,
  outputDisplayName: string,
  type: string | null,
): void {
  const prefix = parent.def.name === 'nuclearcraft:salt_fission_vessel' ? MSR : SFR;
  const input = builder.block(name, displayName);
  input.port = true;
  input.parent = parent;
  setBlockstate(input.def, 'active', false);
  if (type !== null) {
    addLegacyNames(input, [legacyDefinitionToString(input.def)]);
    setBlockstate(input.def, 'type', type);
  }
  input.modules[`${prefix}port`] = { output: false };

  const output = builder.block(name, outputDisplayName);
  output.port = true;
  output.parent = parent;
  setBlockstate(output.def, 'active', true);
  if (type !== null) {
    addLegacyNames(output, [legacyDefinitionToString(output.def)]);
    setBlockstate(output.def, 'type', type);
  }
  output.modules[`${prefix}port`] = { output: true };

  parent.modules[`${prefix}recipe_ports`] = {
    input: blockReference(input.def),
    output: blockReference(output.def),
  };
}

/** `Overhaul*ConfigurationBuilder.shield` (`:160-174` / `:166-180`). */
function shield(
  builder: ConfigurationBuilder,
  name: string,
  type: string,
  displayName: string,
  texture: string,
  closedTexture: string,
  heatPerFlux: number,
  efficiency: number,
  prefix: string,
): void {
  void texture;
  void closedTexture;
  const open = builder.block(name, displayName);
  setBlockstate(open.def, 'type', type);
  setBlockstate(open.def, 'active', false);
  addLegacyNames(open, [`${name}[active=false]`]);
  open.modules[`${prefix}neutron_shield`] = {
    heat_per_flux: Math.trunc(heatPerFlux),
    efficiency: f32(efficiency),
  };

  const closed = builder.block(name, displayName);
  setBlockstate(closed.def, 'type', type);
  setBlockstate(closed.def, 'active', true);
  addLegacyNames(closed, [`${name}[active=true]`]);

  (open.modules[`${prefix}neutron_shield`] as JsonObject).closed = blockReference(closed.def);
}

/** `Overhaul*ConfigurationBuilder.irradiatorRecipe` — the R2.9 fixed path. */
function irradiatorRecipe(
  builder: ConfigurationBuilder,
  irradiator: ElementState,
  inputDefinitions: readonly Def[],
  inputDisplayName: string,
  output: Def,
  efficiency: number,
  heat: number,
  legacy: readonly string[],
): void {
  const prefix = irradiator.modules[`${MSR}irradiator`] !== undefined ? MSR : SFR;
  // NCPFListElement inside a recipe: getRecipeContainedAlternative() (deviation 3).
  const input = listElementStack(inputDefinitions);
  const element = plainElementJson(legacyRecipeDef([input], [elementStack(output, 1)]), {
    ...moduleBag(displayNameModule(inputDisplayName), textureModule()),
    [`${prefix}irradiator_stats`]: { efficiency: f32(efficiency), heat: f32(heat) },
    ...legacyNamesModule([inputDisplayName, ...legacy]),
  });
  irradiator.recipes.push(element);
}

/** `OverhaulMSRConfigurationBuilder.heaterRecipe` (`:155-165`). */
function heaterRecipe(
  builder: ConfigurationBuilder,
  heater: ElementState,
  inputName: string,
  inputDisplayName: string,
  outputName: string,
  outputDisplayName: string,
  inputRate: number,
  outputRate: number,
  cooling: number,
): void {
  const input = builder.globalElement(legacyFluidDef(inputName), inputDisplayName).definition;
  const output = builder.globalElement(legacyFluidDef(outputName), outputDisplayName).definition;
  const element = plainElementJson(
    legacyRecipeDef([elementStack(input, inputRate)], [elementStack(output, outputRate)]),
    {
      ...moduleBag(displayNameModule(inputDisplayName), textureModule()),
      [`${MSR}heater_stats`]: { cooling },
      ...legacyNamesModule([inputDisplayName]),
    },
  );
  heater.recipes.push(element);
}

/**
 * `OverhaulSFRConfigurationBuilder.coolantRecipe` (`:220-235`): the element's
 * definition is *replaced* by the input definition, so the stacks it just built
 * are never serialised (Java's `getRecipeDefinition()` cast would fail).
 */
function coolantRecipe(
  builder: ConfigurationBuilder,
  input: Def | readonly Def[],
  inputDisplayName: string,
  output: Def,
  heat: number,
  inputRate: number,
  outputRate: number,
  extraLegacy: readonly string[],
): JsonObject {
  const inputDef = Array.isArray(input) ? (input as readonly Def[])[0] : (input as Def);
  const outputDisplay = builder.findElementDisplayName(output);
  void inputRate;
  void outputRate;
  const legacy = [inputDisplayName, `${inputDisplayName} to ${outputDisplay}`];
  if (inputDef !== undefined && Array.isArray(input)) {
    // Java built the stacks from an NCPFListElement and then dropped the
    // definition; only the display name of the *first* definition survives.
  }
  return plainElementJson(inputDef ?? legacyFluidDef('water'), {
    ...moduleBag(displayNameModule(inputDisplayName), textureModule()),
    [`${SFR}coolant_recipe_stats`]: { heat },
    ...legacyNamesModule([...legacy, ...extraLegacy]),
  });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Java `UnderhaulNCConfigReader.formatMatches` (`:20-23`). */
function underhaulMatches(input: LegacyInput): boolean {
  try {
    const root = parseForgeConfig(input.text, input.container);
    return root.getSection('fission')?.hasProperty('fission_cooling_rate') ?? false;
  } catch {
    return false;
  }
}

/** Java `OverhaulNCConfigReader.formatMatches` (`:23-26`). */
function overhaulMatches(input: LegacyInput): boolean {
  try {
    const root = parseForgeConfig(input.text, input.container);
    return root.getSection('fission')?.hasProperty('fission_sink_cooling_rate') ?? false;
  } catch {
    return false;
  }
}

/**
 * `UnderhaulNCConfigReader` — `order` 27, the position
 * `FileReader.formats` gives it in `tools/golden/.../Bootstrap.java:117`.
 */
export const UnderhaulNCConfigReader: LegacyFormatReader = {
  name: 'UnderhaulNCConfigReader',
  order: 27,
  matches: underhaulMatches,
  read: (input) => (underhaulMatches(input) ? readUnderhaul(input) : null),
};

/**
 * `OverhaulNCConfigReader` — `order` 26 (`Bootstrap.java:116`). Java tries it
 * before the underhaul reader, which is why the underhaul probe must key on
 * `fission_cooling_rate` (a sink-rate file is not underhaul).
 */
export const OverhaulNCConfigReader: LegacyFormatReader = {
  name: 'OverhaulNCConfigReader',
  order: 26,
  matches: overhaulMatches,
  read: (input) => (overhaulMatches(input) ? readOverhaul(input) : null),
};

/** Both readers in Java's registration order. */
export const NC_CONFIG_READERS: readonly LegacyFormatReader[] = [
  OverhaulNCConfigReader,
  UnderhaulNCConfigReader,
];

/** Convenience for tests/tools: read bytes with one reader. */
export function readNcConfig(
  reader: LegacyFormatReader,
  bytes: Uint8Array,
  container = '<bytes>',
): LegacyReadResult {
  const result = reader.read(makeInput(bytes, container));
  if (result === null) {
    throw new LegacyFormatError(`${reader.name}: the input does not match this reader`);
  }
  return result;
}
