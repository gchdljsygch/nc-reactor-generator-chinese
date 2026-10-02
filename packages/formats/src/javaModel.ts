import { isJsonObject, jsonArray, jsonString, type JsonObject, type JsonValue } from './json.js';

/**
 * Exact ports of the Java *format-level* identity functions.
 *
 * Why this file exists at all, when `@ncplanner/ncpf` already has
 * `definitionIdentity` / `definitionName`:
 *
 *  - the R0 fingerprint (`docs/r0/format-roundtrip.md`, implemented in
 *    `tools/golden/src/.../RoundTrip.java`) is defined as
 *    `element.definition.type + "|" + element.definition.toString() + "|" + element.getDisplayName()`,
 *    i.e. it is a *byte-for-byte* function of Java's `toString()`/`getName()`
 *    implementations. Any semantic difference — even one that is harmless for
 *    the editor — changes the fingerprint and breaks the R0 baseline;
 *  - `@ncplanner/ncpf`'s helpers deliberately differ from Java in places that
 *    are irrelevant for logic but observable here:
 *      * `legacy_recipe` inputs/outputs are a `HashSet` in Java, so Java sorts
 *        (and string-deduplicates) them before joining; `ncpf` keeps JSON order;
 *      * an element whose `type` is not a registered element type becomes
 *        `UnknownNCPFElement` in Java, whose `type` is `null` and whose
 *        `getName()` is the literal string `"null"`; `ncpf` echoes the raw
 *        (unregistered) type string;
 *      * `NCPFElementStack.toString()` appends `*<amount>` only when the
 *        definition `canHaveAmount()` (false only for `list`).
 *
 * So this module is the *frozen-format* view, and `ncpf` remains the *logic*
 * view. Both are needed; do not merge them (see `docs/r1/r1.4-ncpf-io.md`).
 *
 * Java references (`src/net/ncplanner/plannerator/ncpf/...`):
 *  - `NCPFElementDefinition.toString()` / `getName()`
 *  - `NCPFBlockElement` / `NCPFBlockTagElement` / `NCPFItemElement` /
 *    `NCPFItemTagElement` / `NCPFLegacyBlockElement` / `NCPFLegacyItemElement`
 *    (the `toString()` overrides)
 *  - `NCPFLegacyRecipeElement.getName()` (sorted `HashSet` inputs/outputs)
 *  - `NCPFSettingsElement.stringifyBlockstate(...)`
 *  - `NCPFElementStack.toString()` / `canHaveAmount()`
 *  - `NCPFElement.getDisplayName()`
 *  - `NCPFElement.recognizedElements` (decides whether a `type` string resolves
 *    to a real definition or to `UnknownNCPFElement`)
 */

/**
 * Element definition types registered through `@RegisterWith`, i.e. what
 * `NCPFElement.recognizedElements` contains for the default module set.
 *
 * `stack_list` is intentionally absent: `NCPFStackListElement` is created
 * programmatically (`NCPFListElement.getRecipeContainedAlternative()`) and is
 * never registered under its own `type` — it shares `"list"` with
 * `NCPFListElement`. `unknown` is absent too: an unregistered type never
 * produces a registered definition.
 */
export const REGISTERED_ELEMENT_TYPES: readonly string[] = [
  'block',
  'block_tag',
  'fluid',
  'fluid_tag',
  'item',
  'item_tag',
  'legacy_block',
  'legacy_fluid',
  'legacy_item',
  'legacy_recipe',
  'list',
  'module',
  'oredict',
  'recipe',
];

const REGISTERED = new Set(REGISTERED_ELEMENT_TYPES);

export function isRegisteredElementType(type: unknown): type is string {
  return typeof type === 'string' && REGISTERED.has(type);
}

/**
 * Java `NCPFElementDefinition.type` **as observed after loading**: `null` for an
 * unregistered (or missing) `type`, because the reader falls back to
 * `UnknownNCPFElement`.
 */
export function javaElementType(raw: JsonObject | undefined): string | null {
  return raw !== undefined && isRegisteredElementType(raw.type) ? raw.type : null;
}

function stringField(raw: JsonObject, key: string): string {
  return jsonString(raw[key]) ?? '';
}

function nbtSuffix(raw: JsonObject): string {
  return jsonString(raw.nbt) ?? '';
}

