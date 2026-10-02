/**
 * R2.3 / R2.4 — the **LegacyNCPF v9 → v1** reader chain.
 *
 * `docs/rewrite-plan-r1-r5.md` §5 (R2.3/R2.4) ports `LegacyNCPF9Reader` … 
 * `LegacyNCPF1Reader` on top of the already-ported v11/v10 readers. Nine fixtures
 * in `datasets/converted/MANIFEST.json` name one of these readers as the Java
 * chain's choice, and **every one of them has `ok: false`**: the frozen reader
 * throws before it can write a conversion, so there is no golden JSON and no
 * golden fingerprint to compare against. What is asserted here instead is
 *
 *  1. the reader *choice* — `readAnyProjectBytes` must pick exactly the reader the
 *     manifest names (v1 ×4, v2 ×2, v5 ×2, v8 ×1);
 *  2. a non-degenerate, self-consistent tree — the R1 layer
 *     (`buildProjectDocument`) must accept it, the R0 fingerprint must compute,
 *     and the element count must match the count this port is documented to
 *     produce (Java never produced one, so it is a regression guard rather than
 *     an oracle);
 *  3. the negative control — `matches()` must be `true` for the fixture's own
 *     version and `false` for **every other** NCPF version, over *every* fixture
 *     in the manifest (not just these nine), so a reader cannot widen its claim;
 *  4. the documented deviations — the null-`configuration.settings` crash Java
 *     hits on all nine files must be reported as a non-fatal `issues` entry.
 *
 * ## Cross-check oracle
 *
 * `historical/po3.ncpf` (v10) and `historical/po3-v5.ncpf` (v5) are the *same*
 * modpack configuration in two encodings. The v10 golden is therefore an
 * independent oracle for the parts of the v9 loaders that v10 and v9 share: the
 * configuration key, the configuration metadata, the `underhaul_sfr` settings
 * values and the merged active cooler (one block, fifteen `ncpf:block_recipes`
 * recipes, in file order). The last tests below compare the two trees on exactly
 * those points — and pin the places where v9 *must* differ (no
 * `plannerator:legacy_names`, no fusion configuration).
 *
 * ## What cannot be verified
 *
 * NCPF **v3, v4, v6, v7 and v9** have no fixture at all, and none of the nine
 * fixtures contains a single design (`count: 0`), so every `readMultiblock`
 * override of the chain — v9's `size`-based layout, v7/v2/v1's id ranges — is
 * exercised only by construction, never by data. Those methods are line-by-line
 * ports of the frozen readers (see the deviation notes in `ncpf09.ts`), and the
 * design paths that *can* run (v9's, reached by the v1/v2/v5 fixtures if they had
 * designs) throw the same `LegacyFormatError` Java's
 * `ArrayIndexOutOfBoundsException` corresponds to rather than inventing a layout.
 */
import { describe, expect, it } from 'vitest';
import { allLegacyReaders, readAnyProjectBytes } from '../src/legacy/index.js';
import { makeInput } from '../src/legacy/types.js';
import { buildProjectDocument, parseNcpfProject } from '../src/project.js';
import { countsOf, fingerprintOf, fixtureBytes, goldenEntry, goldenJson, manifest } from './legacyGoldens.js';

/** `LegacyNCPF<N>Reader`, i.e. the readers this task ports. */
const CHAIN_READER = /^LegacyNCPF(\d+)Reader$/;

/** The nine fixtures whose Java reader is part of the v9 → v1 chain. */
const chainEntries = manifest().entries.filter((entry) => {
  const match = CHAIN_READER.exec(entry.reader);
  return match !== null && Number(match[1]) <= 9;
});

/** Every reader of the chain plus the two older NCPF readers, from one registry. */
const ncpfReaders = allLegacyReaders()
  .filter((reader) => CHAIN_READER.test(reader.name))
  .map((reader) => ({ version: Number(CHAIN_READER.exec(reader.name)![1]), reader }));

/** The v9 → v1 readers only, in registration order. */
const chainReaders = ncpfReaders.filter((entry) => entry.version <= 9);

/**
 * Element counts this port produces, per fixture. Java throws on all nine
 * (see the manifest's `error` fields), so these are **not** golden values: they
 * are the self-consistency contract of the port — the shape the deviations in
 * `ncpf09.ts` are documented to produce (settings module created, absent lists
 * read as empty, active coolers merged).
 */
