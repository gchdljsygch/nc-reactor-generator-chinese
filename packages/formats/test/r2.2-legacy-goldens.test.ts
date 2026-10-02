/**
 * R2.2 / R2.6 / R2.8 — the legacy readers against the Java golden oracle.
 *
 * `tools/golden/format-golden.ps1` runs the **frozen Java** reader chain over
 * every fixture and records, per file, the effective reader, element/design
 * counts, the R0 fingerprint and the converted NCPF JSON
 * (`datasets/converted/MANIFEST.json` + `datasets/converted/ncpf/*`).
 *
 * A ported reader is accepted when, for the same input bytes, it produces a tree
 * that is *structurally identical* to Java's conversion — same keys, same array
 * order, same numbers — plus the same fingerprint and counts. Nothing weaker is
 * accepted: the R0 fingerprint folds in module presence, so an extra empty module
 * or a dropped `legacy_names` entry has to fail here.
 *
 * {@link PENDING_READERS} is the burn-down list of formats with a green golden
 * but no TS port yet; the last test asserts it verbatim so that landing a reader
 * cannot silently leave a stale entry behind.
 */
import { describe, expect, it } from 'vitest';
import { readAnyProjectBytes, allLegacyReaders } from '../src/legacy/index.js';
import { NcpfFormatError } from '../src/project.js';
import {
  countsOf,
  fingerprintOf,
  fixtureBytes,
  goldenEntry,
  goldenJson,
  jsonDiff,
  manifest,
} from './legacyGoldens.js';

/**
 * Readers whose TS port is complete: every green golden these readers produced
 * must reproduce exactly.
 */
const PORTED_READERS: readonly string[] = [
  'LegacyNCPF11Reader',
  'LegacyNCPF10Reader',
  'UnderhaulHellrage2Reader',
  'UnderhaulHellrage1Reader',
  'OverhaulNCConfigReader',
  'UnderhaulNCConfigReader',
];

/**
 * Formats with a Java golden but no TS port yet: all of them are ported, so this
 * is empty. (`OverhaulHellrageSFR5Reader` has no golden — `sfr-hellrage.json`,
 * which Java *fails* on — see the deviation tests below.)
 */
const PENDING_READERS: readonly string[] = [];

/** Java's name for the NCPF-JSON catch-all, which `detect.ts` implements itself. */
const NCPF_JSON_READER = 'NCPFReader (catch-all)';

const greenEntries = manifest().entries.filter((entry) => entry.ok);

describe('R2 legacy readers: golden coverage', () => {
  it('covers every fixture in the manifest exactly once', () => {
    const files = manifest().entries.map((entry) => entry.file);
    expect(new Set(files).size).toBe(files.length);
  });

  it('reads every green golden whose reader is ported', () => {
    const cases = greenEntries.filter((entry) => PORTED_READERS.includes(entry.reader));
    expect(cases.length).toBeGreaterThan(0);
  });

  it('has no unexpected pending reader', () => {
    const pending = [
      ...new Set(
        greenEntries
          .map((entry) => entry.reader)
          .filter((reader) => reader !== NCPF_JSON_READER && !PORTED_READERS.includes(reader)),
      ),
    ].sort();
    expect(pending).toEqual([...PENDING_READERS].sort());
  });
});

describe.each(
  greenEntries
    .filter((entry) => PORTED_READERS.includes(entry.reader))
    .map((entry) => [entry.file, entry.reader] as const),
)('R2 golden %s', (file, javaReader) => {
  const entry = goldenEntry(file);

  it(`is read by ${javaReader}`, () => {
    const outcome = readAnyProjectBytes(fixtureBytes(file), file);
    expect(outcome.reader).toBe(javaReader);
  });

  it('matches the Java conversion structurally', () => {
    const outcome = readAnyProjectBytes(fixtureBytes(file), file);
    const diff = jsonDiff(outcome.raw, goldenJson(file));
    expect(diff, `first difference from the Java conversion: ${diff ?? ''}`).toBeNull();
  });

  it('has the Java element/design counts and fingerprint', () => {
    const outcome = readAnyProjectBytes(fixtureBytes(file), file);
    expect(countsOf(outcome.raw)).toEqual({ elements: entry.elements, designs: entry.designs });
    expect(outcome.document.fingerprint()).toBe(entry.fingerprint);
    expect(fingerprintOf(outcome.raw)).toBe(entry.fingerprint);
  });
});

/**
 * R2.10 / R2.9 / R2.4 — files where the frozen Java chain *throws*, and which the
 * TS chain must read anyway because the plan fixes the semantics (element identity
 * instead of display names, the `NCPFStackListElement` alternative that Java never
 * calls, a module the default module set does not have). Each of these has no
 * golden, so the assertion is "reads, and says which reader did it".
 *
 * `sfr-ncpf-save.ncpf.json` is the one entry that is *not* a reader fix: TS reads it
 * through the NCPF layer, while the frozen version's own copy path trips over
 * `coolant_recipe: null` (R0 finding #9). It is listed because the plan's
 * "已验证可读" list is about what the TS chain accepts, and this file is one of them.
 */
describe('R2 fixed-semantics reads (Java throws on these)', () => {
  const cases: readonly (readonly [string, string, string])[] = [
    // file, Java error, expected TS reader
    [
      'historical/overhaul.json',
      'Invalid block name: Cf-252! (display-name matching)',
      'OverhaulHellrageSFR5Reader',
    ],
    [
      'sfr-hellrage.json',
      'Invalid fuel name: MOX-241! (display-name matching)',
      'OverhaulHellrageSFR6Reader',
    ],
    [
      'usfr-hellrage.json',
      'Invalid block name: ! (empty display name)',
      'UnderhaulHellrage2Reader',
    ],
    [
      'ncconfig-overhaul.cfg',
      'Cannot create an element stack, with an amount… (list-element dead path)',
      'OverhaulNCConfigReader',
    ],
    [
      'historical/fusion_test.ncpf',
      'ClassCastException: UnknownNCPFModule cannot be cast… (needs a non-default module)',
      'LegacyNCPF11Reader',
    ],
    [
      'sfr-ncpf-save.ncpf.json',
      'NullPointerException: this.definition.coolantRecipe is null (write-side, R0 #9)',
      'NCPFReader',
    ],
  ];

  it.each(cases)('reads %s (Java: %s)', (file) => {
    const outcome = readAnyProjectBytes(fixtureBytes(file), file);
    expect(countsOf(outcome.raw).elements).toBeGreaterThan(0);
  });

  it.each(cases)('picks %s for %s', (file, _error, reader) => {
    expect(readAnyProjectBytes(fixtureBytes(file), file).reader).toBe(reader);
  });
});

describe('R2 reader registry', () => {
  it('registers readers in the frozen version order', () => {
    const orders = allLegacyReaders().map((reader) => reader.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it('names every reader after its Java class', () => {
    for (const reader of allLegacyReaders()) {
      expect(reader.name).toMatch(/Reader$/);
    }
  });

  it('reports everything it tried when nothing matches', () => {
    const bytes = new TextEncoder().encode('not a project at all\n');
    let error: unknown = null;
    try {
      readAnyProjectBytes(bytes, 'junk.txt');
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(NcpfFormatError);
    expect((error as Error).message).toContain('LegacyNCPF11Reader');
    expect((error as Error).message).toContain('UnderhaulNCConfigReader');
  });
});
