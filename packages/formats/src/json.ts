/**
 * The JSON tree type this package works on.
 *
 * `@ncplanner/ncpf` models the same tree with `RawValue`/`RawElement`/
 * `RawModules`, but those types are mutually recursive through *optional*
 * properties (`RawElement.modules?` is `RawModules`, not `RawValue`), which
 * TypeScript refuses to unify with a plain JSON type. Since a save must preserve
 * *arbitrary* unknown fields verbatim, the formats layer walks the tree as plain
 * JSON and only converts to ncpf element views at the edges
 * (`makeElement(raw as unknown as RawElement)`).
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

export interface JsonObject {
  [key: string]: JsonValue;
}

export function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isJsonArray(value: unknown): value is JsonValue[] {
  return Array.isArray(value);
}

export function jsonArray(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

export function jsonObjects(value: JsonValue | undefined): JsonObject[] {
  return jsonArray(value).filter(isJsonObject);
}

export function jsonString(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function jsonNumber(value: JsonValue | undefined): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

export function deepCloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
