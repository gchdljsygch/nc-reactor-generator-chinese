import { describe, expect, it } from 'vitest';
import { R0_BASELINE } from './baseline.js';
import { moduleKeys, project, readText } from './helpers.js';
import { isJsonObject, type JsonObject } from '../src/json.js';
import { elementIdentity } from '../src/designs.js';
import { parseNcpfProject } from '../src/project.js';
import {
  assertDesignSelection,
  exportNcpfText,
  trimPlanneratorModules,
  writeNcpfExport,
} from '../src/write.js';

/**
 * R1.4c — write (export semantics): equivalent to Java's `NCPFWriter`
 * (`makePartial()` + `trimPlanneratorModules()`), which is **not** the save path
 * (R0 finding #10).
 *
 * The strongest check here is byte equality with the shipped export fixture:
 * `datasets/fixtures/usfr-ncpf-export.ncpf.json` was produced by the Java
 * `NCPFWriter`. Running the frozen Java writer over
 * `datasets/fixtures/usfr-ncpf-save.ncpf.json` reproduces that file byte for byte
 * (verified for this task, see `docs/r1/r1.4-ncpf-io.md`), so the TS export has a
 * frozen target rather than a self-consistency check.
 */
describe('R1.4c export: usfr fixture matches the Java writer byte for byte', () => {
  it('writeNcpfExport(usfr-ncpf-save) === usfr-ncpf-export.ncpf.json', () => {
    const document = project('datasets/fixtures/usfr-ncpf-save.ncpf.json');
    expect(exportNcpfText(document)).toBe(readText('datasets/fixtures/usfr-ncpf-export.ncpf.json'));
  });

  it('exporting the export fixture is idempotent', () => {
    const document = project('datasets/fixtures/usfr-ncpf-export.ncpf.json');
    expect(exportNcpfText(document)).toBe(readText('datasets/fixtures/usfr-ncpf-export.ncpf.json'));
  });
});

