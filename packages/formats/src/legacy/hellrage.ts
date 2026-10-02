/**
 * R2.5 / R2.6 / R2.10 — the **Hellrage** format family, read side.
 *
 * Ported from the frozen Java baseline (`src/net/ncplanner/plannerator/...`):
 *
 *  - `planner/file/reader/OverhaulHellrageSFR6Reader.java` — Overhaul SFR v6
 *    (`SaveVersion.Major==2 && Minor==1 && Build>=1`, blocks nested under `Data`)
 *  - `planner/file/reader/OverhaulHellrageSFR5Reader.java` — Overhaul SFR v5
 *    (`2.0.32–2.0.37`, sections at the top level; this is what the real 2020 file
 *    `datasets/fixtures/historical/overhaul.json` is — see
 *    `docs/r0/historical-fixtures.md` line 25)
 *  - `planner/file/reader/UnderhaulHellrage2Reader.java` — underhaul v2
 *    (`1.2.Build>=23`)
 *  - `planner/file/reader/UnderhaulHellrage1Reader.java` — underhaul v1
 *    (`1.2.5 <= Build <= 22`; no sample file exists, the format is exercised by a
 *    synthesized document in `test/r2.5-hellrage.test.ts`)
 *  - `planner/file/reader/LegacyNeutronSourceHandler.java` — the `;True;<source>`
 *    fuel-cell path, ported operation for operation (walk out in the six
 *    `Direction` enum directions, keep the last in-bounds cell per direction,
 *    sort by distance, overwrite the first cell that is empty or not already a
 *    neutron source)
 *  - `planner/file/recovery/{NonRecoveryHandler,RecoveryModeHandler}.java` — the
 *    name → element resolution (`recoverFallbackName`), including the "throw
 *    `IllegalArgumentException("Invalid <type> name: <name>!")` when nothing
 *    matches" behaviour.
 *
 * **Not ported** (P2, no sample file anywhere — `docs/r0/compat-contract.md` §2.3,
 * `docs/rewrite-plan-r1-r5.md` §5 R2.7): `OverhaulHellrageMSR1..6Reader` and
 * `OverhaulHellrageSFR1..4Reader`. The registry `order` numbers of those readers
 * are deliberately left unused so this file's ordering stays directly comparable
 * with the registration table in `docs/r0/compat-contract.md` §6.
 *
 * ------------------------------------------------------------------ format facts
 *
 * A Hellrage file stores **names**, never ids: `CompressedReactor`/`HeatSinks`/…
 * map a stripped English block name to a list of positions, and the fuel cell map
 * is keyed `"<fuel>;<primed>;<source>"`. Two consequences are easy to get wrong:
 *
 *  1. **The casing is never written** (`HellrageWriter.java:54`, "can't save the
 *     casing :("): only interior cells (`1..X`, `1..Y`, `1..Z` of the
 *     `(X+2)(Y+2)(Z+2)` design grid) carry blocks. Read and write both drop it,
 *     so round-trip assertions must compare interiors only.
 *  2. **A neutron source is never a block entry.** The fuel cell key records
 *     `;True;<source name>` and the reader re-places the source by adjacency
 *     (`LegacyNeutronSourceHandler`), which is why the source ends up in the
 *     *casing* layer of the design grid.
 *
 * The produced tree is the NCPF JSON tree the frozen Java reader chain would have
 * written for the same file (`FormatGolden`): one design, an **empty
 * `configuration`** and element references as integers into the app's *active*
 * configuration — Java's `Project.convertToObject` resolves against
 * `Core.project` whenever the file's own configuration is empty
 * (`Project.java:36`). TS therefore resolves names against the same shipped
 * configuration (`src/configurations/nuclearcraft.ncpf.json`, i.e.
 * `Configuration.initNuclearcraftConfiguration`), which is what makes
 * `datasets/fixtures/historical/underhaul.json` reproduce its golden byte for
 * byte.
 *
 * ---------------------------------------------------------------- deviations
 *
 * **R2.10 — matching is by element identity, never by display name.** The frozen
 * readers match the file's names against each element's *display name* after
 * stripping suffixes (`RecoveryModeHandler.recoverOverhaulSFRBlock`,
 * `…UnderhaulSFRBlock`, `…OverhaulSFRFuel`) and therefore fail on three of the
 * four shipped files (`Invalid fuel name: MOX-241!`, `Invalid block name: !`,
 * `Invalid block name: Cf-252!` — `docs/r0/fixtures.md` §2,
 * `docs/r0/historical-fixtures.md`). This port instead builds, per format and
 * per section, an index of the names an element *registers for itself*:
 *
 *  - every entry of `plannerator:legacy_names.legacy_names`, and
 *  - the definition identity (`javaDefinitionToString`, i.e. `name[:metadata]`),
 *
 * reduced with the very same name transform `HellrageWriter` applies (strip
 * spaces and the type words — see {@link HELLRAGE_NAME_TRANSFORMS}). The file's
 * name is reduced by the same transform, so `plannerator:display_name` is never
 * consulted and a localized configuration keeps importing.
 *
 * Deliberate deviations, each with its justification:
 *
 *  1. **Case-insensitive, order-insensitive transforms.** Java lower-cases some
 *     processors and not others, and only strips the type words of the section it
 *     happens to be reading. The transforms here lower-case first and remove
 *     every type word at once, so `Liquid Helium Cooler` matches the historical
 *     `Helium` key directly instead of only through its second registered legacy
 *     name (Java relies on that second name).
 *  2. **Underhaul `Moderator` keeps its name.** `HellrageWriter` removes the word
 *     `Moderator`, so the underhaul moderator block is written under the *empty*
 *     key — which the frozen reader then rejects (`Invalid block name: !`,
 *     `datasets/fixtures/usfr-hellrage.json`). Reading still accepts the empty key
 *     (the fixture must read; it is one of the recovery cases of deviation 8),
 *     and the writer emits `Moderator` instead.
 *  3. **The extra "scan my recipes' legacy names and return *me*" pass of
 *     `NonRecoveryHandler.recoverFallbackName` is not reproduced.** It maps a
 *     *recipe* name onto its containing block, which is precisely the class of
 *     conflation iron law 2 forbids (and which the underhaul active-cooler path
 *     already models explicitly, see {@link activeCoolerRecipe}).
 *  4. **Out-of-grid coordinates are reported, not thrown.** Java writes straight
 *     into the design array and dies with `ArrayIndexOutOfBoundsException`; TS
 *     records an issue and skips the entry so a slightly damaged file stays
 *     readable (the coordinate sets that matter are identical).
 *  5. **Missing sections are empty, not fatal.** Java `getJSONObject(...)`
 *     returns `null` and the following `keySet()` throws `NullPointerException`
 *     (the reader chain swallows it and reports "unknown format"); TS treats an
 *     absent section as empty and notes it in {@link LegacyReadResult.issues}.
 *  6. **Missing scalars default instead of crashing.** A missing
 *     `CoolantRecipeName` gives `coolant_recipe: -1` (the same value Java writes
 *     when it cannot find the recipe) instead of an NPE; a missing `UsedFuel.Name`
 *     still throws, exactly like Java's `Invalid fuel name: null!`.
 *  7. **`LegacyNeutronSourceHandler` tie-breaking.** Java collects candidates in
 *     a `HashMap<int[], Integer>` (identity-hashed, therefore arbitrary order)
 *     and stable-sorts by distance; TS walks the six directions in
 *     `Direction.values()` order (`PX, PY, PZ, NX, NY, NZ`) and stable-sorts, so
 *     ties resolve deterministically. Distinct source placements are unaffected.
 *  8. **The frozen reader's own matcher is kept, but only as a diagnostic.** A
 *     name is *resolved* purely by element identity (R2.10), yet Java's
 *     `NonRecoveryHandler.recoverFallbackName` scan — every element's
 *     `plannerator:legacy_names` through the section's `nameProcessor`, which is
 *     what `RecoveryModeHandler`/`NonRecoveryHandler` throw `Invalid <type> name:
 *     <name>!` from — runs alongside it, so an issue is recorded exactly where
 *     the frozen version throws: `Cf-252` (the `Neutron Source` suffix Java's
 *     processor does not strip), the underhaul moderator's empty key, the
 *     non-bracketed fuel cells (`MOX-241`), and Hellrage's `Self` self-priming
 *     marker (`HellrageWriter.java:166`, which is not an element at all: no
 *     source block is placed). Those reads additionally embed the configuration
 *     they resolved against, because a recovered import whose file carries no
 *     configuration of its own would otherwise only be meaningful against the
 *     app's active one. Files the frozen reader *can* read
 *     (`datasets/fixtures/historical/underhaul.json`) keep Java's empty
 *     `configuration` byte for byte — recovery is the only trigger.
 */
