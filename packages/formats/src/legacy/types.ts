/**
 * R2 legacy-format reader contract.
 *
 * Every historical format (LegacyNCPF v1–v11, Hellrage SFR/MSR v1–v6, Hellrage
 * underhaul v1–v2, NCConfig `.cfg`) is read into **one** representation: the NCPF
 * JSON tree (`JsonObject`) that the frozen Java version would have written for
 * the same file. Everything downstream — `buildProjectDocument`, the
 * fingerprint, the kernel's design rebuild — then works unchanged, and the R2
 * acceptance test is a plain structural comparison against the goldens produced
 * by `tools/golden/format-golden.ps1`.
 *
 * Two rules, both from `docs/rewrite-plan-r1-r5.md`:
 *
 *  1. **Iron law 5 / R2.10**: import matching uses element *identity*
 *     (`legacyNames`, `name`+`metadata`), never a display name. The frozen Java
 *     readers that match on display names (`OverhaulHellrageSFR6Reader`,
 *     `UnderhaulHellrage2Reader`) fail on the shipped fixtures; TS must read
 *     those files successfully instead of reproducing the failure.
 *  2. **Never invent data.** A field that the Java reader does not set must stay
 *     absent: the R0 fingerprint folds in module *presence*, so an empty extra
 *     module changes the acceptance hash.
 */
import { isJsonObject, type JsonObject, type JsonValue } from '../json.js';

/** What a legacy reader produces: an NCPF JSON tree, ready for `buildProjectDocument`. */
export interface LegacyReadResult {
  /** The NCPF JSON tree (same shape as a `*.ncpf.json` save). */
  readonly raw: JsonObject;
  /** Non-fatal oddities (unknown blocks skipped, legacy-only fields dropped…). */
  readonly issues: readonly string[];
}

/**
 * A single historical format. `matches` mirrors Java `FormatReader.formatMatches`
 * (`false` means "not my format"); `read` returns `null` when the format turned
 * out not to match after all — exactly like `NCPFReader`, whose `formatMatches`
 * is always true and which defers by returning `null`.
 */
export interface LegacyFormatReader {
  /** Java class name, used in coverage tables and diagnostics. */
  readonly name: string;
  /** Lower number = tried earlier; mirrors `FileReader.formats` registration order. */
  readonly order: number;
  matches(input: LegacyInput): boolean;
  read(input: LegacyInput): LegacyReadResult | null;
}

/** Bytes plus the decoded text (some formats are text, some are binary). */
export interface LegacyInput {
  readonly bytes: Uint8Array;
  /** UTF-8 decoding of {@link bytes} — only meaningful for text formats. */
  readonly text: string;
  /** File name or `<string>`; used for diagnostics and metadata. */
  readonly container: string;
}

export function makeInput(bytes: Uint8Array, container = '<bytes>'): LegacyInput {
  return { bytes, text: new TextDecoder('utf-8').decode(bytes), container };
}

/** A malformed-file error the readers raise with a format-specific message. */
export class LegacyFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LegacyFormatError';
  }
}

// ---------------------------------------------------------------- NCPF builders

/**
 * NCPF JSON element skeleton. `modules` stays insertion-ordered, because the
 * fingerprint is order-insensitive but the converted-golden comparison is not:
 * `JSON.parse` preserves the file's key order, and the goldens are written by
 * Java's `LinkedHashMap`-like `NCPFObject`.
 */
export function element(type: string, name: string, modules: JsonObject = {}): JsonObject {
  return { name, type, modules };
}

/** `legacy_block` / `legacy_item` / `legacy_fluid`: `metadata` is omitted when 0. */
export function legacyElement(
  type: 'legacy_block' | 'legacy_item' | 'legacy_fluid',
  name: string,
  metadata: number,
  modules: JsonObject = {},
): JsonObject {
  const out: JsonObject = { name, type, modules };
  if (metadata !== 0) out.metadata = metadata;
  return out;
}

/** Deep clone that keeps key order (used when a reader copies template modules). */
export function cloneJson<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Java `NCPFElement.copyTo` semantics for a JSON element: a *deep* copy with the
 * module map preserved. Used by the legacy readers when a single block template
 * is emitted into several lists.
 */
export function copyElement(source: JsonObject): JsonObject {
  return cloneJson(source);
}

export function moduleOf(element: JsonObject, module: string): JsonObject | null {
  const modules = isJsonObject(element.modules) ? element.modules : null;
  const value = modules?.[module];
  return isJsonObject(value) ? value : null;
}

/** Sets a module, creating the module map when the element has none yet. */
export function setModule(element: JsonObject, module: string, value: JsonObject): void {
  if (!isJsonObject(element.modules)) element.modules = {};
  (element.modules as JsonObject)[module] = value;
}
