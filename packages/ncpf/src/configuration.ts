import { readFileSync } from 'node:fs';
import { makeElement, type NCPFElement } from './element.js';
import { COMMON_MODULE, moduleOf } from './module.js';
import type { RawConfiguration, RawElement, RawModule, RawModules, RawProject } from './raw.js';

/**
 * A parsed NCPF configuration set (one `<name>.ncpf.json`).
 *
 * The Java loader produces one typed `*Configuration` object per reactor type
 * (34 in total across the shipped configs, 4 in `nuclearcraft.ncpf.json`) via
 * ~120 hand-written module classes. Here a configuration is simply its element
 * lists plus its settings bag; the reactor types interpret them (see
 * `@ncplanner/kernel`).
 */
export interface Configuration {
  /** e.g. `nuclearcraft:overhaul_sfr` */
  readonly id: string;
  /** Source label (file name), used by identity keys. */
  readonly container: string;
  /** `<listName>` → elements, e.g. `blocks`, `fuels`, `coolant_recipes`. */
  readonly lists: ReadonlyMap<string, readonly NCPFElement[]>;
  /** Settings modules, keyed by fully qualified module name. */
  readonly modules: RawModules;
  /** The element list whose name is `blocks` (empty when absent). */
  readonly blocks: readonly NCPFElement[];
  /** Metadata module payload (`plannerator:configuration_metadata`). */
  readonly metadata: RawModule | undefined;
}

export function configurationList(config: Configuration, name: string): readonly NCPFElement[] {
  return config.lists.get(name) ?? [];
}

/** The value of a settings module, e.g. `sparsity_penalty_threshold`. */
export function settingsOf(config: Configuration, moduleName: string): RawModule | undefined {
  return config.modules[moduleName] as RawModule | undefined;
}

export interface NCPFProject {
  readonly containerName: string;
  readonly version: number;
  readonly configurations: readonly Configuration[];
  /** Global elements (`plannerator:global_elements`). */
  readonly globalElements: readonly NCPFElement[];
  getConfiguration(id: string): Configuration | undefined;
}

function parseElementList(v: unknown): NCPFElement[] {
  if (!Array.isArray(v)) return [];
  return (v as RawElement[]).map((e) => makeElement(e));
}

function parseConfiguration(id: string, container: string, raw: RawConfiguration): Configuration {
  const lists = new Map<string, readonly NCPFElement[]>();
  const modules: RawModules = raw.modules ?? {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'modules') continue;
    if (Array.isArray(value)) lists.set(key, parseElementList(value));
  }
  const global = moduleOf({ modules }, COMMON_MODULE.globalElements);
  const elements = global?.elements;
  if (Array.isArray(elements)) {
    lists.set('global_elements', parseElementList(elements));
  }
  return {
    id,
    container,
    lists,
    modules,
    blocks: lists.get('blocks') ?? [],
    metadata: modules[COMMON_MODULE.configurationMetadata] as RawModule | undefined,
  };
}

export function buildProject(raw: RawProject, containerName: string): NCPFProject {
  const configurations: Configuration[] = [];
  for (const [id, cfg] of Object.entries(raw.configuration ?? {})) {
    configurations.push(parseConfiguration(id, containerName, cfg as RawConfiguration));
  }
  const globalModule = raw.modules?.[COMMON_MODULE.globalElements] as RawModule | undefined;
  const globalElements = Array.isArray(globalModule?.elements)
    ? parseElementList(globalModule?.elements)
    : [];
  const byId = new Map(configurations.map((c) => [c.id, c]));
  return {
    containerName,
    version: typeof raw.version === 'number' ? raw.version : 0,
    configurations,
    globalElements,
    getConfiguration(id: string) {
      return byId.get(id);
    },
  };
}

/** Parse a project JSON string (project file or configuration file). */
export function parseProject(json: string, containerName = '<inline>'): NCPFProject {
  return buildProject(JSON.parse(json) as RawProject, containerName);
}

/** Read and parse an NCPF project / configuration file from disk. */
export function loadProjectFile(path: string): NCPFProject {
  const name = path.split(/[\\/]/).pop() ?? path;
  return parseProject(readFileSync(path, 'utf8'), name);
}
