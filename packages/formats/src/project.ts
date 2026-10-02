import { readFileSync } from 'node:fs';
import { buildProject, type NCPFElement, type NCPFProject, type RawProject } from '@ncplanner/ncpf';
import { configurationSpec, type ConfigurationSpec } from './configSpecs.js';
import { elementView, recipeLookup, resolveDesign, type NcpfDesignDocument, type RecipeLookup } from './designs.js';
import { fingerprint } from './fingerprint.js';
import { deepCloneJson, isJsonObject, jsonObjects, type JsonObject, type JsonValue } from './json.js';
import { javaDefinitionToString } from './javaModel.js';

/**
 * The NCPF read layer (R1.4a), equivalent to Java's `NCPFFileReader` +
 * `NCPFReader` for the JSON format (`JSONNCPFReader`).
 *
 * **Full fidelity is the design goal**: unknown modules, unknown fields and
 * unknown design types are preserved *verbatim* because the document keeps the
 * parsed JSON tree (`raw`) as the single source of truth. Java instead round
 * trips everything through its object model, which silently drops fields no
 * `NCPFModule`/`NCPFElementDefinition` class knows about; TS is a strict superset
 * of that behaviour (see `docs/r1/r1.4-ncpf-io.md`).
 *
 * Everything else is a *view* on top of that tree:
 *  - `ncpf` — the `@ncplanner/ncpf` typed project (`buildProject`), the
 *    logic-side element views;
 *  - `configurations` / `addons` — per-configuration element lists plus the
 *    per-reactor-type knowledge from `configSpecs.ts`;
 *  - `designs` — designs with element references resolved *by identity*.
 */

export class NcpfFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NcpfFormatError';
  }
}

/** A single `<configId>` object of `configuration`. */
export interface NcpfConfigurationDocument {
  /** JSON key, e.g. `nuclearcraft:overhaul_sfr`. */
  readonly id: string;
  /** Source container (file base name); part of the four-segment identity key. */
  readonly container: string;
  /** Java `NCPFConfiguration.getName()` — used verbatim by the R0 fingerprint. */
  readonly javaName: string;
  readonly spec: ConfigurationSpec;
  readonly raw: JsonObject;
  readonly modules: JsonObject;
  /** `<listName>` → elements, parsed through `@ncplanner/ncpf`. */
  readonly lists: ReadonlyMap<string, readonly NCPFElement[]>;
  /** Elements of one list (empty when absent). */
  list(name: string): readonly NCPFElement[];
  /** Java `NCPFObject.getIndex`: `-1`/absent/out of range → `null`. */
  elementAt(listName: string, index: number): NCPFElement | null;
  /** Java `NCPFObject.indexof`, but by element identity (R1.4d). */
  identityIndexOf(listName: string, identity: string): number;
  /** The `ncpf:block_recipes` recipes of a block element. */
  recipesOf(element: NCPFElement): readonly NCPFElement[];
  /** True when this config type declares `listName` as an element list. */
  declaresList(listName: string): boolean;
}

export interface NcpfAddonDocument {
  readonly index: number;
  readonly raw: JsonObject;
  /** Java `Addon.getName()` — the fingerprint writes this verbatim. */
  readonly javaName: string | null;
  readonly configurations: readonly NcpfConfigurationDocument[];
}

export interface NcpfProjectDocument {
  /** Container label (file base name, or `<string>` for inline JSON). */
  readonly container: string;
  readonly version: number;
  /** The parsed JSON tree, verbatim. */
  readonly raw: JsonObject;
  readonly modules: JsonObject;
  readonly configurations: readonly NcpfConfigurationDocument[];
  readonly addons: readonly NcpfAddonDocument[];
  readonly designs: readonly NcpfDesignDocument[];
  /** The `@ncplanner/ncpf` typed view (element/logic side). */
  readonly ncpf: NCPFProject;
  /** Non-fatal format oddities noticed while reading (diagnostics only). */
  readonly issues: readonly string[];
  getConfiguration(id: string): NcpfConfigurationDocument | undefined;
  /** Deep clone of the parsed JSON tree. */
  toJson(): JsonObject;
  /** R0 structural fingerprint (see `fingerprint.ts`). */
  fingerprint(): string;
}