const MEASURED: Readonly<Record<string, number>> = {
  'historical/asdf.ncpf': 207,
  'historical/e2e-v1.ncpf': 86,
  'historical/po3-v1.ncpf': 86,
  'historical/e2e-v2.ncpf': 90,
  'historical/po3-v2.ncpf': 89,
  'historical/e2e-v5.ncpf': 90,
  'historical/po3-v5.ncpf': 89,
  'historical/fusion_test-v8.ncpf': 17,
  'historical/qwerty.ncpf': 211,
};

describe('R2.3 LegacyNCPF v9 → v1 chain: coverage', () => {
  it('covers exactly the nine v1…v8 fixtures Java fails on', () => {
    expect(chainEntries).toHaveLength(9);
    expect(chainEntries.map((entry) => entry.file).sort()).toEqual([
      'historical/asdf.ncpf',
      'historical/e2e-v1.ncpf',
      'historical/e2e-v2.ncpf',
      'historical/e2e-v5.ncpf',
      'historical/fusion_test-v8.ncpf',
      'historical/po3-v1.ncpf',
      'historical/po3-v2.ncpf',
      'historical/po3-v5.ncpf',
      'historical/qwerty.ncpf',
    ]);
    for (const entry of chainEntries) expect(entry.ok, `${entry.file} now has a golden`).toBe(false);
  });

  it('registers the whole chain, one reader per version, in order', () => {
    expect(ncpfReaders.map((chain) => chain.version)).toEqual([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(ncpfReaders.map((chain) => chain.reader.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    // R2.3 itself: the nine new files sit between v10 and the Hellrage readers.
    expect(chainReaders.map((chain) => chain.reader.name)).toEqual([
      'LegacyNCPF9Reader',
      'LegacyNCPF8Reader',
      'LegacyNCPF7Reader',
      'LegacyNCPF6Reader',
      'LegacyNCPF5Reader',
      'LegacyNCPF4Reader',
      'LegacyNCPF3Reader',
      'LegacyNCPF2Reader',
      'LegacyNCPF1Reader',
    ]);
  });
});

describe.each(chainEntries.map((entry) => [entry.file, entry.reader] as const))(
  'R2.3 %s',
  (file, javaReader) => {
    const entry = goldenEntry(file);

    it(`is read by ${javaReader}, not by any other reader`, () => {
      const outcome = readAnyProjectBytes(fixtureBytes(file), file);
      expect(outcome.reader).toBe(entry.reader);
    });

    it('produces a tree the R1 layer and the fingerprint accept', () => {
      const outcome = readAnyProjectBytes(fixtureBytes(file), file);
      const counts = countsOf(outcome.raw);
      expect(counts.designs).toBe(0); // every fixture has `count: 0`
      expect(counts.elements).toBe(MEASURED[file]);
      expect(counts.elements).toBeGreaterThan(0);

      // The R1 read layer, called on the produced tree directly (what the app
      // does after `readAnyProjectBytes`) …
      const document = buildProjectDocument(outcome.raw, file);
      expect(document.fingerprint()).toBe(fingerprintOf(outcome.raw));
      expect(outcome.document.fingerprint()).toBe(document.fingerprint());
      // … and the same tree through the JSON entry point, for good measure.
      expect(parseNcpfProject(JSON.stringify(outcome.raw), file).fingerprint()).toBe(document.fingerprint());
    });

    it('reports the null-settings crash as a non-fatal issue', () => {
      const outcome = readAnyProjectBytes(fixtureBytes(file), file);
      // Deviation 1 in `ncpf09.ts`: Java's `configuration.settings` is null and
      // every fixture dies on the first assignment. The port creates the module.
      expect(outcome.issues.some((issue) => issue.includes('configuration.settings'))).toBe(true);
      expect(outcome.issues.some((issue) => issue.includes('_configuration_settings'))).toBe(true);
    });

    it('is deterministic across reads', () => {
      const first = readAnyProjectBytes(fixtureBytes(file), file);
      const second = readAnyProjectBytes(fixtureBytes(file), file);
      expect(second.reader).toBe(first.reader);
      expect(fingerprintOf(second.raw)).toBe(fingerprintOf(first.raw));
      expect(second.issues).toEqual(first.issues);
    });
  },
);

describe('R2.3 negative control: matches()', () => {
  const allEntries = manifest().entries;

  it('claims its own version and no other, over every fixture', () => {
    for (const entry of allEntries) {
      const input = makeInput(fixtureBytes(entry.file), entry.file);
      for (const { version, reader } of ncpfReaders) {
        // The manifest records which reader the frozen chain picked, and that is
        // the only NCPF version byte a reader may claim: a reader that accepts a
        // different version would steal the file from its own reader.
        const expected = entry.reader === reader.name;
        expect(
          reader.matches(input),
          `${entry.file}: v${version} ${reader.name} ${expected ? 'rejected' : 'claimed'} it`,
        ).toBe(expected);
      }
    }
  });

  it('rejects every fixture with a version byte it was not built for', () => {
    // The other direction, stated directly: for each of the nine chain fixtures,
    // the byte in the header is the fixture's own version and nothing else.
    for (const entry of chainEntries) {
      const input = makeInput(fixtureBytes(entry.file), entry.file);
      const claimed = ncpfReaders.filter(({ reader }) => reader.matches(input)).map(({ version }) => version);
      expect(claimed, `${entry.file} claimed by v${claimed.join(', v')}`).toEqual([
        Number(CHAIN_READER.exec(entry.reader)![1]),
      ]);
    }
  });
});

/**
 * The v10/v5 pair is the same modpack in two encodings, so the v10 golden pins
 * the shared half of the v9 loaders. Elements that only the *file* can differ on
 * (block names, fuel counts) are not compared.
 */
describe('R2.3 cross-check: v5 against the v10 golden of the same modpack', () => {
  const underhaul = 'nuclearcraft:underhaul_sfr';

  const v9 = readAnyProjectBytes(fixtureBytes('historical/po3-v5.ncpf'), 'historical/po3-v5.ncpf').raw;
  const v10 = goldenJson('historical/po3.ncpf');

  function configOf(raw: typeof v9): Record<string, unknown> {
    return (raw['configuration'] as Record<string, unknown>)[underhaul] as Record<string, unknown>;
  }

  it('loads the same configuration with the same metadata', () => {
    expect(Object.keys(v9['configuration'] as object)).toEqual(Object.keys(v10['configuration'] as object));
    expect(Object.keys(configOf(v9)['modules'] as object)).toEqual(Object.keys(configOf(v10)['modules'] as object));
  });

  it('agrees with v10 on every underhaul setting', () => {
    const settings = 'nuclearcraft:underhaul_sfr_configuration_settings';
    expect((configOf(v9)['modules'] as Record<string, unknown>)[settings]).toEqual(
      (configOf(v10)['modules'] as Record<string, unknown>)[settings],
    );
  });

  it('merges the active coolers exactly like v10, minus the v10-only modules', () => {
    const blocksOf = (raw: typeof v9): Record<string, unknown>[] => configOf(raw)['blocks'] as Record<string, unknown>[];
    const isActiveCooler = (block: Record<string, unknown>): boolean =>
      (block['modules'] as Record<string, unknown>)[`${underhaul}:active_cooler`] !== undefined;

    const v9Coolers = blocksOf(v9).filter(isActiveCooler);
    const v10Coolers = blocksOf(v10).filter(isActiveCooler);
    expect(v9Coolers).toHaveLength(1);
    expect(v10Coolers).toHaveLength(1);

    const recipesOf = (block: Record<string, unknown>): Record<string, unknown>[] =>
      ((block['modules'] as Record<string, unknown>)['ncpf:block_recipes'] as Record<string, unknown>)[
        'recipes'
      ] as Record<string, unknown>[];
    expect(recipesOf(v9Coolers[0]!).map((recipe) => recipe['name'])).toEqual(
      recipesOf(v10Coolers[0]!).map((recipe) => recipe['name']),
    );

    // v9 has no display names or legacy names of its own (`LegacyNCPF9Reader.java`),
    // so those modules are present-but-empty here, and `plannerator:legacy_names`
    // — which the v10 loader fills from the file — is absent entirely.
    const v9Modules = v9Coolers[0]!['modules'] as Record<string, unknown>;
    expect(v9Modules['plannerator:display_name']).toEqual({});
    expect(v9Modules['plannerator:texture']).toEqual({});
    expect(v9Modules['plannerator:legacy_names']).toBeUndefined();
  });

  it('never loads a fusion configuration (v9 has none)', () => {
    expect(Object.keys(v9['configuration'] as object)).not.toContain('plannerator:fusion_test');
  });
});

describe('R2.3 chain: fixture/reader table', () => {
  it('reads all nine and reports what came out', () => {
    const rows = chainEntries.map((entry) => {
      const outcome = readAnyProjectBytes(fixtureBytes(entry.file), entry.file);
      const counts = countsOf(outcome.raw);
      return `${entry.file} -> ${outcome.reader} elements=${counts.elements} designs=${counts.designs} issues=${outcome.issues.length}`;
    });
    for (const row of rows) console.log(row);
    for (const entry of chainEntries) {
      const outcome = readAnyProjectBytes(fixtureBytes(entry.file), entry.file);
      for (const issue of outcome.issues) console.log(`  ${entry.file}: ${issue}`);
    }
    expect(rows).toHaveLength(9);
  });
});