import { COMMON_MODULE, modulesOf, type NCPFElement } from '@ncplanner/ncpf';
import { readFileSync } from 'node:fs';
import { elementView, emitBlockGrid, emitRecipeGrid } from '../designs.js';
import { isJsonObject, jsonArray, type JsonObject, type JsonValue } from '../json.js';
import { javaDefinitionToString } from '../javaModel.js';
import {
  buildProjectDocument,
  type NcpfConfigurationDocument,
  type NcpfProjectDocument,
} from '../project.js';
import { LegacyFormatError, type LegacyFormatReader, type LegacyInput, type LegacyReadResult, cloneJson } from './types.js';

// ---------------------------------------------------------------- constants

/** `NCPFOverhaulSFRConfiguration.name` / the `configuration` key of the same name. */
export const OVERHAUL_SFR = 'nuclearcraft:overhaul_sfr';
/** `NCPFUnderhaulSFRConfiguration.name`. */
export const UNDERHAUL_SFR = 'nuclearcraft:underhaul_sfr';

/** `MetadataModule.getName()` — always present on a design and on the file root. */
const METADATA_MODULE = 'plannerator:metadata';

const OVERHAUL_MODULES = modulesOf(OVERHAUL_SFR);
const UNDERHAUL_MODULES = modulesOf(UNDERHAUL_SFR);

/** `plannerator:overhaul_sfr:fuel_stats.self_priming` (Java `FuelStatsModule`). */
const SELF_PRIMING_FIELD = 'self_priming';

/**
 * Hellrage's third fuel-cell field when the fuel primes itself
 * (`HellrageWriter.java:166`: `block.fuel.stats.selfPriming?"Self":…`). It names
 * no element — the frozen reader dies on it (`Invalid block name: Self!`), and a
 * fixed-semantics read places no source block for it.
 */
const SELF_SOURCE = 'self';

/** `Direction.values()` order (`multiblock/Direction.java`). */
const DIRECTIONS: readonly Position[] = [
  { x: 1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: -1 },
];

// ------------------------------------------------------------- name handling

/**
 * A canonical Hellrage spelling: a pure function of an element's *registered*
 * names. Two names that the format considers the same map to the same string.
 */
export interface NameTransform {
  /** Stable id, used as a cache key and in diagnostics. */
  readonly id: string;
  apply(name: string): string;
}

/** Java `StringUtil.superRemove` (sequential literal removal). */
function removeAll(text: string, patterns: readonly string[]): string {
  let out = text;
  for (const pattern of patterns) out = out.split(pattern).join('');
  return out;
}

/** Java `StringUtil.superReplace` (sequential literal replacement, pairwise). */
function replaceAll(text: string, pairs: readonly string[]): string {
  let out = text;
  for (let i = 0; i + 1 < pairs.length; i += 2) out = out.split(pairs[i] as string).join(pairs[i + 1] as string);
  return out;
}

function transform(id: string, reduce: (lowercased: string) => string): NameTransform {
  return { id, apply: (name) => reduce(name.toLowerCase()) };
}

/**
 * The name transforms, one per Hellrage section. Each mirrors the matching
 * `HellrageWriter` key computation (`HellrageWriter.java:63,112,126,140,154`)
 * reduced to its lower-cased form; the *reader* uses the same functions so a file
 * written by either implementation resolves.
 */
export const HELLRAGE_NAME_TRANSFORMS = {
  /**
   * Underhaul block keys — `HellrageWriter.java:63`
   * (`superRemove(superReplace(name, "Reactor Cell","Fuel Cell","Active","Active "), " ", "Liquid", "Cooler", "Moderator")`),
   * used when *reading*. It maps the moderator block to the empty key, which is
   * what `datasets/fixtures/usfr-hellrage.json` contains.
   */
  underhaulBlockRead: transform('underhaul-block-read', (name) =>
    removeAll(replaceAll(name, ['reactor cell', 'fuel cell', 'active', 'active ']), [
      ' ',
      'liquid',
      'cooler',
      'moderator',
    ]),
  ),
  /**
   * Underhaul block keys as **written** — the same transform minus the
   * `Moderator` removal, so the moderator keeps a name instead of collapsing to
   * the empty key the frozen reader rejects (deviation 2 in the module header).
   */
  underhaulBlockWrite: transform('underhaul-block-write', (name) =>
    removeAll(replaceAll(name, ['reactor cell', 'fuel cell', 'active', 'active ']), [' ', 'liquid', 'cooler']),
  ),
  /** Overhaul heat sinks — `HellrageWriter.java:112`. */
  heatSink: transform('heat-sink', (name) => removeAll(name, [' ', 'heatsink', 'sink', 'liquid'])),
  /** Overhaul moderators — `HellrageWriter.java:126`. */
  moderator: transform('moderator', (name) => removeAll(name, [' ', 'moderator'])),
  /** Overhaul reflectors — `HellrageWriter.java:140`. */
  reflector: transform('reflector', (name) => removeAll(name, [' ', 'reflector'])),
  /** Overhaul neutron shields — `HellrageWriter.java:154`. */
  neutronShield: transform('neutron-shield', (name) => removeAll(name, [' ', 'neutronshield', 'shield'])),
  /**
   * Overhaul neutron sources — `HellrageWriter.java:166`
   * (`superRemove(source.template.getDisplayName(), " Neutron Source")`). The
   * reader resolves either spelling (`Cf-252` or `Cf-252 Neutron Source`).
   */
  neutronSource: transform('neutron-source', (name) => removeAll(name, [' ', 'neutronsource'])),
  /** Fuels and coolant recipes: case/space-insensitive, no type words. */
  plain: transform('plain', (name) => removeAll(name, [' '])),
} as const;

