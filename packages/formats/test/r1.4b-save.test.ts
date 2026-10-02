import { describe, expect, it } from 'vitest';
import { R0_BASELINE } from './baseline.js';
import { project, readText } from './helpers.js';
import { parseNcpfProject } from '../src/project.js';
import { saveNcpfText, writeNcpfSave } from '../src/write.js';

/**
 * R1.4b — write (save semantics): equivalent to Java's `NCPFFileWriter`.
 *
 * Acceptance (`docs/rewrite-plan-r1-r5.md` §4.5 R1.4b): write → read must yield
 * the same fingerprint, for all 38 configurations. Java measured **38/38** for
 * this path (`docs/r0/format-roundtrip.md`).
 *
 * TS additionally asserts *verbatim* fidelity: because the writer re-serializes
 * the parsed JSON tree (`write.ts`), an unmodified project must survive write →
 * read byte-for-byte, which is stronger than Java's object-model round trip.
 */
describe('R1.4b save: write → read fingerprint equality (38 configurations)', () => {
  for (const entry of R0_BASELINE) {
    it(`${entry.path} round-trips`, () => {
      const document = project(entry.path);
      const text = saveNcpfText(document);
      const again = parseNcpfProject(text, document.container);
      expect(again.fingerprint()).toBe(entry.fingerprint);
      expect(again.fingerprint()).toBe(document.fingerprint());
      // verbatim fidelity: nothing is dropped, reordered or normalized
      expect(JSON.parse(text)).toEqual(document.toJson());
      expect(writeNcpfSave(document)).toEqual(document.toJson());
    });
  }

  it('38/38 are fingerprinted the same before and after the write', () => {
    let ok = 0;
    for (const entry of R0_BASELINE) {
      const document = project(entry.path);
      const again = parseNcpfProject(saveNcpfText(document), document.container);
      if (again.fingerprint() === document.fingerprint() && document.fingerprint() === entry.fingerprint) ok++;
    }
    expect(ok).toBe(38);
  });
});

describe('R1.4b save: fixtures with designs round-trip', () => {
  const FIXTURES = [
    'datasets/fixtures/usfr-ncpf-save.ncpf.json',
    'datasets/fixtures/sfr-ncpf-save.ncpf.json',
    'datasets/fixtures/usfr-ncpf-export.ncpf.json',
  ] as const;

  for (const path of FIXTURES) {
    it(`${path} is reproduced verbatim`, () => {
      const document = project(path);
      const original = JSON.parse(readText(path));
      expect(document.designs).toHaveLength(1);
      // The design element references are re-indexed from identities, so the
      // output must still be identical to the input for an untouched project.
      expect(JSON.parse(saveNcpfText(document))).toEqual(original);
      const again = parseNcpfProject(saveNcpfText(document), document.container);
      expect(again.fingerprint()).toBe(document.fingerprint());
      // designs resolved identically (block grid + recipe grid + scalar refs)
      expect(designSignature(again)).toEqual(designSignature(document));
    });
  }
});

/** Per-cell element identities of a project's designs (order-stable). */
function designSignature(document: ReturnType<typeof project>): unknown {
  return document.designs.map((design) => ({
    type: design.type,
    dimensions: design.dimensions,
    blocks: design.grid?.blocks.map((plane) => plane.map((row) => row.map((cell) => cell?.definition.identity ?? null))),
    recipes: design.grid?.recipes.map((plane) => plane.map((row) => row.map((cell) => cell?.definition.identity ?? null))),
    scalars: [...design.scalarReferences.values()].map((reference) => [
      reference.key,
      reference.element?.definition.identity ?? null,
    ]),
  }));
}
