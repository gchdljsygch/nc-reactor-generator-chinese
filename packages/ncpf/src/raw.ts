/**
 * Raw NCPF JSON shapes.
 *
 * NCPF (NuclearCraft Planner Format) is the project file **and** configuration
 * format. The serialized form is deliberately loose: every object carries a
 * `type` discriminator, elements carry an arbitrary `modules` bag keyed by
 * `<configuration>:<module>` (or `plannerator:<module>` / `ncpf:<module>`), and
 * the meaning of a module's fields is defined by the module class in the Java
 * implementation.
 *
 * The TS side replaces the ~120 hand-written Java module classes with a
 * declarative registry (see `module.ts`); these types describe the wire format
 * only, never the semantics.
 */

/** Anything that can appear in a module bag value. */
export type RawValue =
  | string
  | number
  | boolean
  | null
  | RawValue[]
  | { [key: string]: RawValue };

/** A single module payload (`{"cooling": 60}` etc. is the common case). */
export type RawModule = { [key: string]: RawValue };

/** The `modules` bag of an element / recipe / configuration. */
export type RawModules = { [moduleName: string]: RawModule };

/** An element definition as it appears on the wire. */
export interface RawElement {
  type: string;
  modules?: RawModules;
  [key: string]: RawValue | RawModules | undefined;
}

/** A recipe as it appears on the wire (element definition + optional stats). */
export type RawRecipe = RawElement;

/** A per-reactor-type configuration block: `configuration["<configId>"]`. */
export interface RawConfiguration {
  /** e.g. `nuclearcraft:overhaul_sfr` */
  [listName: string]: RawValue | RawModules | RawElement[] | undefined;
  modules: RawModules;
}

/** The whole `<config>.ncpf.json` file. */
export interface RawProject {
  version: number;
  addons: RawElement[];
  modules: RawModules;
  configuration: { [configId: string]: RawConfiguration };
  designs: RawElement[];
}

/** Convenience: read a module bag off a raw object without losing type safety. */
export function rawModules(obj: { modules?: RawModules } | undefined): RawModules {
  return obj?.modules ?? {};
}

export function rawModule(
  obj: { modules?: RawModules } | undefined,
  name: string,
): RawModule | undefined {
  const m = obj?.modules?.[name];
  return m === undefined ? undefined : (m as RawModule);
}

export function rawNumber(m: RawModule | undefined, key: string, fallback = 0): number {
  const v = m?.[key];
  return typeof v === 'number' ? v : fallback;
}

export function rawBoolean(m: RawModule | undefined, key: string, fallback = false): boolean {
  const v = m?.[key];
  return typeof v === 'boolean' ? v : fallback;
}

export function rawString(m: RawModule | undefined, key: string, fallback = ''): string {
  const v = m?.[key];
  return typeof v === 'string' ? v : fallback;
}
