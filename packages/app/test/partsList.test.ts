/**
 * R3.6 — the parts list, checked against the frozen Java editor's own data.
 *
 * The plan's acceptance for R3.6 is "清单与 Java 版一致" (the parts list agrees with
 * the Java version). The golden datasets were produced by the frozen Java editor,
 * so each record carries the design's `blockNames` and its flattened `grid` and
 * `recipes` arrays **exactly as Java wrote them**; the counts below are
 * re-derived from that data and compared with what the app's UI would list.
 *
 * That makes this test independent of the app's grid in the direction that
 * matters: a wrong interior bound, a transposed `x`/`z` mapping or an accidental
 * count of the implicit casing changes the numbers or the totals, and all three
 * are invisible to a "the list is non-empty" assertion.
 *
 * The app has exactly one parts-count implementation (`model/grid.partsCounts`),
 * shared by the panel and the PNG export.
 */
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readGoldenDataset, type GoldenRecord } from '@ncplanner/kernel';
import { readNcpfProject } from '@ncplanner/formats';
import { AppDocument, createGrid, partsCounts, type GridState } from '@ncplanner/app';

const ROOT = new URL('../../../', import.meta.url);
const CONFIG_PATH = fileURLToPath(new URL('datasets/configurations/nuclearcraft.ncpf.json', ROOT));
const DATASET_PATH = fileURLToPath(new URL('datasets/golden/sfr-cases.jsonl.gz', ROOT));

const project = readNcpfProject(CONFIG_PATH);
const documentView = new AppDocument(project);
const SFR = 'nuclearcraft:overhaul_sfr';

const records: readonly GoldenRecord[] = readGoldenDataset(DATASET_PATH).records
  .filter((record) => record.error === undefined)
  .slice(0, 24);

/** The editor grid for a golden record (identities → palette indices). */
function gridFromRecord(record: GoldenRecord): GridState {
  const view = documentView.view(SFR);
  if (view === null) throw new Error('the shipped configuration has no overhaul SFR view');
  const [dx, dy, dz] = record.size;
  const grid = createGrid([dx, dy, dz]);
  const byIdentity = new Map(view.palette.map((entry) => [entry.identity, entry.index]));
  for (let x = 0; x < dx; x++) {
    for (let y = 0; y < dy; y++) {
      for (let z = 0; z < dz; z++) {
        const idx = x * dy * dz + y * dz + z;
        const blockIndex = record.grid[idx];
        if (blockIndex === undefined || blockIndex < 0) continue;
        const identity = record.blockNames[blockIndex];
        const paletteIndex = identity === undefined ? undefined : byIdentity.get(identity);
        if (paletteIndex === undefined) throw new Error(`unresolved identity ${identity ?? '?'}`);
        grid.blocks[x][y][z] = paletteIndex;
      }
    }
  }
  return grid;
}

/**
 * Java's `grid` flattened the same way the dataset does, counted with the
 * **interior** rule (`1 .. dim-2`, the casing ring is implicit in the format and
 * never stored). This walk uses the golden's own arrays and index space.
 */
function goldenParts(record: GoldenRecord): Map<string, number> {
  const [dx, dy, dz] = record.size;
  const counts = new Map<string, number>();
  for (let x = 1; x <= dx - 2; x++) {
    for (let y = 1; y <= dy - 2; y++) {
      for (let z = 1; z <= dz - 2; z++) {
        const idx = x * dy * dz + y * dz + z;
        const blockIndex = record.grid[idx];
        if (blockIndex === undefined || blockIndex < 0) continue;
        const identity = record.blockNames[blockIndex] ?? `#${blockIndex}`;
        counts.set(identity, (counts.get(identity) ?? 0) + 1);
      }
    }
  }
  return counts;
}

/** Same, keyed by the app's palette index instead of the golden's identity. */
function appParts(grid: GridState, record: GoldenRecord): Map<string, number> {
  const view = documentView.view(SFR);
  if (view === null) throw new Error('no view');
  const out = new Map<string, number>();
  for (const [index, count] of partsCounts(grid)) {
    out.set(view.palette[index]?.identity ?? `#${index}`, count);
  }
  return out;
}

describe('R3.6 parts list', () => {
  it('covers 24 golden designs', () => {
    expect(records.length).toBe(24);
  });

  it.each(records.map((record) => [record.id, record] as const))(
    'matches the golden block counts for %s',
    (_id, record) => {
      const grid = gridFromRecord(record);
      const expected = goldenParts(record);
      const produced = appParts(grid, record);
      expect([...produced.entries()].sort()).toEqual([...expected.entries()].sort());
    },
  );

  it.each(records.map((record) => [record.id, record] as const))(
    'counts every interior cell once and never the stored casing ring (%s)',
    (_id, record) => {
      const grid = gridFromRecord(record);
      const [dx, dy, dz] = record.size;

      // Re-derive the invariant from the golden's own arrays.
      let interiorNonAir = 0;
      let allNonAir = 0;
      for (let x = 0; x < dx; x++) {
        for (let y = 0; y < dy; y++) {
          for (let z = 0; z < dz; z++) {
            const blockIndex = record.grid[x * dy * dz + y * dz + z];
            if (blockIndex === undefined || blockIndex < 0) continue;
            allNonAir++;
            if (x === 0 || y === 0 || z === 0 || x === dx - 1 || y === dy - 1 || z === dz - 1) continue;
            interiorNonAir++;
          }
        }
      }

      let total = 0;
      for (const count of partsCounts(grid).values()) total += count;

      expect(total).toBe(interiorNonAir);
      expect(total).toBeLessThanOrEqual((dx - 2) * (dy - 2) * (dz - 2));
      // The file stores the casing ring as real palette indices, but the format
      // treats it as implicit: Java's `getPartsList()` never lists it, and
      // neither may the app, or every design would be off by its whole shell.
      if (allNonAir > interiorNonAir) expect(total).toBeLessThan(allNonAir);
    },
  );
});