describe('R1.4c export: structure retained, plannerator:* stripped', () => {
  it('keeps only the design\'s configuration and its referenced elements', () => {
    const document = project('datasets/fixtures/usfr-ncpf-save.ncpf.json');
    const exported = writeNcpfExport(document);
    const configuration = exported.configuration as JsonObject;
    expect(Object.keys(configuration)).toEqual(['nuclearcraft:underhaul_sfr']);
    const underhaul = configuration['nuclearcraft:underhaul_sfr'] as JsonObject;
    const blocks = (underhaul.blocks as JsonObject[]).map((block) => elementIdentity(block));
    // 21 blocks -> the 4 the design references, in their original relative order
    expect(blocks).toEqual([
      'nuclearcraft:fission_controller_new_fixed',
      'nuclearcraft:reactor_casing_transparent',
      'nuclearcraft:cell_block',
      'blockFissionModerator',
    ]);
    expect((underhaul.fuels as JsonObject[]).map((fuel) => elementIdentity(fuel))).toEqual([
      'nuclearcraft:fuel_thorium:0',
    ]);
  });

  it('strips every non-`ncpf:` module key (recursively) and drops empty module bags', () => {
    // SFR keeps one `ncpf:block_recipes`; the underhaul export keeps no modules at all.
    const sfr = writeNcpfExport(project('datasets/fixtures/sfr-ncpf-save.ncpf.json'));
    const keys = moduleKeys(sfr);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((key) => key.startsWith('ncpf:'))).toBe(true);
    expect(keys).not.toContain('plannerator:display_name');
    expect(keys).not.toContain('plannerator:texture');
    expect(keys).not.toContain('plannerator:legacy_names');
    expect(keys).not.toContain('plannerator:global_elements');
    expect(keys).not.toContain('plannerator:configuration_metadata');
    expect(keys).not.toContain('plannerator:metadata');
    expect(keys.some((key) => key.startsWith('nuclearcraft:'))).toBe(false);

    const underhaul = writeNcpfExport(project('datasets/fixtures/usfr-ncpf-save.ncpf.json'));
    expect(moduleKeys(underhaul)).toEqual([]);
  });

  it('keeps `ncpf:block_recipes` and trims the recipes to the ones the design uses', () => {
    const document = project('datasets/fixtures/sfr-ncpf-save.ncpf.json');
    const original = document.getConfiguration('nuclearcraft:overhaul_sfr');
    expect(original).toBeDefined();
    const cell = original?.list('blocks').find((block) => elementIdentity(block) === 'nuclearcraft:solid_fission_cell');
    expect(cell?.modules['ncpf:block_recipes']).toBeDefined();
    const originalRecipeCount = (cell?.modules['ncpf:block_recipes'] as { recipes: unknown[] }).recipes.length;
    expect(originalRecipeCount).toBe(81);

    const exported = writeNcpfExport(document);
    const sfr = (exported.configuration as JsonObject)['nuclearcraft:overhaul_sfr'] as JsonObject;
    const blocks = sfr.blocks as JsonObject[];
    expect(blocks).toHaveLength(9);
    const withRecipes = blocks.filter((block) => isJsonObject(block.modules) && 'ncpf:block_recipes' in block.modules);
    expect(withRecipes).toHaveLength(1);
    const kept = (withRecipes[0].modules as JsonObject)['ncpf:block_recipes'] as JsonObject;
    const keptRecipes = kept.recipes as JsonObject[];
    expect(keptRecipes.length).toBeGreaterThan(0);
    expect(keptRecipes.length).toBeLessThan(originalRecipeCount);

    // The kept recipes are exactly the ones the design's `block_recipes` refers to.
    const design = document.designs[0];
    const usedRecipes = new Set<string>();
    for (const plane of design.grid?.recipes ?? []) {
      for (const row of plane) for (const recipe of row) if (recipe !== null) usedRecipes.add(elementIdentity(recipe));
    }
    expect(new Set(keptRecipes.map((recipe) => elementIdentity(recipe)))).toEqual(usedRecipes);

    // Every emitted recipe index must resolve inside the *written* recipe list
    // (a stale/unfiltered index here is exactly what the Java reader rejects with
    // `IndexOutOfBoundsException`, so assert it explicitly).
    const exportedDesign = (exported.designs as JsonObject[])[0];
    let indices = 0;
    for (const slice of exportedDesign.block_recipes as number[][][]) {
      for (const row of slice) {
        for (const index of row) {
          indices++;
          expect(index === -1 || (index >= 0 && index < keptRecipes.length)).toBe(true);
        }
      }
    }
    expect(indices).toBeGreaterThan(0);

    // ... and the whole export reads back with the same recipe identities.
    const again = parseNcpfProject(JSON.stringify(exported), document.container);
    expect(recipeIdentities(again.designs[0])).toEqual(recipeIdentities(design));

    // ... and the module keys of the whole export are ncpf:* only
    expect(moduleKeys(exported).every((key) => key.startsWith('ncpf:'))).toBe(true);
  });

  it('remaps the design references by element identity (SFR, with its broken coolant_recipe)', () => {
    const document = project('datasets/fixtures/sfr-ncpf-save.ncpf.json');
    const design = document.designs[0];
    const originalBlocks = design.grid?.blocks;
    const exported = writeNcpfExport(document);
    const exportedDesign = (exported.designs as JsonObject[])[0];
    const sfr = (exported.configuration as JsonObject)['nuclearcraft:overhaul_sfr'] as JsonObject;
    const blocks = sfr.blocks as JsonObject[];
    const grid = exportedDesign.design as number[][][];
    expect(grid.length).toBe(originalBlocks?.length);
    for (let x = 0; x < grid.length; x++) {
      for (let y = 0; y < grid[x].length; y++) {
        for (let z = 0; z < grid[x][y].length; z++) {
          const index = grid[x][y][z];
          const original = originalBlocks?.[x]?.[y]?.[z] ?? null;
          if (original === null) {
            // `-1` originally; a dangling index would have been normalized to -1 too
            expect(index === -1 || index === -1).toBe(true);
          } else {
            expect(elementIdentity(blocks[index])).toBe(elementIdentity(original));
          }
        }
      }
    }
    // The fixture itself carries Java's `matches()` bug (`coolant_recipe: -1`,
    // R0 finding #9): the reference was already lost when Java wrote the file, so
    // the export cannot invent it and correctly keeps -1 (`-1` is not reported as
    // a dangling index; out-of-range non-negative indices are).
    expect(exportedDesign.coolant_recipe).toBe(-1);
    expect(design.scalarReferences.get('coolant_recipe')?.element ?? null).toBeNull();
  });

  it('exports a design-less project to an empty configuration set (Java behavior)', () => {
    const document = project('src/configurations/internal.ncpf.json');
    const exported = writeNcpfExport(document);
    expect(exported.configuration).toEqual({});
    expect(exported.designs).toEqual([]);
    expect(exported.addons).toEqual([]);
    // `plannerator:metadata` was the only top-level module -> the key disappears
    expect('modules' in exported).toBe(false);
  });

  it('all 38 shipped configurations have no designs, so all 38 export empty (as in Java)', () => {
    let empty = 0;
    for (const entry of R0_BASELINE) {
      const exported = writeNcpfExport(project(entry.path));
      if (
        JSON.stringify(exported.configuration) === '{}' &&
        Array.isArray(exported.designs) &&
        exported.designs.length === 0 &&
        Array.isArray(exported.addons) &&
        exported.addons.length === 0
      ) {
        empty++;
      }
    }
    expect(empty).toBe(38);
  });

  it('selects designs by index or by type and rejects a selector that matches nothing', () => {
    const document = project('datasets/fixtures/usfr-ncpf-save.ncpf.json');
    expect(writeNcpfExport(document, [0])).toEqual(writeNcpfExport(document));
    expect(writeNcpfExport(document, ['nuclearcraft:underhaul_sfr'])).toEqual(writeNcpfExport(document));
    expect(() => assertDesignSelection(document, ['nuclearcraft:overhaul_msr'])).toThrow(/matched no design/);
    expect(() => writeNcpfExport(document, [7])).not.toThrow();
    expect((writeNcpfExport(document, [7]).configuration as JsonObject)).toEqual({});
  });

  it('trimPlanneratorModules removes the `modules` key when nothing is left', () => {
    const node: JsonObject = { a: { modules: { 'plannerator:x': { v: 1 }, 'ncpf:keep': {} } } };
    trimPlanneratorModules(node);
    expect(node).toEqual({ a: { modules: { 'ncpf:keep': {} } } });
    const empty: JsonObject = { modules: { 'nuclearcraft:overhaul_sfr:moderator': {} } };
    trimPlanneratorModules(empty);
    expect(empty).toEqual({});
  });
});

/** Per-cell recipe identities of a design (what the compressed grid points at). */
function recipeIdentities(design: { grid: { recipes: ({ definition: { identity: string } } | null)[][][] } | null }): unknown {
  return design.grid?.recipes.map((plane) =>
    plane.map((row) => row.map((cell) => (cell === null ? null : cell.definition.identity))),
  );
}
