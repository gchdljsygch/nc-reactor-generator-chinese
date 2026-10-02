import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import {
  compareStats,
  readGoldenDataset,
  SFR_INTEGER_FIELDS,
  type GoldenRecord,
} from '@ncplanner/kernel';
import { readNcpfProject, type NcpfConfigurationDocument } from '@ncplanner/formats';
import type { NCPFElement } from '@ncplanner/ncpf';
import { AppDocument, createDesign, simulateDesign } from '@ncplanner/app';
import { createGrid, type GridState } from '@ncplanner/app';

/**
 * R3.5 + R3.8 — the integration that matters most: a design edited in the app's
 * grid model must produce **the golden statistics** when it is simulated.
 *
 * This is the strongest available check that the editor's coordinate system,
 * palette indices and recipe encoding line up with the file format and the
 * kernel: the golden datasets were produced by the frozen Java editor, and the
 * numbers only match if every one of those conventions is right.
 */

const ROOT = new URL('../../../', import.meta.url);
const CONFIG_PATH = fileURLToPath(new URL('src/configurations/nuclearcraft.ncpf.json', ROOT));
const DATASET_PATH = fileURLToPath(new URL('datasets/golden/sfr-cases.jsonl.gz', ROOT));

const project = readNcpfProject(CONFIG_PATH);
const documentView = new AppDocument(project);
const configuration = project.getConfiguration('nuclearcraft:overhaul_sfr');

const dataset = readGoldenDataset(DATASET_PATH);
const records = dataset.records.filter((record) => record.error === undefined).slice(0, 24);

const SFR = 'nuclearcraft:overhaul_sfr';