/** The names an element registers for itself — **never** its display name. */
export function registeredNames(element: NCPFElement): readonly string[] {
  const names: string[] = [];
  const legacy = element.modules[COMMON_MODULE.legacyNames];
  if (isJsonObject(legacy)) {
    for (const value of jsonArray(legacy.legacy_names)) {
      if (typeof value === 'string' && value.length > 0) names.push(value);
    }
  }
  const raw = element.raw as unknown as JsonObject;
  const identity = javaDefinitionToString(raw);
  if (identity.length > 0) names.push(identity);
  const name = raw.name;
  const metadata = raw.metadata;
  if (typeof name === 'string' && name.length > 0) {
    names.push(name);
    if (typeof metadata === 'number') names.push(`${name}:${metadata}`);
  }
  return names;
}

/**
 * The one name this port writes for an element: its first registered legacy name,
 * else its definition identity. Never `plannerator:display_name` (iron law 2).
 */
export function identityName(element: NCPFElement): string {
  const names = registeredNames(element);
  return names[0] ?? '';
}

// ------------------------------------------------------- frozen-reader matcher

/**
 * The names the **frozen** readers examine. `NonRecoveryHandler.recoverFallbackName`
 * iterates `t.getModule(LegacyNamesModule).legacyNames` and nothing else — never
 * `plannerator:display_name`, never the definition identity. (The R0 reports call
 * this "display-name matching" because the shipped configuration spells most
 * blocks' single legacy name the same as their display name, and
 * `HellrageWriter` writes the display name.)
 */
function javaLegacyNames(element: NCPFElement): readonly string[] {
  const names: string[] = [];
  const legacy = element.modules[COMMON_MODULE.legacyNames];
  if (isJsonObject(legacy)) {
    for (const value of jsonArray(legacy.legacy_names)) {
      if (typeof value === 'string' && value.length > 0) names.push(value);
    }
  }
  return names;
}

/**
 * "Would the frozen reader have found *some* match for `name` in this list?".
 *
 * This is the only question asked about Java's rules, and it is asked purely to
 * classify a hit: the element itself is always chosen by identity (R2.10). A hit
 * that Java's own `nameProcessor` would not have produced is exactly a case where
 * the frozen version throws `Invalid <type> name: <name>!`.
 */
type JavaNameMatch = (name: string) => boolean;

/** Builds the {@link JavaNameMatch} of one element list. */
type JavaMatchFactory = (
  list: readonly NCPFElement[],
  recipesOf: (element: NCPFElement) => readonly NCPFElement[],
) => JavaNameMatch;

/**
 * `RecoveryModeHandler.recoverOverhaulSFRBlock`'s processor
 * (`superRemove(toLowerCase(name), " ", "heatsink", "liquid", "moderator",
 * "reflector", "neutronshield", "shield")`, compared case-insensitively against
 * the file's name with spaces removed), including its second pass over each
 * element's recipe legacy names.
 */
const JAVA_OVERHAUL_BLOCK: JavaMatchFactory = (list, recipesOf) => {
  const reduce = (text: string): string =>
    removeAll(text.toLowerCase(), [' ', 'heatsink', 'liquid', 'moderator', 'reflector', 'neutronshield', 'shield']);
  return (name) => {
    const key = removeAll(name.toLowerCase(), [' ']);
    return list.some((element) =>
      [element, ...recipesOf(element)].some((candidate) =>
        javaLegacyNames(candidate).some((legacy) => reduce(legacy) === key),
      ),
    );
  };
};

/**
 * `RecoveryModeHandler.recoverUnderhaulSFRBlock`'s processor
 * (`superRemove(toLowerCase(name), "cooler", " ")`), plus its recipe pass.
 */
const JAVA_UNDERHAUL_BLOCK: JavaMatchFactory = (list, recipesOf) => {
  const reduce = (text: string): string => removeAll(text.toLowerCase(), ['cooler', ' ']);
  return (name) => {
    const key = removeAll(name.toLowerCase(), [' ']);
    return list.some((element) =>
      [element, ...recipesOf(element)].some((candidate) =>
        javaLegacyNames(candidate).some((legacy) => reduce(legacy) === key),
      ),
    );
  };
};

/**
 * `RecoveryModeHandler.recoverOverhaulSFRFuel(block, name)`'s processor: Java
 * hard-codes the `[OX]`/`[NI]`/`[ZA]` prefix width (`name.substring(4)`, which
 * throws `StringIndexOutOfBoundsException` on a shorter key) and then tries the
 * bare, `Oxide`, `Nitride` and `-Zirconium Alloy` spellings.
 */
function javaOverhaulFuelMatch(fuels: readonly NCPFElement[]): JavaNameMatch {
  return (name) => {
    if (name.length < 4) return false;
    const rest = name.slice(4);
    const keys = [rest, `${rest} Oxide`, `${rest} Nitride`, `${rest}-Zirconium Alloy`].map((candidate) =>
      removeAll(candidate.toLowerCase(), [' ']),
    );
    return fuels.some((fuel) =>
      javaLegacyNames(fuel).some((legacy) => keys.includes(removeAll(legacy.toLowerCase(), [' ']))),
    );
  };
}

/**
 * `recoverUnderhaulSFRFuel` / `recoverOverhaulSFRCoolantRecipe` (a `null`
 * processor, i.e. plain `nam.equalsIgnoreCase(name)` over the legacy names).
 */
const JAVA_EXACT_NAME: JavaMatchFactory = (list) => (name) =>
  list.some((element) => javaLegacyNames(element).some((legacy) => legacy.toLowerCase() === name.toLowerCase()));

/** How many names one read resolved through the R2.10 recovery path. */
interface RecoveryNotes {
  count: number;
}

/**
 * Record one R2.10 recovery: a name the frozen reader throws on
 * (`Invalid <type> name: <name>!` in `NonRecoveryHandler.recoverFallbackName`)
 * and which element identity does resolve.
 */
function noteRecovery(
  recovery: RecoveryNotes,
  issues: string[],
  where: string,
  type: string,
  name: string,
  element: NCPFElement,
): void {
  recovery.count++;
  issues.push(
    `${where}: the frozen reader cannot resolve ${type} name "${name}" (Invalid ${type} name: ${name}!); ` +
      `resolved by element identity to ${javaDefinitionToString(element.raw as unknown as JsonObject)}`,
  );
}

/** `fuel_stats.self_priming` of a fuel element (Java `FuelStatsModule.selfPriming`). */
function isSelfPriming(fuel: NCPFElement): boolean {
  const stats = fuel.modules[OVERHAUL_MODULES.fuelStats];
  return isJsonObject(stats) && stats[SELF_PRIMING_FIELD] === true;
}

/** A name → element lookup for one element list under one transform. */
export class HellrageNameIndex {
  private readonly byKey = new Map<string, number[]>();

  constructor(
    private readonly list: readonly NCPFElement[],
    private readonly nameTransform: NameTransform,
    /**
     * The frozen reader's match for this list, or `null` where it has no name
     * lookup at all. Never used to pick the element — see {@link JavaNameMatch}.
     */
    private readonly javaMatch: JavaNameMatch | null = null,
  ) {
    list.forEach((element, index) => {
      for (const name of registeredNames(element)) {
        const key = nameTransform.apply(name);
        const existing = this.byKey.get(key);
        if (existing === undefined) this.byKey.set(key, [index]);
        else if (!existing.includes(index)) existing.push(index);
      }
    });
  }

  /** Indices whose registered names reduce to the same key (list order). */
  candidates(name: string): readonly number[] {
    return this.byKey.get(this.nameTransform.apply(name)) ?? [];
  }