/** Java `NCPFSettingsElement.stringifyBlockstate(...)`. */
export function javaBlockstateString(state: JsonObject): string {
  const keys = Object.keys(state).sort();
  if (keys.length === 0) return '';
  // Java concatenates `Object.toString()` of each value; `String(v)` matches for
  // the JSON scalars that can appear here (string / boolean / number).
  return `[${keys.map((key) => `${key}=${String(state[key])}`).join(',')}]`;
}

function blockstateSuffix(raw: JsonObject): string {
  const state = raw.blockstate;
  return isJsonObject(state) ? javaBlockstateString(state) : '';
}

function metadataSuffix(raw: JsonObject): string {
  const metadata = raw.metadata;
  return typeof metadata === 'number' ? `:${metadata}` : '';
}

/**
 * Java `NCPFElementDefinition.getName()` — note this is *not* `toString()`:
 * several subclasses append blockstate/metadata/NBT in `toString()` only.
 */
export function javaDefinitionName(raw: JsonObject): string | null {
  switch (javaElementType(raw)) {
    case 'legacy_recipe': {
      // NCPFLegacyRecipeElement.getName(): inputs/outputs are HashSets, so the
      // rendered stacks are sorted and string-duplicates collapse.
      const inputs = uniqueSorted(jsonArray(raw.inputs).map((stack) => javaStackToString(stack)));
      const outputs = uniqueSorted(jsonArray(raw.outputs).map((stack) => javaStackToString(stack)));
      return `[${inputs.join(', ')}]->[${outputs.join(', ')}]`;
    }
    case 'list':
      // NCPFListElement.getName() (definitions, not stacks): JSON order, no amounts.
      return jsonArray(raw.elements)
        .map((element) => (isJsonObject(element) ? javaDefinitionToString(element) : String(element)))
        .join(', ');
    case 'oredict':
      return stringField(raw, 'oredict');
    case 'block':
    case 'block_tag':
    case 'item':
    case 'item_tag':
    case 'fluid':
    case 'fluid_tag':
    case 'legacy_block':
    case 'legacy_item':
    case 'legacy_fluid':
    case 'recipe':
    case 'module':
      return stringField(raw, 'name');
    default:
      // UnknownNCPFElement.getName() returns the literal string "null".
      return 'null';
  }
}

/** Java `NCPFElementDefinition.toString()` including the subclass overrides. */
export function javaDefinitionToString(raw: JsonObject): string {
  switch (javaElementType(raw)) {
    case 'block':
    case 'block_tag':
      return `${stringField(raw, 'name')}${blockstateSuffix(raw)}${nbtSuffix(raw)}`;
    case 'legacy_block':
      return `${stringField(raw, 'name')}${metadataSuffix(raw)}${blockstateSuffix(raw)}${nbtSuffix(raw)}`;
    case 'item':
    case 'item_tag':
      return `${stringField(raw, 'name')}${nbtSuffix(raw)}`;
    case 'legacy_item':
      return `${stringField(raw, 'name')}${metadataSuffix(raw)}${nbtSuffix(raw)}`;
    default: {
      const name = javaDefinitionName(raw);
      return name === null ? 'null' : name;
    }
  }
}

/**
 * Java `NCPFElementStack.toString()`:
 * `definition.canHaveAmount() ? definition + "*" + amount : definition`.
 * Only `list` definitions cannot carry an amount.
 */
export function javaStackToString(stack: JsonValue | undefined): string {
  if (!isJsonObject(stack)) return String(stack);
  if (javaElementType(stack) === 'list') {
    // NCPFStackListElement.getName(): children are stacks, joined in order.
    return jsonArray(stack.elements).map((child) => javaStackToString(child)).join(', ');
  }
  const amount = typeof stack.amount === 'number' ? stack.amount : 1;
  return `${javaDefinitionToString(stack)}*${amount}`;
}

/**
 * Java `NCPFElement.getDisplayName()`:
 * `plannerator:display_name.display_name` when present, else
 * `definition.getName()` — note **`getName()`, not `toString()`**: for a
 * `legacy_block` the fallback drops metadata/blockstate/NBT.
 */
export function javaElementDisplayName(raw: JsonObject): string {
  const modules = raw.modules;
  const display = isJsonObject(modules) ? modules['plannerator:display_name'] : undefined;
  const name = isJsonObject(display) ? jsonString(display.display_name) : undefined;
  if (name !== undefined) return name;
  const definitionName = javaDefinitionName(raw);
  return definitionName === null ? 'null' : definitionName;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
