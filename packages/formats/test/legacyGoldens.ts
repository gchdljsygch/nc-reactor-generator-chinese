import { readFileSync } from 'node:fs';
import { parseNcpfProject } from '../src/project.js';
import { isJsonObject, type JsonObject } from '../src/json.js';
import { countElements } from './helpers.js';

/**
 * R2 golden oracle.
 *
 * `tools/golden/format-golden.ps1` runs the **frozen Java** reader chain over
 * every fixture under `datasets/fixtures` and records, per file, the effective
 * reader, element/design counts, the R0 structural fingerprint and the
 * **converted NCPF JSON** (`datasets/converted/ncpf/<fixture>.ncpf.json`).
 *
 * The TS legacy readers are tested against that oracle on two levels:
 *
 *  1. {@link expectGoldenMatch} — the produced tree must be structurally equal
 *     to the Java conversion (order-insensitive JSON equality), and its
 *     fingerprint (through the R1 read layer) must equal Java's;
 *  2. {@link goldenEntry} — counts and effective reader name, so a reader that
 *     silently drops or invents elements fails loudly even when the fingerprint
 *     happens to agree.
 */

export interface GoldenEntry {
  readonly file: string;
  readonly reader: string;
  readonly ok: boolean;
  readonly elements?: number;
  readonly designs?: number;
  readonly fingerprint?: string;
  readonly converted?: string;
  readonly error?: string;
}

interface Manifest {
  readonly root: string;
  readonly entries: readonly GoldenEntry[];
  readonly summary: { ok: number; failed: number; skipped: number };
}

export const GOLDEN_ROOT = 'datasets/converted';

let manifestCache: Manifest | null = null;

export function manifest(): Manifest {
  if (manifestCache === null) {
    manifestCache = JSON.parse(readFileSync(`${GOLDEN_ROOT}/MANIFEST.json`, 'utf8')) as Manifest;
  }
  return manifestCache;
}

export function goldenEntry(file: string): GoldenEntry {
  const entry = manifest().entries.find((candidate) => candidate.file === file);
  if (entry === undefined) throw new Error(`no golden entry for "${file}" (run tools/golden/format-golden.ps1)`);
  return entry;
}

/** The Java-converted NCPF JSON for a fixture. */
export function goldenJson(file: string): JsonObject {
  const entry = goldenEntry(file);
  if (entry.converted === undefined) throw new Error(`fixture "${file}" has no conversion (${entry.error})`);
  const parsed: unknown = JSON.parse(readFileSync(`${GOLDEN_ROOT}/${entry.converted}`, 'utf8'));
  if (!isJsonObject(parsed)) throw new Error(`golden ${entry.converted} is not a JSON object`);
  return parsed;
}

export function fixturePath(file: string): string {
  return `${manifest().root}/${file}`;
}

export function fixtureBytes(file: string): Uint8Array {
  return readFileSync(fixturePath(file));
}

/** Order-insensitive deep copy: object keys sorted, arrays kept in order. */
export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = canonical(source[key]);
    return out;
  }
  return value;
}

/**
 * First structural difference between two JSON trees, as a JSON-path string, or
 * `null` when they are equal. Vitest's `toEqual` prints whole trees, which is
 * unusable on a 270 KB conversion — a path plus both values is what makes a
 * failing port debuggable.
 */
export function jsonDiff(a: unknown, b: unknown, path = '$'): string | null {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return `${path}: array vs ${typeof b}`;
    if (a.length !== b.length) return `${path}: length ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const diff = jsonDiff(a[i], b[i], `${path}[${i}]`);
      if (diff !== null) return diff;
    }
    return null;
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const key of keys) {
      if (!(key in left)) return `${path}.${key}: missing in produced (golden has ${short(right[key])})`;
      if (!(key in right)) return `${path}.${key}: extra in produced (${short(left[key])})`;
      const diff = jsonDiff(left[key], right[key], `${path}.${key}`);
      if (diff !== null) return diff;
    }
    return null;
  }
  if (typeof a === 'number' && typeof b === 'number' && Object.is(a, b)) return null;
  if (a === b) return null;
  return `${path}: ${short(a)} vs ${short(b)}`;
}

function short(value: unknown): string {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

/**
 * Fingerprint of a produced tree, through the same R1 layer the app uses
 * (`buildProjectDocument` + the R0 fingerprint function).
 */
export function fingerprintOf(raw: JsonObject): string {
  return parseNcpfProject(JSON.stringify(raw)).fingerprint();
}

/**
 * Counts of a produced tree, in Java's `RoundTrip.countElements` sense (main
 * configurations + addons, over `getAllElementsISaidAllElements()`).
 */
export function countsOf(raw: JsonObject): { elements: number; designs: number } {
  const document = parseNcpfProject(JSON.stringify(raw));
  return { elements: countElements(document), designs: document.designs.length };
}