  /** First match in list order (Java's `for(T t : list)` scan), or `null`. */
  lookup(
    name: string,
  ): { element: NCPFElement; index: number; ambiguous: number; recovered: boolean } | null {
    const candidates = this.candidates(name);
    const index = candidates[0];
    if (index === undefined) return null;
    const element = this.list[index];
    if (element === undefined) return null;
    return {
      element,
      index,
      ambiguous: candidates.length,
      recovered: this.javaMatch !== null && !this.javaMatch(name),
    };
  }

  /** The identity key a name reduces to (diagnostics). */
  keyOf(name: string): string {
    return this.nameTransform.apply(name);
  }
}

// ------------------------------------------------------------------- context

export interface HellrageReaderOptions {
  /**
   * NCPF JSON tree of the app's active configuration — the TS equivalent of
   * Java's `Core.project` (`Configuration.NUCLEARCRAFT`). Defaults to the shipped
   * `src/configurations/nuclearcraft.ncpf.json`; inject it to read against a
   * different (e.g. addon-extended) configuration.
   */
  readonly root?: JsonObject;
}

const DEFAULT_ROOT_URL = new URL('../../../../src/configurations/nuclearcraft.ncpf.json', import.meta.url);

let cachedDefaultRoot: JsonObject | null = null;

/** The shipped NuclearCraft configuration (`Core.project`'s configuration). */
export function defaultHellrageRoot(): JsonObject {
  const cached = cachedDefaultRoot;
  if (cached !== null) return cached;
  const parsed: unknown = JSON.parse(readFileSync(DEFAULT_ROOT_URL, 'utf8'));
  if (!isJsonObject(parsed)) {
    throw new LegacyFormatError(`${DEFAULT_ROOT_URL.pathname} is not an NCPF document`);
  }
  cachedDefaultRoot = parsed;
  return parsed;
}

interface HellrageContext {
  readonly root: JsonObject;
  readonly document: NcpfProjectDocument;
  readonly indexes: Map<string, HellrageNameIndex>;
}

const contextCache = new WeakMap<JsonObject, HellrageContext>();

function contextOf(root: JsonObject): HellrageContext {
  const cached = contextCache.get(root);
  if (cached !== undefined) return cached;
  const context: HellrageContext = {
    root,
    document: buildProjectDocument(root, '<hellrage-configuration>'),
    indexes: new Map(),
  };
  contextCache.set(root, context);
  return context;
}

/** A configuration of the active project, or `undefined` when it declares none. */
function configurationOf(context: HellrageContext, configId: string): NcpfConfigurationDocument | undefined {
  return context.document.getConfiguration(configId);
}

function indexOf(
  context: HellrageContext,
  configuration: NcpfConfigurationDocument,
  listName: string,
  nameTransform: NameTransform,
  javaMatch: JavaMatchFactory | null = null,
): HellrageNameIndex {
  const key = `${configuration.id}\u0000${listName}\u0000${nameTransform.id}`;
  const cached = context.indexes.get(key);
  if (cached !== undefined) return cached;
  const list = configuration.list(listName);
  const built = new HellrageNameIndex(
    list,
    nameTransform,
    javaMatch === null ? null : javaMatch(list, (element) => configuration.recipesOf(element)),
  );
  context.indexes.set(key, built);
  return built;
}

/**
 * Java `NonRecoveryHandler.recoverFallbackName`'s "nothing matched" branch:
 * `throw new IllegalArgumentException("Invalid "+type+" name: "+name+"!")`.
 *
 * Reached only when *neither* the frozen reader's legacy-name scan nor element
 * identity resolves the name — an element is never invented for it.
 */
function unresolved(type: string, name: string): never {
  throw new LegacyFormatError(`Invalid ${type} name: ${name}!`);
}

// -------------------------------------------------------------- design grids

