import type { RawElement, RawModules, RawValue } from './raw.js';
import { rawModules } from './raw.js';

/**
 * Element definitions.
 *
 * A `NCPFElement` is a `definition` (what it *is*: a legacy block, an oredict
 * entry, …) plus a bag of modules (what it *does*: moderator, heatsink, …).
 *
 * Two identities matter and must never be confused:
 *
 *  - `identity` — language independent, injective, used for logic, matching and
 *    dataset keys. Mirrors Java's `NCPFElementDefinition.toString()`. The R0
 *    finding is that Java's `getName()` is **not** injective (both
 *    `nuclearcraft:fission_reflector` variants share a name while having
 *    different reflectivity), so `identity` is what the kernel keys on.
 *  - `displayName` — from the `plannerator:display_name` module, English in the
 *    configuration files; localized by the i18n layer, never used for logic.
 */
export interface NCPFElementDefinition {
  /** Discriminator from the wire format, e.g. `legacy_block`. */
  readonly type: string;
  /** Java `NCPFElementDefinition.getName()`; **not** injective. */
  readonly name: string;
  /** Java `NCPFElementDefinition.toString()`; injective for shipped configs. */
  readonly identity: string;
  /** Legacy names (import compatibility). */
  readonly legacyNames: readonly string[];
  /** The raw definition object, for code that needs a field we do not model. */
  readonly raw: RawElement;
}

export interface NCPFElement {
  readonly definition: NCPFElementDefinition;
  readonly modules: RawModules;
  /** `plannerator:display_name.display_name`, falling back to `definition.name`. */
  readonly displayName: string;
  /** Canonical display name: never localized. */
  readonly canonicalName: string;
  /** All names this element can be matched by when importing. */
  readonly legacyNames: readonly string[];
  readonly raw: RawElement;
}

const DISPLAY_NAME_MODULE = 'plannerator:display_name';
const LEGACY_NAMES_MODULE = 'plannerator:legacy_names';

function sortedBlockstate(state: { [k: string]: RawValue }): string {
  const keys = Object.keys(state).sort();
  if (keys.length === 0) return '';
  return `[${keys.map((k) => `${k}=${String(state[k])}`).join(',')}]`;
}

function asRecord(v: RawValue | undefined): { [k: string]: RawValue } {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as { [k: string]: RawValue })
    : {};
}

function asStringArray(v: RawValue | undefined): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * Compute the language-independent identity of a raw element definition.
 *
 * Mirrors the Java definitions in `net.ncplanner.plannerator.ncpf.element`:
 * `legacy_block` → `name[:metadata][blockstate][nbt]`,
 * `legacy_item` → `name[:metadata][nbt]`, `oredict` → the oredict string,
 * `legacy_fluid` → the fluid name, `legacy_recipe` → `[in]->[out]`.
 */
export function definitionIdentity(raw: RawElement): string {
  switch (raw.type) {
    case 'legacy_block': {
      const name = typeof raw.name === 'string' ? raw.name : '';
      const metadata = typeof raw.metadata === 'number' ? `:${raw.metadata}` : '';
      const state = sortedBlockstate(asRecord(raw.blockstate as RawValue | undefined));
      const nbt = typeof raw.nbt === 'string' ? raw.nbt : '';
      return `${name}${metadata}${state}${nbt}`;
    }
    case 'legacy_item': {
      const name = typeof raw.name === 'string' ? raw.name : '';
      const metadata = typeof raw.metadata === 'number' ? `:${raw.metadata}` : '';
      const nbt = typeof raw.nbt === 'string' ? raw.nbt : '';
      return `${name}${metadata}${nbt}`;
    }
    case 'oredict':
      return typeof raw.oredict === 'string' ? raw.oredict : '';
    case 'legacy_fluid':
    case 'fluid':
      return typeof raw.name === 'string' ? raw.name : '';
    case 'legacy_recipe': {
      const inputs = asStringArrayOfStacks(raw.inputs);
      const outputs = asStringArrayOfStacks(raw.outputs);
      return `[${inputs.join(', ')}]->[${outputs.join(', ')}]`;
    }
    case 'list': {
      const elements = Array.isArray(raw.elements) ? (raw.elements as RawElement[]) : [];
      return elements.map((e) => definitionIdentity(e)).join(', ');
    }
    default:
      return typeof raw.name === 'string'
        ? raw.name
        : typeof raw.oredict === 'string'
          ? raw.oredict
          : raw.type;
  }
}

