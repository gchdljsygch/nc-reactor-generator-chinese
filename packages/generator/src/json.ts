/**
 * The four JSON helpers the generator needs.
 *
 * `@ncplanner/formats` already exports equivalents, but it also pulls `node:fs`
 * and `node:crypto` into its module graph (the read layer), which would follow the
 * generator into the Web Worker bundle. The generator only ever consumes an
 * already-parsed JSON subtree, so it carries these instead. They are deliberately
 * the dumbest possible accessors: every generator-settings field is optional at
 * read time (R1's rule: TS tolerates what the frozen Java reader would throw on).
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

export interface JsonObject {
  [key: string]: JsonValue;
}

export function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function objectOf(value: unknown): JsonObject {
  return isJsonObject(value) ? value : {};
}

export function arrayOf(value: unknown): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

export function objectsOf(value: unknown): JsonObject[] {
  return arrayOf(value).filter(isJsonObject);
}

export function stringOf(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function numberOf(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function booleanOf(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function intArrayOf(value: unknown): number[] {
  return arrayOf(value).filter((v): v is number => typeof v === 'number').map((v) => Math.trunc(v));
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