function buildConfiguration(
  id: string,
  container: string,
  raw: JsonObject,
  recipes: RecipeLookup,
): NcpfConfigurationDocument {
  const spec = configurationSpec(id);
  const lists = new Map<string, readonly NCPFElement[]>();
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'modules' || !Array.isArray(value)) continue;
    lists.set(key, jsonObjects(value).map((element) => elementView(element)));
  }
  const modules = isJsonObject(raw.modules) ? raw.modules : {};
  return {
    id,
    container,
    javaName: spec.name,
    spec,
    raw,
    modules,
    lists,
    list: (name) => lists.get(name) ?? [],
    elementAt: (listName, index) => (index < 0 ? null : (lists.get(listName)?.[index] ?? null)),
    identityIndexOf: (listName, identity) => {
      const list = lists.get(listName) ?? [];
      for (let i = 0; i < list.length; i++) {
        const element = list[i];
        if (element !== undefined && javaDefinitionToString(element.raw as unknown as JsonObject) === identity) {
          return i;
        }
      }
      return -1;
    },
    recipesOf: (element) => recipes(element),
    declaresList: (listName) => spec.elementLists.includes(listName),
  };
}

/**
 * Build a single configuration view (used by the reader and by the export
 * writer, which rebuilds views over the filtered element lists).
 */
export function buildConfigurationDocument(
  id: string,
  container: string,
  raw: JsonObject,
): NcpfConfigurationDocument {
  return buildConfiguration(id, container, raw, recipeLookup());
}

/**
 * Java `Addon.getName()`: the first configuration's
 * `plannerator:configuration_metadata.name`, else `plannerator:metadata.name`,
 * else "Unknown Configuration". Java can return `null` here (metadata module
 * present but nameless); the fingerprint renders that as the literal `"null"`,
 * so the TS value stays `null` and is rendered by `fingerprint.ts`.
 */
function addonJavaName(raw: JsonObject, configurations: readonly NcpfConfigurationDocument[]): string | null {
  for (const configuration of configurations) {
    const metadata = configuration.modules['plannerator:configuration_metadata'];
    if (!isJsonObject(metadata)) continue;
    const name = metadata.name;
    return typeof name === 'string' ? name : null;
  }
  const meta = isJsonObject(raw.modules) ? raw.modules['plannerator:metadata'] : undefined;
  const name = isJsonObject(meta) ? meta.name : undefined;
  return typeof name === 'string' ? name : 'Unknown Configuration';
}

function buildAddon(
  index: number,
  container: string,
  raw: JsonObject,
  recipes: RecipeLookup,
): NcpfAddonDocument {
  const configurations: NcpfConfigurationDocument[] = [];
  if (isJsonObject(raw.configuration)) {
    for (const [id, configuration] of Object.entries(raw.configuration)) {
      if (!isJsonObject(configuration)) continue;
      configurations.push(buildConfiguration(id, container, configuration, recipes));
    }
  }
  return { index, raw, javaName: addonJavaName(raw, configurations), configurations };
}

