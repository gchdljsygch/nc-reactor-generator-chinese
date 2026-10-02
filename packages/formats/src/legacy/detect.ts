/**
 * R2 — the reader chain: "given a file a user dropped on the app, what is it?"
 *
 * Java's `FileReader.read` walks `FileReader.formats` in registration order and
 * takes the first reader whose `formatMatches` is true **and** whose `read()`
 * returns non-null. `NCPFReader` is registered first and always "matches", so it
 * deliberately returns `null` for anything that is not NCPF JSON, letting the
 * legacy readers have their turn (see `docs/r0/compat-contract.md` §6).
 *
 * This module reproduces that protocol, but with the order made explicit rather
 * than depending on import side effects:
 *
 *  1. NCPF JSON (`parseNcpfProject`), which is a *pure* JSON check — the same
 *     deferral rule applies, a parse failure moves on instead of throwing;
 *  2. every registered {@link LegacyFormatReader}, sorted by `order`.
 *
 * Adding a format is `registerLegacyReader(...)`; `legacy/index.ts` does it for
 * every ported reader so the app never has to know which formats exist.
 */

import { parseNcpfProject, NcpfFormatError, type NcpfProjectDocument } from '../project.js';
import { isJsonObject, type JsonObject } from '../json.js';
import { makeInput, type LegacyFormatReader, type LegacyInput, type LegacyReadResult } from './types.js';

export interface ReadOutcome {
  /** Which reader produced the project (`NCPFReader` for NCPF JSON). */
  readonly reader: string;
  readonly document: NcpfProjectDocument;
  /** Non-fatal notes from the reader (unknown blocks, dropped legacy fields…). */
  readonly issues: readonly string[];
  /**
   * The NCPF JSON tree the reader produced, before `buildProjectDocument`.
   *
   * For NCPF JSON input this is the parsed file; for a legacy format it is the
   * *converted* tree, which is what the R2 acceptance tests compare against the
   * goldens (`datasets/converted/ncpf/*`).
   */
  readonly raw: JsonObject;
}

const readers: LegacyFormatReader[] = [];

/**
 * Register a format. Sorted by `order` so registration order in `legacy/index.ts`
 * cannot change which reader wins — the R0 coverage tables depend on that order
 * being stable.
 */
export function registerLegacyReader(reader: LegacyFormatReader): void {
  const existing = readers.findIndex((candidate) => candidate.name === reader.name);
  if (existing >= 0) readers.splice(existing, 1);
  readers.push(reader);
  readers.sort((a, b) => a.order - b.order);
}

export function registeredReaders(): readonly LegacyFormatReader[] {
  return [...readers];
}

/** True when `text` is NCPF JSON: an object with an integer `version`. */
export function isNcpfJson(text: string): boolean {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('{')) return false;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isJsonObject(parsed) && typeof parsed['version'] === 'number';
  } catch {
    return false;
  }
}

export interface ReadOptions {
  /** Skip the legacy chain (used by tests that want to prove NCPF parsing only). */
  readonly ncpfOnly?: boolean;
}

/**
 * Read any supported file. Throws {@link NcpfFormatError} when nothing matches —
 * the same contract Java has (`IllegalArgumentException: Unknown file format!`),
 * but with the list of readers that were tried.
 */
export function readAnyProjectText(
  text: string,
  container = '<string>',
  options: ReadOptions = {},
): ReadOutcome {
  const bytes = new TextEncoder().encode(text);
  return readAnyProjectBytes(bytes, container, { ...options, text });
}

export function readAnyProjectBytes(
  bytes: Uint8Array,
  container = '<bytes>',
  options: ReadOptions & { text?: string } = {},
): ReadOutcome {
  const text = options.text ?? new TextDecoder('utf-8').decode(bytes);

  // 1) NCPF JSON — the catch-all that defers on failure.
  if (isNcpfJson(text)) {
    const parsed: unknown = JSON.parse(text);
    if (!isJsonObject(parsed)) throw new NcpfFormatError(`${container}: NCPF JSON is not an object`);
    const document = parseNcpfProject(text, container);
    return { reader: 'NCPFReader', document, issues: document.issues, raw: parsed };
  }

  if (options.ncpfOnly === true) {
    throw new NcpfFormatError(`${container}: not NCPF JSON (legacy readers disabled for this call)`);
  }

  // 2) the legacy chain, in the order the frozen version registered it.
  const input = makeInput(bytes, container);
  const tried: string[] = [];
  for (const reader of readers) {
    tried.push(reader.name);
    if (!reader.matches(input)) continue;
    const result: LegacyReadResult | null = reader.read(input);
    if (result === null) continue;
    const document = parseNcpfProject(JSON.stringify(result.raw), container);
    return { reader: reader.name, document, issues: [...result.issues, ...document.issues], raw: result.raw };
  }

  throw new NcpfFormatError(
    `${container}: unknown file format (tried NCPFReader${tried.length > 0 ? `, ${tried.join(', ')}` : ''})`,
  );
}

/** Filesystem convenience for tools and tests. */
export function readAnyProjectBytesSync(bytes: Uint8Array, container: string): ReadOutcome {
  return readAnyProjectBytes(bytes, container);
}

export type { LegacyInput, LegacyFormatReader };