interface Position {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A design grid: interior size `x,y,z`, arrays spanning `(x+2)(y+2)(z+2)`. */
interface DesignGrid {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly blocks: (NCPFElement | null)[][][];
  readonly recipes: (NCPFElement | null)[][][];
}

function createGrid(x: number, y: number, z: number): DesignGrid {
  const size = (n: number): number => n + 2;
  const empty = <T>(nx: number, ny: number, nz: number): T[][][] =>
    Array.from({ length: nx }, () => Array.from({ length: ny }, () => Array.from({ length: nz }, () => null as T)));
  return {
    x,
    y,
    z,
    blocks: empty<NCPFElement | null>(size(x), size(y), size(z)),
    recipes: empty<NCPFElement | null>(size(x), size(y), size(z)),
  };
}

function inGrid(grid: DesignGrid, x: number, y: number, z: number): boolean {
  return x >= 0 && y >= 0 && z >= 0 && x < grid.x + 2 && y < grid.y + 2 && z < grid.z + 2;
}

function setBlock(
  grid: DesignGrid,
  position: Position,
  element: NCPFElement,
  where: string,
  issues: string[],
): boolean {
  if (!inGrid(grid, position.x, position.y, position.z)) {
    issues.push(`${where}: (${position.x},${position.y},${position.z}) is outside the design grid`);
    return false;
  }
  grid.blocks[position.x][position.y][position.z] = element;
  return true;
}

function setRecipe(grid: DesignGrid, position: Position, recipe: NCPFElement | null): void {
  if (!inGrid(grid, position.x, position.y, position.z)) return;
  grid.recipes[position.x][position.y][position.z] = recipe;
}

function hasModule(element: NCPFElement, module: string): boolean {
  return element.modules[module] !== undefined;
}

/**
 * Java `LegacyNeutronSourceHandler.addNeutronSource`: place `source` in the cell
 * nearest to `(x,y,z)` that is empty or already a neutron source, walking the six
 * directions and stopping at fuel cells / reflectors / irradiators (which block
 * the line of sight).
 */
function addNeutronSource(grid: DesignGrid, origin: Position, source: NCPFElement): void {
  const possible: { position: Position; distance: number }[] = [];
  for (const direction of DIRECTIONS) {
    let step = 0;
    for (;;) {
      step++;
      const x = origin.x + direction.x * step;
      const y = origin.y + direction.y * step;
      const z = origin.z + direction.z * step;
      if (!inGrid(grid, x, y, z)) {
        possible.push({
          position: {
            x: origin.x + direction.x * (step - 1),
            y: origin.y + direction.y * (step - 1),
            z: origin.z + direction.z * (step - 1),
          },
          distance: step,
        });
        break;
      }
      const block = grid.blocks[x][y][z];
      if (block === null) continue; // air
      if (
        hasModule(block, OVERHAUL_MODULES.fuelCell) ||
        hasModule(block, OVERHAUL_MODULES.reflector) ||
        hasModule(block, OVERHAUL_MODULES.irradiator)
      ) {
        break;
      }
    }
  }
  possible.sort((a, b) => a.distance - b.distance); // Array#sort is stable
  for (const candidate of possible) {
    const { x, y, z } = candidate.position;
    const existing = grid.blocks[x][y][z];
    if (existing !== null && hasModule(existing, OVERHAUL_MODULES.neutronSource)) continue;
    grid.blocks[x][y][z] = source;
    return;
  }
}

// -------------------------------------------------------------- JSON helpers

function jsonObject(value: JsonValue | undefined): JsonObject | null {
  return isJsonObject(value) ? value : null;
}

function jsonStringValue(value: JsonValue | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

function intField(value: JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

function numberField(value: JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Java `JSON.JSONObject.getInt` on a missing key (returns `null`, callers NPE). */
function readPositions(value: JsonValue | undefined, where: string, issues: string[]): Position[] {
  const out: Position[] = [];
  for (const entry of jsonArray(value)) {
    if (!isJsonObject(entry)) {
      issues.push(`${where}: entry is not an object`);
      continue;
    }
    const x = intField(entry.X);
    const y = intField(entry.Y);
    const z = intField(entry.Z);
    if (x === null || y === null || z === null) {
      issues.push(`${where}: entry without integer X/Y/Z`);
      continue;
    }
    out.push({ x, y, z });
  }
  return out;
}

interface SaveVersion {
  readonly major: number;
  readonly minor: number;
  readonly build: number;
}

function saveVersionOf(hellrage: JsonObject): SaveVersion | null {
  const version = jsonObject(hellrage.SaveVersion);
  if (version === null) return null;
  const major = intField(version.Major);
  const minor = intField(version.Minor);
  const build = intField(version.Build);
  if (major === null || minor === null || build === null) return null;
  return { major, minor, build };
}

/** Java `for(String name : fuelCells.keySet()) if(name.startsWith("[F4]"))return false;` */
function looksLikeMsr(fuelCells: JsonObject | null): boolean {
  if (fuelCells === null) return false;
  return Object.keys(fuelCells).some((key) => key.startsWith('[F4]'));
}

/** Parse once per input (a `LegacyInput` is reused by `matches` and `read`). */
const parseCache = new WeakMap<LegacyInput, JsonObject | null>();

function parseHellrage(input: LegacyInput): JsonObject | null {
  const cached = parseCache.get(input);
  if (cached !== undefined) return cached;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(input.text);
  } catch {
    parsed = null;
  }
  const result = isJsonObject(parsed) ? parsed : null;
  parseCache.set(input, result);
  return result;
}

// ------------------------------------------------------------ tree emission

/** Java `round(...)`: the element index of every cell, `-1` for air. */
function emitDesign(
  type: string,
  grid: DesignGrid,
  configuration: NcpfConfigurationDocument,
  scalars: Readonly<Record<string, number>>,
): JsonObject {
  const design: JsonObject = {
    type,
    dimensions: [grid.x + 2, grid.y + 2, grid.z + 2],
    design: emitBlockGrid(grid.blocks, configuration.list('blocks')),
    block_recipes: emitRecipeGrid(grid.blocks, grid.recipes, (block) => configuration.recipesOf(block)),
    modules: { [METADATA_MODULE]: {} },
  };
  for (const [key, index] of Object.entries(scalars)) design[key] = index;
  return design;
}

/**
 * The NCPF file a Java `new Project()` + one design converts to
 * (`NCPFFile.convertToObject`): `version 1`, no addons, and the
 * `plannerator:metadata` module on root and design.
 *
 * `configuration` is empty — exactly like Java's conversion, which leaves the
 * design's element references as indices into the app's *active* configuration
 * (`datasets/converted/ncpf/historical_underhaul.json`) — unless the read had to
 * recover a name the frozen reader throws on, in which case the configuration it
 * resolved against is embedded so the recovered project stands on its own
 * (deviation 8). The embedded tree is a deep copy: the caller receives a tree it
 * may mutate without touching the cached active configuration.
 */
function emitRoot(design: JsonObject, configuration: NcpfConfigurationDocument | null = null): JsonObject {
  const embedded: JsonObject = {};
  if (configuration !== null) embedded[configuration.id] = cloneJson(configuration.raw);
  return {
    version: 1,
    modules: { [METADATA_MODULE]: {} },
    addons: [],
    configuration: embedded,
    designs: [design],
  };
}

function indexInList(list: readonly NCPFElement[], element: NCPFElement | null): number {
  if (element === null) return -1;
  return list.indexOf(element);
}

// ------------------------------------------------------------------- readers

/**
 * Shared plumbing: the input is parsed once, `read()` returns `null` when
 * `matches()` is false (the contract's "not my format after all"), and every
 * reader resolves against the configured root.
 */
abstract class HellrageReaderBase implements LegacyFormatReader {
  abstract readonly name: string;
  abstract readonly order: number;

  private readonly root: JsonObject;

  constructor(options: HellrageReaderOptions = {}) {
    this.root = options.root ?? defaultHellrageRoot();
  }

  protected parsed(input: LegacyInput): JsonObject | null {
    return parseHellrage(input);
  }

  /** Version/section predicate, evaluated on an already parsed document. */
  protected abstract matchesDocument(hellrage: JsonObject): boolean;

  matches(input: LegacyInput): boolean {
    const hellrage = this.parsed(input);
    return hellrage !== null && this.matchesDocument(hellrage);
  }

  read(input: LegacyInput): LegacyReadResult | null {
    const hellrage = this.parsed(input);
    if (hellrage === null || !this.matchesDocument(hellrage)) return null;
    return this.readDocument(contextOf(this.root), hellrage);
  }

  protected abstract readDocument(context: HellrageContext, hellrage: JsonObject): LegacyReadResult;
}

/** Overhaul SFR: the two versions only differ in nesting and section set. */
abstract class OverhaulHellrageReaderBase extends HellrageReaderBase {
  /** `Data` for v6, the root object for v5. */
  protected abstract payload(hellrage: JsonObject): JsonObject;

  /** v5 predates neutron shields and irradiators. */
  protected abstract readonly hasNeutronShields: boolean;
  protected abstract readonly hasIrradiators: boolean;

  protected override readDocument(context: HellrageContext, hellrage: JsonObject): LegacyReadResult {
    return readOverhaulSfr(context, this.payload(hellrage), {
      hasNeutronShields: this.hasNeutronShields,
      hasIrradiators: this.hasIrradiators,
    });
  }
}

function readOverhaulSfr(
  context: HellrageContext,
  data: JsonObject,
  features: { hasNeutronShields: boolean; hasIrradiators: boolean },
): LegacyReadResult {
  const issues: string[] = [];
  const recovery: RecoveryNotes = { count: 0 };
  const configuration = configurationOf(context, OVERHAUL_SFR);
  if (configuration === undefined) {
    throw new LegacyFormatError(`the active configuration has no "${OVERHAUL_SFR}" configuration`);
  }

  const dimensions = jsonObject(data.InteriorDimensions);
  const x = dimensions === null ? null : intField(dimensions.X);
  const y = dimensions === null ? null : intField(dimensions.Y);
  const z = dimensions === null ? null : intField(dimensions.Z);
  if (x === null || y === null || z === null) {
    throw new LegacyFormatError('InteriorDimensions must carry integer X, Y and Z');
  }
  const grid = createGrid(x, y, z);

  // Java `OverhaulSFRDesign` constructor default: the first coolant recipe; the
  // file names one explicitly, and an unresolvable name is a hard error in Java.
  const blocks = indexOf(context, configuration, 'blocks', HELLRAGE_NAME_TRANSFORMS.heatSink);
  void blocks;
  const coolantRecipes = indexOf(
    context,
    configuration,
    'coolant_recipes',
    HELLRAGE_NAME_TRANSFORMS.plain,
    JAVA_EXACT_NAME,
  );
  const coolantName = jsonStringValue(data.CoolantRecipeName);
  let coolantRecipe: NCPFElement | null = null;
  if (coolantName !== null && coolantName.length > 0) {
    const match = coolantRecipes.lookup(coolantName);
    if (match === null) unresolved('recipe', coolantName);
    if (match.recovered) noteRecovery(recovery, issues, 'CoolantRecipeName', 'recipe', coolantName, match.element);
    coolantRecipe = match.element;
  } else {
    issues.push('CoolantRecipeName is missing; the design carries coolant_recipe -1');
  }

  const sections: readonly {
    key: string;
    transform: NameTransform;
  }[] = [
    { key: 'HeatSinks', transform: HELLRAGE_NAME_TRANSFORMS.heatSink },
    { key: 'Moderators', transform: HELLRAGE_NAME_TRANSFORMS.moderator },
    { key: 'Reflectors', transform: HELLRAGE_NAME_TRANSFORMS.reflector },
    ...(features.hasNeutronShields
      ? [{ key: 'NeutronShields', transform: HELLRAGE_NAME_TRANSFORMS.neutronShield }]
      : []),
  ];
  for (const section of sections) {
    const body = jsonObject(data[section.key]);
    if (body === null) {
      issues.push(`${section.key} is missing; treated as empty`);
      continue;
    }
    const index = indexOf(context, configuration, 'blocks', section.transform, JAVA_OVERHAUL_BLOCK);
    for (const [name, value] of Object.entries(body)) {
      const match = index.lookup(name);
      if (match === null) unresolved('block', name);
      if (match.recovered) noteRecovery(recovery, issues, `${section.key}.${name}`, 'block', name, match.element);
      if (match.ambiguous > 1) {
        issues.push(
          `${section.key}: "${name}" matches ${match.ambiguous} blocks; using the first (${javaDefinitionToString(
            match.element.raw as unknown as JsonObject,
          )})`,
        );
      }
      for (const position of readPositions(value, `${section.key}.${name}`, issues)) {
        setBlock(grid, position, match.element, `${section.key}.${name}`, issues);
      }
    }
  }

  const conductors = jsonArray(data.Conductors);
  if (data.Conductors !== undefined && !Array.isArray(data.Conductors)) {
    issues.push('Conductors is not an array; treated as empty');
  } else if (conductors.length > 0) {
    let conductor: NCPFElement | null = null;
    for (const block of configuration.list('blocks')) {
      if (hasModule(block, OVERHAUL_MODULES.conductor)) conductor = block;
    }
    if (conductor === null) throw new LegacyFormatError('Configuration has no conductors!');
    for (const position of readPositions(data.Conductors, 'Conductors', issues)) {
      setBlock(grid, position, conductor, 'Conductors', issues);
    }
  }

  if (features.hasIrradiators) {
    const irradiators = jsonObject(data.Irradiators);
    if (data.Irradiators !== undefined && irradiators === null) {
      issues.push('Irradiators is not an object; treated as empty');
    }
    if (irradiators !== null) {
      let irradiator: NCPFElement | null = null;
      for (const block of configuration.list('blocks')) {
        if (hasModule(block, OVERHAUL_MODULES.irradiator)) irradiator = block;
      }
      if (irradiator === null) throw new LegacyFormatError('Configuration has no irradiators!');
      const irradiatorRecipes = configuration.recipesOf(irradiator);
      for (const [name, value] of Object.entries(irradiators)) {
        const stats = parseIrradiatorRecipe(name);
        // Java keeps the *last* matching recipe (`if(...)irrecipe = irr;`).
        let recipe: NCPFElement | null = null;
        if (stats !== null) {
          for (const candidate of irradiatorRecipes) {
            const module = candidate.modules[OVERHAUL_MODULES.irradiatorStats];
            if (!isJsonObject(module)) continue;
            if (numberField(module.heat) === stats.heat && numberField(module.efficiency) === stats.efficiency) {
              recipe = candidate;
            }
          }
          if (recipe === null) {
            issues.push(`Irradiators: "${name}" matches no irradiator recipe; block placed without one`);
          }
        }
        for (const position of readPositions(value, `Irradiators.${name}`, issues)) {
          if (setBlock(grid, position, irradiator, `Irradiators.${name}`, issues)) setRecipe(grid, position, recipe);
        }
      }
    }
  }

  const fuelCells = jsonObject(data.FuelCells);
  if (fuelCells === null) throw new LegacyFormatError('FuelCells must be an object');
  let cell: NCPFElement | null = null;
  for (const block of configuration.list('blocks')) {
    if (hasModule(block, OVERHAUL_MODULES.fuelCell)) cell = block;
  }
  if (cell === null) throw new LegacyFormatError('Configuration has no fuel cells!');
  const fuelIndex = indexOf(context, configuration, 'bogus', HELLRAGE_NAME_TRANSFORMS.plain); // placeholder, unused
  void fuelIndex;
  const fuels = configuration.recipesOf(cell);
  const javaFuelMatch = javaOverhaulFuelMatch(fuels);
  const pendingSources: { position: Position; source: NCPFElement }[] = [];
  for (const [name, value] of Object.entries(fuelCells)) {
    const settings = name.split(';');
    const fuelName = settings[0] ?? '';
    const hasSource = (settings[1] ?? '').toLowerCase() === 'true';
    const fuel = resolveFuel(fuels, fuelName, javaFuelMatch, `FuelCells.${name}`, recovery, issues);
    let source: NCPFElement | null = null;
    if (hasSource) {
      const sourceName = settings[2] ?? '';
      const sourceIndex = indexOf(
        context,
        configuration,
        'blocks',
        HELLRAGE_NAME_TRANSFORMS.neutronSource,
        JAVA_OVERHAUL_BLOCK,
      );
      const match = sourceIndex.lookup(sourceName);
      if (match === null) {
        // `HellrageWriter.java:166` writes `Self` for a primed cell whose fuel is
        // self-priming: it is a marker, not an element, so no source block is
        // placed (and the frozen reader throws `Invalid block name: Self!`).
        if (sourceName.toLowerCase() === SELF_SOURCE) {
          recovery.count++;
          issues.push(
            `FuelCells.${name}: source "${sourceName}" is Hellrage's self-priming marker, not a block name ` +
              `(Invalid block name: ${sourceName}!); no neutron source block is placed` +
              (isSelfPriming(fuel) ? '' : `, and ${javaDefinitionToString(fuel.raw as unknown as JsonObject)} is not self-priming`),
          );
        } else {
          unresolved('block', sourceName);
        }
      } else {
        if (match.recovered) noteRecovery(recovery, issues, `FuelCells.${name}`, 'block', sourceName, match.element);
        source = match.element;
      }
    }
    for (const position of readPositions(value, `FuelCells.${name}`, issues)) {
      const placed = setBlock(grid, position, cell, `FuelCells.${name}`, issues);
      if (!placed) continue;
      setRecipe(grid, position, fuel);
      if (source !== null) pendingSources.push({ position, source });
    }
  }
  for (const pending of pendingSources) addNeutronSource(grid, pending.position, pending.source);

  const design = emitDesign(OVERHAUL_SFR, grid, configuration, {
    coolant_recipe: indexInList(configuration.list('coolant_recipes'), coolantRecipe),
  });
  return { raw: emitRoot(design, recovery.count > 0 ? configuration : null), issues };
}

/**
 * Java `JSON.JSONObject.getFloat("HeatPerFlux")` on the irradiator key. The key
 * is a JSON object *serialized into a JSON string*; `HellrageWriter` produces it
 * with literal backslashes (`"{\\\"HeatPerFlux\\\":…}"`), a plain JSON writer
 * produces the same bytes for the unescaped string, so both spellings are
 * accepted here.
 */
function parseIrradiatorRecipe(name: string): { heat: number; efficiency: number } | null {
  const candidates = [name];
  if (name.includes('\\')) candidates.push(name.replace(/\\"/g, '"'));
  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (!isJsonObject(parsed)) continue;
    const heat = numberField(parsed.HeatPerFlux);
    const efficiency = numberField(parsed.EfficiencyMultiplier);
    if (heat === null && efficiency === null) continue;
    return { heat: heat ?? 0, efficiency: efficiency ?? 0 };
  }
  // Java: `catch(IOException ex){ throw new IllegalArgumentException("Invalid
  // irradiator recipe: "+name); }` — only a parse failure is fatal.
  throw new LegacyFormatError(`Invalid irradiator recipe: ${name}`);
}

/**
 * The fuel name codec of the Hellrage fuel-cell key (`HellrageWriter.java:162-164`
 * plus the identity deviation of `hellrageWriter.ts`). `base` is the fuel's
 * registered legacy name.
 */
function fuelNameCandidates(name: string): readonly string[] {
  const match = /^\[(OX|NI|ZA|ID)\](.*)$/.exec(name);
  const rest = match === null ? name : (match[2] ?? '');
  switch (match?.[1]) {
    case 'OX':
      return [`${rest} Oxide`, rest];
    case 'NI':
      return [`${rest} Nitride`, rest];
    case 'ZA':
      return [`${rest}-Zirconium Alloy`, rest];
    default:
      return [rest];
  }
}

/**
 * Resolve a Hellrage fuel-cell key's fuel. Java's `recoverOverhaulSFRFuel(block,
 * name)` chops the first four characters off the key and tries the bare,
 * `Oxide`, `Nitride` and `-Zirconium Alloy` spellings against the fuels' legacy
 * names — which is why a key written without its `[OX]`/`[NI]`/`[ZA]` prefix
 * (`MOX-241`, `datasets/fixtures/sfr-hellrage.json`) throws there. TS matches the
 * same spellings by element identity instead, and reports the difference.
 */
function resolveFuel(
  fuels: readonly NCPFElement[],
  name: string,
  javaMatch: JavaNameMatch,
  where: string,
  recovery: RecoveryNotes,
  issues: string[],
): NCPFElement {
  for (const candidate of fuelNameCandidates(name)) {
    const key = HELLRAGE_NAME_TRANSFORMS.plain.apply(candidate);
    for (const fuel of fuels) {
      if (registeredNames(fuel).some((registered) => HELLRAGE_NAME_TRANSFORMS.plain.apply(registered) === key)) {
        if (!javaMatch(name)) noteRecovery(recovery, issues, where, 'fuel', name, fuel);
        return fuel;
      }
    }
  }
  return unresolved('fuel', name);
}

/** The active-cooler recipe a `CompressedReactor` key names (Java `getLegacyNames().contains(name)`). */
function activeCoolerRecipe(configuration: NcpfConfigurationDocument, block: NCPFElement, name: string): NCPFElement | null {
  if (!hasModule(block, UNDERHAUL_MODULES.activeCooler)) return null;
  for (const recipe of configuration.recipesOf(block)) {
    if (registeredNames(recipe).some((registered) => registered === name)) return recipe;
  }
  for (const recipe of configuration.recipesOf(block)) {
    if (registeredNames(recipe).some((registered) => registered.toLowerCase() === name.toLowerCase())) return recipe;
  }
  return null;
}

function readUnderhaul(
  context: HellrageContext,
  grid: DesignGrid,
  fuel: NCPFElement,
  entries: readonly { name: string; positions: readonly Position[] }[],
  issues: string[],
  recovery: RecoveryNotes,
): LegacyReadResult {
  const configuration = configurationOf(context, UNDERHAUL_SFR);
  if (configuration === undefined) {
    throw new LegacyFormatError(`the active configuration has no "${UNDERHAUL_SFR}" configuration`);
  }
  const index = indexOf(
    context,
    configuration,
    'blocks',
    HELLRAGE_NAME_TRANSFORMS.underhaulBlockRead,
    JAVA_UNDERHAUL_BLOCK,
  );
  for (const entry of entries) {
    const match = index.lookup(entry.name);
    if (match === null) unresolved('block', entry.name);
    if (match.recovered) {
      noteRecovery(recovery, issues, `CompressedReactor.${entry.name}`, 'block', entry.name, match.element);
    }
    if (match.ambiguous > 1) {
      issues.push(`CompressedReactor: "${entry.name}" matches ${match.ambiguous} blocks; using the first`);
    }
    const recipe = activeCoolerRecipe(configuration, match.element, entry.name);
    for (const position of entry.positions) {
      if (setBlock(grid, position, match.element, `CompressedReactor.${entry.name}`, issues)) {
        setRecipe(grid, position, recipe);
      }
    }
  }
  const design = emitDesign(UNDERHAUL_SFR, grid, configuration, {
    fuel: indexInList(configuration.list('fuels'), fuel),
  });
  return { raw: emitRoot(design, recovery.count > 0 ? configuration : null), issues };
}

/**
 * `UnderhaulHellrage2Reader` — underhaul v2 (`1.2.Build>=23`), the version both
 * `datasets/fixtures/usfr-hellrage.json` (synthetic) and
 * `datasets/fixtures/historical/underhaul.json` (real, 2020) are.
 */
export class UnderhaulHellrage2Reader extends HellrageReaderBase {
  readonly name = 'UnderhaulHellrage2Reader';
  /** `FileReader.formats` slot 19 (`docs/r0/compat-contract.md` §6). */
  readonly order = 19;

  protected override matchesDocument(hellrage: JsonObject): boolean {
    const version = saveVersionOf(hellrage);
    return version !== null && version.major === 1 && version.minor === 2 && version.build >= 23;
  }

  protected override readDocument(context: HellrageContext, hellrage: JsonObject): LegacyReadResult {
    const configuration = configurationOf(context, UNDERHAUL_SFR);
    if (configuration === undefined) {
      throw new LegacyFormatError(`the active configuration has no "${UNDERHAUL_SFR}" configuration`);
    }
    const issues: string[] = [];
    const recovery: RecoveryNotes = { count: 0 };
    const dimensions = jsonObject(hellrage.InteriorDimensions);
    const x = dimensions === null ? null : intField(dimensions.X);
    const y = dimensions === null ? null : intField(dimensions.Y);
    const z = dimensions === null ? null : intField(dimensions.Z);
    if (x === null || y === null || z === null) {
      throw new LegacyFormatError('InteriorDimensions must carry integer X, Y and Z');
    }

    const usedFuel = jsonObject(hellrage.UsedFuel);
    // Java `UnderhaulHellrage2Reader.java:29` — `name` is the leu-235 compatibility key.
    const fuelName =
      usedFuel === null ? null : (jsonStringValue(usedFuel.Name) ?? jsonStringValue(usedFuel.name));
    if (fuelName === null) unresolved('fuel', 'null');
    const fuels = indexOf(context, configuration, 'fuels', HELLRAGE_NAME_TRANSFORMS.plain, JAVA_EXACT_NAME);
    const fuelMatch = fuels.lookup(fuelName);
    if (fuelMatch === null) unresolved('fuel', fuelName);
    if (fuelMatch.recovered) noteRecovery(recovery, issues, 'UsedFuel', 'fuel', fuelName, fuelMatch.element);

    const compressed = jsonObject(hellrage.CompressedReactor);
    if (compressed === null) throw new LegacyFormatError('CompressedReactor must be an object');
    const entries = Object.entries(compressed).map(([name, value]) => ({
      name,
      positions: readPositions(value, `CompressedReactor.${name}`, issues),
    }));
    return readUnderhaul(context, createGrid(x, y, z), fuelMatch.element, entries, issues, recovery);
  }
}

/**
 * `UnderhaulHellrage1Reader` — underhaul v1 (`1.2.5 <= Build <= 22`).
 *
 * The pre-v2 layout: `InteriorDimensions` is the *string* `"x,y,z"` and
 * `CompressedReactor` is an **array** of single-key objects whose positions are
 * `"x,y,z"` strings. No recipe grid exists in this version (Java never touches
 * `sfr.recipes`), and `UsedFuel.Name` has no lower-case fallback.
 */
export class UnderhaulHellrage1Reader extends HellrageReaderBase {
  readonly name = 'UnderhaulHellrage1Reader';
  /** `FileReader.formats` slot 20 (`docs/r0/compat-contract.md` §6). */
  readonly order = 20;

  protected override matchesDocument(hellrage: JsonObject): boolean {
    const version = saveVersionOf(hellrage);
    return version !== null && version.major === 1 && version.minor === 2 && version.build >= 5 && version.build <= 22;
  }

  protected override readDocument(context: HellrageContext, hellrage: JsonObject): LegacyReadResult {
    const issues: string[] = [];
    const recovery: RecoveryNotes = { count: 0 };
    const dimensionText = jsonStringValue(hellrage.InteriorDimensions);
    if (dimensionText === null) throw new LegacyFormatError('InteriorDimensions must be the string "x,y,z"');
    const parts = dimensionText.split(',');
    const dimensions = parts.map((part) => Number.parseInt(part, 10));
    const [x, y, z] = dimensions;
    if (x === undefined || y === undefined || z === undefined || [x, y, z].some((value) => !Number.isFinite(value))) {
      throw new LegacyFormatError(`InteriorDimensions "${dimensionText}" is not "x,y,z"`);
    }

    const configuration = configurationOf(context, UNDERHAUL_SFR);
    if (configuration === undefined) {
      throw new LegacyFormatError(`the active configuration has no "${UNDERHAUL_SFR}" configuration`);
    }
    const usedFuel = jsonObject(hellrage.UsedFuel);
    const fuelName = usedFuel === null ? null : jsonStringValue(usedFuel.Name);
    if (fuelName === null) unresolved('fuel', 'null');
    const fuels = indexOf(context, configuration, 'fuels', HELLRAGE_NAME_TRANSFORMS.plain, JAVA_EXACT_NAME);
    const fuelMatch = fuels.lookup(fuelName);
    if (fuelMatch === null) unresolved('fuel', fuelName);
    if (fuelMatch.recovered) noteRecovery(recovery, issues, 'UsedFuel', 'fuel', fuelName, fuelMatch.element);

    const entries: { name: string; positions: Position[] }[] = [];
    for (const group of jsonArray(hellrage.CompressedReactor)) {
      if (!isJsonObject(group)) {
        issues.push('CompressedReactor: entry is not an object');
        continue;
      }
      for (const [name, value] of Object.entries(group)) {
        const positions: Position[] = [];
        for (const item of jsonArray(value)) {
          if (typeof item !== 'string') {
            issues.push(`CompressedReactor.${name}: "${String(item)}" is not an "x,y,z" string`);
            continue;
          }
          const cell = item.split(',').map((part) => Number.parseInt(part, 10));
          const [px, py, pz] = cell;
          if (px === undefined || py === undefined || pz === undefined) {
            issues.push(`CompressedReactor.${name}: "${item}" is not "x,y,z"`);
            continue;
          }
          positions.push({ x: px, y: py, z: pz });
        }
        entries.push({ name, positions });
      }
    }
    return readUnderhaul(context, createGrid(x, y, z), fuelMatch.element, entries, issues, recovery);
  }
}

/**
 * `OverhaulHellrageSFR6Reader` — Overhaul SFR v6 (`2.1.Build>=1`), the version
 * `HellrageWriter` emits and `datasets/fixtures/sfr-hellrage.json` is.
 */
export class OverhaulHellrageSFR6Reader extends OverhaulHellrageReaderBase {
  readonly name = 'OverhaulHellrageSFR6Reader';
  /** `FileReader.formats` slot 13 (`docs/r0/compat-contract.md` §6). */
  readonly order = 13;

  protected override readonly hasNeutronShields = true;
  protected override readonly hasIrradiators = true;

  protected override payload(hellrage: JsonObject): JsonObject {
    const data = jsonObject(hellrage.Data);
    if (data === null) throw new LegacyFormatError('Data must be an object');
    return data;
  }

  protected override matchesDocument(hellrage: JsonObject): boolean {
    const version = saveVersionOf(hellrage);
    if (version === null || version.major !== 2 || version.minor !== 1 || version.build < 1) return false;
    const data = jsonObject(hellrage.Data);
    const fuelCells = data === null ? null : jsonObject(data.FuelCells);
    if (fuelCells === null) return false;
    return !looksLikeMsr(fuelCells);
  }
}

/**
 * `OverhaulHellrageSFR5Reader` — Overhaul SFR v5 (`2.0.32–2.0.37`), sections at
 * the top level, no neutron shields and no irradiators. This is the reader the
 * real 2020 file `datasets/fixtures/historical/overhaul.json` matches; the frozen
 * Java version fails on it with `Invalid block name: Cf-252!`.
 */
export class OverhaulHellrageSFR5Reader extends OverhaulHellrageReaderBase {
  readonly name = 'OverhaulHellrageSFR5Reader';
  /** `FileReader.formats` slot 14 (`docs/r0/compat-contract.md` §6). */
  readonly order = 14;

  protected override readonly hasNeutronShields = false;
  protected override readonly hasIrradiators = false;

  protected override payload(hellrage: JsonObject): JsonObject {
    return hellrage;
  }

  protected override matchesDocument(hellrage: JsonObject): boolean {
    const version = saveVersionOf(hellrage);
    if (version === null || version.major !== 2 || version.minor !== 0 || version.build < 32 || version.build > 37) {
      return false;
    }
    const fuelCells = jsonObject(hellrage.FuelCells);
    if (fuelCells === null) return false;
    return !looksLikeMsr(fuelCells);
  }
}

/** The ported Hellrage readers, in registration order. */
export function hellrageReaders(options: HellrageReaderOptions = {}): readonly LegacyFormatReader[] {
  return [
    new OverhaulHellrageSFR6Reader(options),
    new OverhaulHellrageSFR5Reader(options),
    new UnderhaulHellrage2Reader(options),
    new UnderhaulHellrage1Reader(options),
  ];
}

/** Re-exported for `hellrageWriter.ts` (the format's shared name codec). */
export { elementView };
export type { HellrageContext };
