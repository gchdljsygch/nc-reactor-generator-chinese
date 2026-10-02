import { describe, expect, it } from 'vitest';
import { R0_BASELINE } from './baseline.js';
import { countDisplayNames, countElements, project } from './helpers.js';
import { fingerprintLines } from '../src/fingerprint.js';

/**
 * R1.4a — read: the TS reader must be equivalent to Java's `NCPFFileReader`.
 *
 * Acceptance (`docs/rewrite-plan-r1-r5.md` §4.5 R1.4a): all 38 production
 * configurations read in, **fingerprint identical to `docs/r0/format-roundtrip.md`**.
 *
 * The doc records the per-file element/display counts and the "38/38" verdict; the
 * fingerprint values in `baseline.ts` were captured from the frozen Java
 * implementation itself (same algorithm, same corpus) because the doc does not
 * list them.
 */
describe('R1.4a read: 38 production configurations', () => {
  it('baseline self-check: the Java run reproduced the R0 doc counts', () => {
    expect(R0_BASELINE).toHaveLength(38);
    for (const entry of R0_BASELINE) {
      expect(entry.elements, `${entry.path} elements`).toBe(entry.docElements);
      expect(entry.displays, `${entry.path} displays`).toBe(entry.docDisplays);
      expect(entry.fingerprint).toMatch(/^[0-9a-f]{24}#\d+$/);
    }
  });

  for (const entry of R0_BASELINE) {
    describe(entry.path, () => {
      it('reads and matches the Java fingerprint', () => {
        const document = project(entry.path);
        expect(document.fingerprint()).toBe(entry.fingerprint);
        // the fingerprint's own line count is part of the value
        expect(document.fingerprint().split('#')[1]).toBe(String(entry.fingerprint.split('#')[1]));
      });

      it('matches the Java element and display-name counts', () => {
        const document = project(entry.path);
        expect(countElements(document), 'countElements').toBe(entry.elements);
        expect(countDisplayNames(document), 'countDisplayNames').toBe(entry.displays);
        const lines = fingerprintLines(document);
        expect(lines.filter((line) => line.startsWith('el|')).length + lines.filter((line) => line.startsWith('ael|')).length).toBe(
          entry.elements,
        );
      });
    });
  }

  it('keeps unknown modules and unknown fields verbatim', () => {
    // `datasets/configurations/internal.ncpf.json` ships "settings only" elements with
    // no `type` at all (Java reads them as UnknownNCPFElement) — the strongest
    // available probe that nothing is normalized away on read.
    const document = project('datasets/configurations/internal.ncpf.json');
    expect(document.issues).toEqual([]);
    const sfr = document.getConfiguration('nuclearcraft:overhaul_sfr');
    expect(sfr).toBeDefined();
    const block = sfr?.raw.blocks;
    expect(Array.isArray(block)).toBe(true);
    const first = (block as { type?: unknown }[])[0];
    expect(first.type).toBeUndefined();
    // The ncpf logic view still sees a `null` element type, like Java.
    expect(sfr?.list('blocks')[0]?.definition.type).toBeUndefined();
  });
});
