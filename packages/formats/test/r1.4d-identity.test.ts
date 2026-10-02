import { describe, expect, it } from 'vitest';
import { project, readText } from './helpers.js';
import { elementIdentity } from '../src/designs.js';
import type { JsonObject } from '../src/json.js';
import { parseNcpfProject } from '../src/project.js';
import { saveNcpfText, writeNcpfSave } from '../src/write.js';

/**
 * R1.4d — element reference semantics.
 *
 * R0 finding #9: Java writes design references with
 * `NCPFObject.setIndex` → `indexof` → `NCPFElementDefinition.matches`, and
 * `NCPFSettingsElement.matches()` is **not reflexive** for `legacy_recipe`
 * elements (`docs/r0/findings.md` §8.2: `sfr.coolantRecipe.definition.matches(itself) == false`).
 * A saved Overhaul SFR project therefore contains `"coolant_recipe": -1` and
 * cannot be read back (NPE), which is why
 * `datasets/fixtures/sfr-ncpf-save.ncpf.json` never round-tripped in R0.
 *
 * TS never uses that path: references are stored by element identity and only
 * converted to an index when writing (`designs.ts`), so:
 *  - the fixture reads without loss of information beyond what the file already
 *    lost (the `-1` was produced by Java before TS ever saw the file);
 *  - write → read preserves every reference that *is* present in the file;
 *  - a reference to a `legacy_recipe` (the exact Java failure case) is written
 *    as a real index instead of `-1`.
 */
describe('R1.4d element references: identity instead of matches()', () => {
  const SFR_SAVE = 'datasets/fixtures/sfr-ncpf-save.ncpf.json';

  it('reads the broken fixture without throwing and reports its -1 coolant recipe', () => {
    const document = project(SFR_SAVE);
    expect(document.designs).toHaveLength(1);
    const reference = document.designs[0].scalarReferences.get('coolant_recipe');
    expect(reference).toBeDefined();
    expect(reference?.element).toBeNull();
    expect(document.designs[0].raw.coolant_recipe).toBe(-1);
    // every block/recipe index that is present resolves
    expect(document.issues).toEqual([]);
    const recipes = document.getConfiguration('nuclearcraft:overhaul_sfr')?.list('coolant_recipes') ?? [];
    expect(recipes).toHaveLength(2);
    expect(recipes.map((recipe) => elementIdentity(recipe)).every((identity) => identity.startsWith('['))).toBe(true);
  });

  it('save keeps every design index that the file already had (no new losses)', () => {
    const document = project(SFR_SAVE);
    const saved = writeNcpfSave(document);
    const original = JSON.parse(readText(SFR_SAVE)) as JsonObject;
    const originalDesign = (original.designs as JsonObject[])[0];
    const savedDesign = (saved.designs as JsonObject[])[0];
    expect(savedDesign.design).toEqual(originalDesign.design);
    expect(savedDesign.block_recipes).toEqual(originalDesign.block_recipes);
    expect(savedDesign.coolant_recipe).toBe(-1);
    // and re-reading resolves the very same element identities
    const again = parseNcpfProject(saveNcpfText(document), document.container);
    expect(designIdentities(again.designs[0])).toEqual(designIdentities(document.designs[0]));
  });

  it('writes a legacy_recipe reference as a real index where Java writes -1', () => {
    const document = project(SFR_SAVE);
    const configuration = document.getConfiguration('nuclearcraft:overhaul_sfr');
    expect(configuration).toBeDefined();
    const coolantRecipe = configuration?.list('coolant_recipes')[0];
    expect(coolantRecipe).toBeDefined();
    // The exact shape Java's `Set` branch fails on: a legacy_recipe with inputs/outputs.
    expect(coolantRecipe?.definition.type).toBe('legacy_recipe');
    const module = coolantRecipe?.modules['nuclearcraft:overhaul_sfr:coolant_recipe_stats'] as JsonObject;
    expect(Object.keys(module).length).toBeGreaterThan(0);

    // Assign the reference by identity, then save: the index must be 0, not -1.
    const reference = document.designs[0].scalarReferences.get('coolant_recipe');
    expect(reference).toBeDefined();
    if (reference === undefined || coolantRecipe === undefined) throw new Error('unreachable');
    reference.element = coolantRecipe;
    const saved = writeNcpfSave(document);
    const savedDesign = (saved.designs as JsonObject[])[0];
    expect(savedDesign.coolant_recipe).toBe(0);

    // ... and the round trip keeps it
    const again = parseNcpfProject(JSON.stringify(saved), document.container);
    expect(again.designs[0].scalarReferences.get('coolant_recipe')?.element?.definition.identity).toBe(
      coolantRecipe.definition.identity,
    );
    expect(again.issues).toEqual([]);
  });

  it('tolerates a dangling grid index, reports it, and normalizes it on save', () => {
    const json = JSON.stringify({
      version: 1,
      addons: [],
      modules: {},
      configuration: {
        'nuclearcraft:underhaul_sfr': {
          blocks: [
            { name: 'a', type: 'legacy_block' },
            { name: 'b', type: 'legacy_block' },
          ],
          fuels: [{ name: 'f', type: 'legacy_item', metadata: 0 }],
          modules: {},
        },
      },
      designs: [
        {
          type: 'nuclearcraft:underhaul_sfr',
          dimensions: [2, 2, 2],
          design: [
            [
              [0, 1],
              [1, 0],
            ],
            [
              [0, 5],
              [1, 0],
            ],
          ],
          block_recipes: [],
          fuel: 0,
        },
      ],
    });
    const document = parseNcpfProject(json, 'synthetic');
    expect(document.issues).toContain('design[0]: blocks[1][0][1]=5 does not resolve');
    expect(document.designs[0].grid?.blocks[1][0][1]).toBeNull();
    const saved = writeNcpfSave(document);
    const grid = ((saved.designs as JsonObject[])[0].design as number[][][]);
    // Java throws on this input; TS resolves the dangling cell to `-1`.
    expect(grid[1][0][1]).toBe(-1);
    expect(grid[0][0]).toEqual([0, 1]);
  });
});

function designIdentities(design: ReturnType<typeof project>['designs'][number]): unknown {
  return {
    blocks: design.grid?.blocks.map((plane) =>
      plane.map((row) => row.map((cell) => (cell === null ? null : elementIdentity(cell)))),
    ),
    recipes: design.grid?.recipes.map((plane) =>
      plane.map((row) => row.map((cell) => (cell === null ? null : elementIdentity(cell)))),
    ),
    scalars: [...design.scalarReferences.values()].map((reference) => [
      reference.key,
      reference.element === null ? null : elementIdentity(reference.element),
    ]),
  };
}