function asStringArrayOfStacks(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((stack) => stackToString(stack));
}

/**
 * Java `NCPFElementStack.toString()`: the element definition followed by
 * `*<amount>` when the definition can carry an amount (`list` definitions
 * cannot — `NCPFListElement.canHaveAmount()` / `NCPFStackListElement`).
 */
export function stackToString(stack: unknown): string {
  if (stack === null || typeof stack !== 'object' || Array.isArray(stack)) return String(stack);
  const s = stack as RawElement;
  const base = definitionName(s);
  if (s.type === 'list') {
    const elements = Array.isArray(s.elements) ? (s.elements as RawElement[]) : [];
    return elements.map((e) => stackToString(e)).join(', ');
  }
  const amount = typeof s.amount === 'number' ? s.amount : 1;
  return `${base}*${amount}`;
}

/** Java `getName()` — the *lossy* name. Kept only where the Java behaviour is observable. */
export function definitionName(raw: RawElement): string {
  switch (raw.type) {
    case 'legacy_block':
    case 'legacy_item':
    case 'legacy_fluid':
    case 'fluid':
      return typeof raw.name === 'string' ? raw.name : '';
    case 'oredict':
      return typeof raw.oredict === 'string' ? raw.oredict : '';
    case 'legacy_recipe':
      return definitionIdentity(raw);
    case 'list': {
      const elements = Array.isArray(raw.elements) ? (raw.elements as RawElement[]) : [];
      return elements.map((e) => definitionIdentity(e)).join(', ');
    }
    default:
      return typeof raw.name === 'string' ? raw.name : definitionIdentity(raw);
  }
}

/** Definition-level legacy names (Java `NCPFElementDefinition.getLegacyNames()`). */
export function definitionLegacyNames(raw: RawElement): string[] {
  const identity = definitionIdentity(raw);
  const names = [identity];
  if (raw.type === 'legacy_block' || raw.type === 'legacy_item') {
    const name = typeof raw.name === 'string' ? raw.name : '';
    if (typeof raw.metadata === 'number') names.push(`${name}:${raw.metadata}`);
  }
  return names;
}

export function makeElementDefinition(raw: RawElement): NCPFElementDefinition {
  return {
    type: raw.type,
    name: definitionName(raw),
    identity: definitionIdentity(raw),
    legacyNames: definitionLegacyNames(raw),
    raw,
  };
}

export function makeElement(raw: RawElement): NCPFElement {
  const definition = makeElementDefinition(raw);
  const modules = rawModules(raw);
  const displayModule = modules[DISPLAY_NAME_MODULE] as { display_name?: string } | undefined;
  const display = displayModule?.display_name;
  const canonicalName =
    typeof display === 'string' && display.length > 0 ? display : definition.name;
  const legacyModule = modules[LEGACY_NAMES_MODULE] as { legacy_names?: RawValue } | undefined;
  const legacyNames = [
    canonicalName,
    ...definition.legacyNames,
    ...asStringArray(legacyModule?.legacy_names),
  ];
  return {
    definition,
    modules,
    displayName: canonicalName,
    canonicalName,
    legacyNames,
    raw,
  };
}

/**
 * Find an element by any of its names (canonical, definition identity, legacy
 * names). This is the import-compatibility path: it must keep working when the
 * display name gets localized, which is why it never compares `displayName`
 * alone.
 */
export function findElementByName(
  elements: readonly NCPFElement[],
  name: string,
): NCPFElement | undefined {
  for (const e of elements) if (e.legacyNames.includes(name)) return e;
  return undefined;
}

/** Find an element by its exact, language-independent identity. */
export function findElementByIdentity(
  elements: readonly NCPFElement[],
  identity: string,
): NCPFElement | undefined {
  for (const e of elements) if (e.definition.identity === identity) return e;
  return undefined;
}