/** Build the full document view over an already parsed NCPF JSON tree. */
export function buildProjectDocument(raw: JsonObject, container: string): NcpfProjectDocument {
  const recipes = recipeLookup();
  const configurations: NcpfConfigurationDocument[] = [];
  if (isJsonObject(raw.configuration)) {
    for (const [id, configuration] of Object.entries(raw.configuration)) {
      if (!isJsonObject(configuration)) continue;
      configurations.push(buildConfiguration(id, container, configuration, recipes));
    }
  }
  const byId = new Map(configurations.map((configuration) => [configuration.id, configuration]));

  const addons: NcpfAddonDocument[] = [];
  if (Array.isArray(raw.addons)) {
    raw.addons.forEach((addon, index) => {
      if (!isJsonObject(addon)) return;
      addons.push(buildAddon(index, container, addon, recipes));
    });
  }

  const issues: string[] = [];
  const context = {
    blocksFor: (configId: string | null) =>
      configId === null ? undefined : byId.get(configId)?.lists.get('blocks'),
    elementAt: (configId: string | null, listName: string, index: number) =>
      configId === null ? null : (byId.get(configId)?.elementAt(listName, index) ?? null),
    recipes,
  };
  const designs: NcpfDesignDocument[] = [];
  if (Array.isArray(raw.designs)) {
    raw.designs.forEach((design, index) => {
      if (!isJsonObject(design)) return;
      const resolved = resolveDesign(index, design, context);
      if (resolved.type !== null && !byId.has(resolved.type)) {
        issues.push(`design[${index}]: type "${resolved.type}" has no configuration in this file`);
      }
      for (const reference of resolved.scalarReferences.values()) {
        const stored = design[reference.key];
        if (reference.element === null && typeof stored === 'number' && stored >= 0) {
          issues.push(`design[${index}]: ${reference.key}=${stored} does not resolve in "${reference.listName}"`);
        }
      }
      // Java would throw IndexOutOfBounds on a dangling grid index
      // (`NCPFObject.getDefined3DArray` → `indicies.get(idx)`); TS tolerates it,
      // resolves the cell to `null` and reports the index instead.
      const grid = resolved.grid;
      if (grid !== null) {
        for (let x = 0; x < grid.blocks.length; x++) {
          for (let y = 0; y < grid.blocks[x].length; y++) {
            for (let z = 0; z < grid.blocks[x][y].length; z++) {
              const stored = design.design;
              const rawIndex = Array.isArray(stored) ? (stored[x] as JsonValue[] | undefined)?.[y] : undefined;
              const value = Array.isArray(rawIndex) ? rawIndex[z] : undefined;
              if (typeof value === 'number' && value >= 0 && grid.blocks[x][y][z] === null) {
                issues.push(`design[${index}]: blocks[${x}][${y}][${z}]=${value} does not resolve`);
              }
            }
          }
        }
      }
      designs.push(resolved);
    });
  }

  let fingerprintCache: string | undefined;
  const document: NcpfProjectDocument = {
    container,
    version: typeof raw.version === 'number' ? raw.version : 0,
    raw,
    modules: isJsonObject(raw.modules) ? raw.modules : {},
    configurations,
    addons,
    designs,
    ncpf: buildProject(raw as unknown as RawProject, container),
    issues,
    getConfiguration: (id) => byId.get(id),
    toJson: () => deepCloneJson(raw),
    fingerprint: () => fingerprintCache ?? (fingerprintCache = fingerprint(document)),
  };
  return document;
}

function containerNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Parse NCPF JSON text into a document. */
export function parseNcpfProject(json: string, container = '<string>'): NcpfProjectDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new NcpfFormatError(`not valid JSON (${(error as Error).message})`);
  }
  if (!isJsonObject(parsed)) throw new NcpfFormatError('NCPF root must be a JSON object');
  // Java `JSONNCPFReader.read`: a missing/non-integer `version` means "not NCPF".
  if (typeof parsed.version !== 'number' || !Number.isInteger(parsed.version)) {
    throw new NcpfFormatError('not an NCPF document (missing integer "version")');
  }
  return buildProjectDocument(parsed, container);
}

/** Read an NCPF file from disk. */
export function readNcpfPath(path: string): NcpfProjectDocument {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new NcpfFormatError(`cannot read ${path}: ${(error as Error).message}`);
  }
  if (!text.trimStart().startsWith('{')) {
    throw new NcpfFormatError(
      `${path} is not NCPF JSON; binary/legacy NCPF readers are R2 scope (docs/rewrite-plan-r1-r5.md §5)`,
    );
  }
  return parseNcpfProject(text, containerNameOf(path));
}

/**
 * `readNcpfProject(path | string)`.
 *
 * A string starting with `{` (ignoring leading whitespace) is treated as NCPF
 * JSON; anything else is treated as a filesystem path. Use {@link readNcpfPath}
 * or {@link parseNcpfProject} when the intent must be explicit.
 */
export function readNcpfProject(input: string): NcpfProjectDocument {
  return input.trimStart().startsWith('{') ? parseNcpfProject(input) : readNcpfPath(input);
}