/** One `<config-id>:<name>` module of an element, or `null` when it has none. */
function sfrModule(
  modules: Record<string, unknown> | undefined,
  name: string,
): Record<string, unknown> | null {
  const value = modules?.[`${SFR}:${name}`];
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The module of a palette block, e.g. `nuclearcraft:overhaul_sfr:fuel_cell`. */
function blockModule(
  blocks: readonly NCPFElement[],
  index: number,
  name: string,
): Record<string, unknown> | null {
  return sfrModule(blocks[index]?.modules as Record<string, unknown> | undefined, name);
}

/** The `fuel_stats` module of one of a fuel cell's recipes. */
function fuelStats(
  configuration: NcpfConfigurationDocument,
  blocks: readonly NCPFElement[],
  blockIndex: number,
  recipeIndex: number,
): Record<string, unknown> {
  const recipe = configuration.recipesOf(blocks[blockIndex]!)[recipeIndex];
  return sfrModule(recipe?.modules as Record<string, unknown> | undefined, 'fuel_stats') ?? {};
}

/** Neutron flux a moderator contributes to a line between two fuel cells. */
function moderatorFlux(blocks: readonly NCPFElement[], index: number): number {
  const flux = blockModule(blocks, index, 'moderator')?.['flux'];
  return typeof flux === 'number' ? flux : 0;
}

/** Rebuild the editor grid for a golden record (identities/recipes → indices). */
function gridFromRecord(record: GoldenRecord): GridState {
  const view = documentView.view('nuclearcraft:overhaul_sfr');
  if (view === null) throw new Error('the shipped configuration has no overhaul SFR view');
  const [dx, dy, dz] = record.size;
  const grid = createGrid([dx, dy, dz]);
  const byIdentity = new Map(view.palette.map((entry) => [entry.identity, entry.index]));
  const skipped: string[] = [];
  for (let x = 0; x < dx; x++) {
    for (let y = 0; y < dy; y++) {
      for (let z = 0; z < dz; z++) {
        const idx = x * dy * dz + y * dz + z;
        const bi = record.grid[idx];
        if (bi === undefined || bi < 0) continue;
        const identity = record.blockNames[bi];
        const paletteIndex = identity === undefined ? undefined : byIdentity.get(identity);
        if (paletteIndex === undefined) {
          skipped.push(identity ?? '?');
          continue;
        }
        grid.blocks[x][y][z] = paletteIndex;
        const ri = record.recipes[idx];
        if (ri === undefined || ri < 0) continue;
        const key = record.recipeNames[ri];
        const name = key?.slice(key.indexOf('=') + 1);
        const entry = view.palette[paletteIndex];
        const recipe = entry?.recipes.find((candidate) => candidate.name === name);
        if (recipe !== undefined) grid.recipes[x][y][z] = recipe.index;
      }
    }
  }
  if (skipped.length > 0) throw new Error(`unresolved identities: ${[...new Set(skipped)].slice(0, 5).join(', ')}`);
  return grid;
}

describe('R3.8 statistics through the editor model', () => {
  it('the shipped configuration exposes an editable palette', () => {
    const view = documentView.view('nuclearcraft:overhaul_sfr');
    expect(view).not.toBeNull();
    expect(view!.palette.length).toBeGreaterThan(20);
    expect(view!.palette.some((entry) => entry.recipes.length > 0)).toBe(true);
  });

  it(`matches the golden editor statistics for ${records.length} dataset cases`, () => {
    const failures: string[] = [];
    for (const record of records) {
      const grid = gridFromRecord(record);
      const result = simulateDesign({
        project,
        configuration: configuration!,
        configId: 'nuclearcraft:overhaul_sfr',
        grid,
      });
      if (result.kind !== 'ok') {
        failures.push(`${record.id}: ${result.kind} ${result.kind === 'error' ? result.message : result.reason}`);
        continue;
      }
      expect(result.warnings).toEqual([]);
      const mismatches = compareStats(result.stats, record.editor, {
        relTolerance: 1e-5,
        integerFields: SFR_INTEGER_FIELDS,
      });
      if (mismatches.length > 0) {
        failures.push(
          `${record.id}: ${mismatches.slice(0, 3).map((m) => `${m.field} ${m.expected} != ${m.actual}`).join('; ')}`,
        );
      }
    }
    expect(failures).toEqual([]);
  });

  it('reports an unsupported configuration instead of guessing', () => {
    const result = simulateDesign({
      project,
      configuration: configuration!,
      configId: 'nuclearcraft:overhaul_distiller',
      grid: createGrid([5, 5, 5]),
    });
    expect(result.kind).toBe('unsupported');
  });

  it('an empty reactor simulates to finite, zero-output statistics', () => {
    const grid = createGrid([5, 5, 5]);
    const result = simulateDesign({
      project,
      configuration: configuration!,
      configId: 'nuclearcraft:overhaul_sfr',
      grid,
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.stats['totalOutput']).toBe(0);
    expect(result.stats['shutdownFactor']).toBe(0);
    for (const value of Object.values(result.stats)) expect(Number.isFinite(value)).toBe(true);
  });

  it('editing a cell changes the statistics (the editor is wired to the kernel)', () => {
    const view = documentView.view('nuclearcraft:overhaul_sfr')!;
    const blocks = configuration!.list('blocks');
    // A fuel cell is not "a block with recipes" — ports carry the cell's recipes
    // and irradiators carry their own — it is the block with the `fuel_cell`
    // module. Flux only travels along a moderator line, so the moderator with
    // the highest `flux` is what gets a two-cell reactor over the activation
    // threshold (the fuel's `criticality`), and a cell also has to be primed,
    // which is what makes the fuel a *self-priming* one.
    const fuelCell = view.palette.find(
      (entry) => blockModule(blocks, entry.index, 'fuel_cell') !== null,
    );
    const moderator = view.palette
      .filter((entry) => blockModule(blocks, entry.index, 'moderator') !== null)
      .sort((a, b) => moderatorFlux(blocks, b.index) - moderatorFlux(blocks, a.index))[0];
    const fuel = fuelCell?.recipes
      .map((recipe) => ({
        recipe,
        stats: fuelStats(configuration!, blocks, fuelCell.index, recipe.index),
      }))
      .filter(({ stats }) => stats['self_priming'] === true)
      .sort((a, b) => Number(a.stats['criticality']) - Number(b.stats['criticality']))[0];
    expect(fuelCell).toBeDefined();
    expect(moderator).toBeDefined();
    expect(fuel).toBeDefined();
    if (fuelCell === undefined || moderator === undefined || fuel === undefined) return;

    const emptyGrid = createGrid([5, 5, 5]);
    const grid = createGrid([5, 5, 5]);
    // A single fuel cell is inactive by construction: it receives no flux (flux
    // reaches a cell only through a moderator line) while its fuel has a
    // positive `criticality`. That is the frozen engine's behaviour, not an
    // app bug — of the 5000 golden designs, the 16 that place exactly one fuel
    // cell all report `totalFuelCells = 0`. So the edit places a minimal working
    // reactor: fuel cell – moderator – fuel cell along one interior line.
    grid.blocks[1][2][2] = fuelCell.index;
    grid.recipes[1][2][2] = fuel.recipe.index;
    grid.blocks[2][2][2] = moderator.index;
    grid.blocks[3][2][2] = fuelCell.index;
    grid.recipes[3][2][2] = fuel.recipe.index;

    const empty = simulateDesign({
      project,
      configuration: configuration!,
      configId: 'nuclearcraft:overhaul_sfr',
      grid: emptyGrid,
    });
    const edited = simulateDesign({
      project,
      configuration: configuration!,
      configId: 'nuclearcraft:overhaul_sfr',
      grid,
    });
    expect(empty.kind).toBe('ok');
    expect(edited.kind).toBe('ok');
    if (empty.kind !== 'ok' || edited.kind !== 'ok') return;
    expect(edited.stats['totalFuelCells']).toBeGreaterThan(empty.stats['totalFuelCells'] ?? 0);
  });
});

describe('R3.3 / R3.4 document model', () => {
  it('creates a design, edits it, saves it and reads it back', () => {
    const working = new AppDocument(readNcpfProject(CONFIG_PATH));
    const index = createDesign(working, 'nuclearcraft:overhaul_sfr', [7, 7, 7]);
    const grid = working.gridOf(index, 'nuclearcraft:overhaul_sfr');
    expect(grid).not.toBeNull();
    const view = working.view('nuclearcraft:overhaul_sfr')!;
    const block = view.palette.find((entry) => entry.recipes.length > 0)!;
    grid!.blocks[3][3][3] = block.index;
    grid!.recipes[3][3][3] = 0;
    working.applyGrid(index, 'nuclearcraft:overhaul_sfr', grid!);

    const saved = working.saveText();
    const reopened = new AppDocument(readNcpfProject(saved));
    const reopenedGrid = reopened.gridOf(index, 'nuclearcraft:overhaul_sfr');
    expect(reopenedGrid).not.toBeNull();
    expect(reopenedGrid!.dims).toEqual([7, 7, 7]);
    expect(reopenedGrid!.blocks[3][3][3]).toBe(block.index);
    expect(reopenedGrid!.recipes[3][3][3]).toBe(0);
  });

  it('exports a single design with the plannerator modules trimmed', () => {
    const working = new AppDocument(readNcpfProject(CONFIG_PATH));
    const index = createDesign(working, 'nuclearcraft:overhaul_sfr', [5, 5, 5]);
    const exported = working.exportText(index);
    expect(exported).toContain('"designs"');
    expect(exported).not.toContain('plannerator:display_name');
  });
});
