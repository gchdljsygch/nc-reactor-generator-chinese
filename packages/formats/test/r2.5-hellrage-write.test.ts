/**
 * R2.5 — the **Hellrage JSON writer** (`src/legacy/hellrageWriter.ts`).
 *
 * The metric is the one R2.5 names: *a file written by TS must be readable by the
 * frozen Java version*. That is checked two ways:
 *
 *  1. in-process, through the TS chain — read a fixture, write it, read the
 *     written text back, and require the design to round trip: the same design
 *     count, the same element/design counts (`countsOf`), the same fingerprint
 *     (`fingerprintOf`) and — stronger, since the required three fold in no
 *     design content at all — a byte-equal design grid. Every assertion is made
 *     on the *design-bearing* part of the tree, because Hellrage JSON has no
 *     slot for a configuration: Java's own warning is "Casings, configurations,
 *     and addons will not be saved!" (`HellrageWriter.java:31`), and R2.10's
 *     reader embeds the configuration it recovered a name from
 *     (`hellrage.ts` deviation 8), which a Hellrage file cannot carry back.
 *     `expectDesignRoundTrip` also asserts that the re-read needed **no**
 *     recovery at all — the reader embeds a configuration only when a name
 *     defeats the frozen reader's matching rules, so an empty embedded
 *     configuration is exactly "every key this writer emits resolves in the
 *     frozen Java version".
 *  2. out-of-process, with `pwsh -File tools/golden/format-golden.ps1 -Probe
 *     <file>` — the frozen Java reader chain. The evidence is in the module
 *     header of `hellrageWriter.ts`. The underhaul file prints `read: OK`; the
 *     overhaul file resolves every name and then dies inside the frozen
 *     `FileReader.read`'s own object-model copy (R0 finding #9), which a
 *     *Java-authored* file reproduces with the byte-identical exception.
 */
import { describe, expect, it } from 'vitest';
import { deepCloneJson, isJsonObject, type JsonObject, type JsonValue } from '../src/json.js';
import { readAnyProjectBytes } from '../src/legacy/index.js';
import { defaultHellrageRoot } from '../src/legacy/hellrage.js';
import { writeHellrage, writeHellrageText } from '../src/legacy/hellrageWriter.js';
import { countsOf, fingerprintOf, fixtureBytes, jsonDiff } from './legacyGoldens.js';

// ------------------------------------------------------------------- helpers

/** `readAnyProjectBytes` over a fixture, with the fixture name as container. */
function readFixture(file: string): JsonObject {
  return readAnyProjectBytes(fixtureBytes(file), file).raw;
}

function readText(text: string, container: string): JsonObject {
  return readAnyProjectBytes(new TextEncoder().encode(text), container).raw;
}

interface RoundTrip {
  /** The written Hellrage document. */
  readonly written: JsonObject;
  /** The written, Java-faithful text. */
  readonly text: string;
  /** The written text read back through the TS chain. */
  readonly again: JsonObject;
}

function roundTrip(raw: JsonObject): RoundTrip {
  const written = writeHellrage(raw);
  return { written: written.json, text: written.text, again: readText(written.text, '<written>') };
}

function designsOf(raw: JsonObject): readonly JsonObject[] {
  return Array.isArray(raw.designs) ? raw.designs.filter(isJsonObject) : [];
}

function objectAt(node: JsonValue | undefined): JsonObject {
  if (!isJsonObject(node)) throw new Error('expected a JSON object');
  return node;
}

/** The part of a tree Hellrage JSON can actually hold — see the module header. */
function designBearing(raw: JsonObject): JsonObject {
  return { ...raw, configuration: {} };
}

/**
 * The required "same design count / counts / fingerprint" comparison, plus the
 * frozen-reader name resolution proxy.
 */
function expectCountsRoundTrip(raw: JsonObject, again: JsonObject): void {
  expect(designsOf(again)).toHaveLength(designsOf(raw).length);
  expect(countsOf(again)).toEqual(countsOf(designBearing(raw)));
  expect(fingerprintOf(again)).toBe(fingerprintOf(designBearing(raw)));
  // `emitRoot` embeds a configuration only for a read that needed R2.10
  // recovery, i.e. only for a name the *frozen* reader cannot resolve.
  expect(again.configuration).toEqual({});
}

/** {@link expectCountsRoundTrip} plus an exact comparison of the design grids. */
function expectDesignRoundTrip(raw: JsonObject, again: JsonObject): void {
  expectCountsRoundTrip(raw, again);
  expect(jsonDiff(designsOf(raw), designsOf(again))).toBeNull();
}

/** The interior block grid of design 0 (`1..dimensions-2`, Java's readable part). */
function interiorOf(raw: JsonObject): JsonValue {
  const design = designsOf(raw)[0];
  if (design === undefined) throw new Error('no design');
  const grid = design.design;
  const dimensions = design.dimensions;
  if (!Array.isArray(grid) || !Array.isArray(dimensions)) throw new Error('design has no grid');
  const [dimX = 0, dimY = 0, dimZ = 0] = dimensions as number[];
  return grid
    .slice(1, dimX - 1)
    .map((plane) => (plane as JsonValue[]).slice(1, dimY - 1).map((row) => (row as JsonValue[]).slice(1, dimZ - 1)));
}

const SFR_OVERHAUL = 'nuclearcraft:overhaul_sfr';
const SFR_UNDERHAUL = 'nuclearcraft:underhaul_sfr';

/** `datasets/fixtures/sfr-hellrage.json` needs the R2.10 reader repair first. */
const SFR_HELLRAGE_READABLE = (() => {
  try {
    readAnyProjectBytes(fixtureBytes('sfr-hellrage.json'), 'sfr-hellrage.json');
    return true;
  } catch {
    return false;
  }
})();

// ------------------------------------------------------------------ underhaul

describe('R2.5 Hellrage writer: underhaul SFR v2', () => {
  const file = 'historical/underhaul.json';

  it('round trips the real 2020 file through the TS chain', () => {
    const raw = readFixture(file);
    const { written, again } = roundTrip(raw);

    // The written document is the underhaul v2 shape, not the overhaul one.
    expect(written.Data).toBeUndefined();
    expect(designsOf(raw)[0].type).toBe(SFR_UNDERHAUL);
    expectDesignRoundTrip(raw, again);
  });

  it('writes the UnderhaulHellrage2Reader version header and the fuel stats', () => {
    const written = writeHellrage(readFixture(file)).json;
    expect(written.SaveVersion).toEqual({
      Major: 1,
      Minor: 2,
      Build: 23,
      Revision: 0,
      MajorRevision: 0,
      MinorRevision: 0,
    });
    expect(written.CompressedReactor).toBeDefined();
    expect(written.InteriorDimensions).toEqual({ X: 3, Y: 8, Z: 2 });
    // Java holds power/heat as `Float` and time as `int` (`FuelStatsModule`), and
    // `JSON.JSONObject.write` prints `Float.toString` — hence the `.0`. The values
    // come from the **active configuration**, not from the file: the 2020 fixture
    // carries a different config generation (7560.0 / 1080.0 / 29000), and
    // `HellrageWriter.java:71-74` reads `reactor.fuel.stats.*` from its own.
    expect(writeHellrageText(readFixture(file))).toContain(
      '"UsedFuel":{"Name":"HECf-251 Oxide","BasePower":1260.0,"BaseHeat":900.0,"FuelTime":58000}',
    );
  });

  it('round trips usfr-hellrage.json, whose moderator key is empty in the file', () => {
    // The frozen writer strips the word `Moderator`, so the fixture carries the
    // *empty* key that `UnderhaulHellrage2Reader` then rejects
    // (`Invalid block name: !`, docs/r0/fixture-coverage.md §18).
    const raw = readFixture('usfr-hellrage.json');
    const { written, again } = roundTrip(raw);
    const compressed = objectAt(written.CompressedReactor);

    expect(Object.keys(compressed)).not.toContain('');
    expect(Object.keys(compressed)).toContain('moderator');
    expect(Array.isArray(compressed.moderator)).toBe(true);
    expect(compressed.moderator).toHaveLength(63);
    expectDesignRoundTrip(raw, again);
  });

  it('writes one key per configuration block, empty arrays included', () => {
    const written = writeHellrage(readFixture('usfr-hellrage.json')).json;
    const compressed = objectAt(written.CompressedReactor);
    // `HellrageWriter.java:51-64` puts every block of the configuration, and
    // names it through `underhaulBlockWrite` — the same codec the reader indexes
    // with, and the one that keeps `Moderator` instead of collapsing it to `""`.
    expect(Object.keys(compressed)).toEqual([
      'fissioncontroller',
      'casing',
      'transparentcasing',
      'fuelcell',
      'water',
      'redstone',
      'quartz',
      'gold',
      'glowstone',
      'lapis',
      'diamond',
      'helium',
      'enderium',
      'cryotheum',
      'iron',
      'emerald',
      'copper',
      'tin',
      'magnesium',
      'moderator',
      'active',
    ]);
  });
});

// ------------------------------------------------------------------- overhaul

describe('R2.5 Hellrage writer: overhaul SFR v6', () => {
  const file = 'historical/overhaul.json';

  it('round trips the real 2020 v5 file as a v6 document', () => {
    const raw = readFixture(file);
    const { written, again } = roundTrip(raw);
    const data = objectAt(written.Data);

    expect(designsOf(raw)[0].type).toBe(SFR_OVERHAUL);
    expect(written.CompressedReactor).toBeUndefined();
    expect(written.SaveVersion).toEqual({
      Major: 2,
      Minor: 1,
      Build: 1,
      Revision: 0,
      MajorRevision: 0,
      MinorRevision: 0,
    });
    // `HellrageWriter.java:217-240`, in that order.
    expect(Object.keys(data)).toEqual([
      'HeatSinks',
      'Moderators',
      'Reflectors',
      'FuelCells',
      'Irradiators',
      'NeutronShields',
      'Conductors',
      'InteriorDimensions',
      'CoolantRecipeName',
    ]);
    expect(data.InteriorDimensions).toEqual({ X: 5, Y: 5, Z: 5 });
    expectDesignRoundTrip(raw, again);
  });

  it('writes identity keys the frozen reader can resolve', () => {
    const data = objectAt(writeHellrage(readFixture(file)).json.Data);

    // The three deviations from the Java spelling, each with its Java citation in
    // the module header of hellrageWriter.ts.
    expect(Object.keys(objectAt(data.FuelCells))).toEqual(['[OX]LEU-235;True;Cf-252 Neutron Source']);
    expect(objectAt(data.FuelCells)['[OX]LEU-235;True;Cf-252 Neutron Source']).toEqual([{ X: 5, Y: 2, Z: 4 }]);
    // Identity names pushed through the section transform; Java wrote `Water` /
    // `Beryllium` / `HeavyWater` / `Beryllium-Carbon` here.
    expect(objectAt(data.HeatSinks).water).toEqual([
      { X: 5, Y: 2, Z: 5 },
      { X: 5, Y: 3, Z: 4 },
    ]);
    expect(objectAt(data.Moderators).beryllium).toEqual([{ X: 5, Y: 2, Z: 2 }]);
    expect(objectAt(data.Moderators).heavywater).toEqual([{ X: 5, Y: 2, Z: 3 }]);
    expect(objectAt(data.Reflectors)['beryllium-carbon']).toEqual([{ X: 5, Y: 2, Z: 1 }]);
    // `block.isConductor()` — a flat array, never a named section.
    expect(data.Conductors).toEqual([
      { X: 2, Y: 5, Z: 5 },
      { X: 4, Y: 4, Z: 3 },
    ]);
    // `reactor.coolantRecipe.getDisplayName()+" to "+…` (`:240`) replaced by the
    // element identity; the frozen reader matches legacy names.
    expect(data.CoolantRecipeName).toBe('Water');
  });

  it('keeps every section of the Java document, empty ones included', () => {
    const data = objectAt(writeHellrage(readFixture(file)).json.Data);
    expect(Object.keys(objectAt(data.HeatSinks))).toHaveLength(32);
    expect(objectAt(data.Reflectors)['lead-steel']).toEqual([]);
    expect(data.Irradiators).toEqual({});
    expect(objectAt(data.NeutronShields)['boron-silver']).toEqual([]);
  });

  it('round trips an NCPF save: interior, recipes and fuel keys, casing excluded', () => {
    // A full NCPF save carries the configuration and the casing layer; Hellrage
    // carries neither (`HellrageWriter.java:31,54`), so the comparison is the
    // documented one: the interior grid plus the compressed recipe grid.
    const raw = readFixture('sfr-ncpf-save.ncpf.json');
    const { written, again } = roundTrip(raw);
    const keys = Object.keys(objectAt(objectAt(written.Data).FuelCells));

    // Deviation 4: a suffix-less fuel name needs the `[ID]` marker, because the
    // frozen reader always decodes `name.substring(4)`.
    expect(keys).toContain('[ID]MOX-241;False;None');
    // Deviation 3: a self-priming fuel with no source block in the grid is
    // `False;None`, never Java's `True;Self` (`Invalid block name: Self!`).
    expect(keys).toContain('[OX]LECf-249;False;None');
    expect(keys.some((key) => key.endsWith(';True;Self'))).toBe(false);

    expect(jsonDiff(interiorOf(raw), interiorOf(again))).toBeNull();
    expect(jsonDiff(designsOf(raw)[0].block_recipes, designsOf(again)[0].block_recipes)).toBeNull();
    expectCountsRoundTrip(raw, again);
    // The one design-level difference: Java's `-1` coolant recipe is repaired to
    // the configuration's first recipe (deviation 6), the only value a Hellrage
    // file can carry for that field.
    expect(jsonDiff(designsOf(raw), designsOf(again))).toBe('$[0].coolant_recipe: -1 vs 0');
  });

  it('reports a repaired scalar reference instead of crashing like Java', () => {
    // `sfr-ncpf-save.ncpf.json` is the R0 finding #8 artefact: Java wrote
    // `coolant_recipe: -1`. `HellrageWriter` would NPE on the null recipe.
    const raw = readFixture('sfr-ncpf-save.ncpf.json');
    expect(designsOf(raw)[0].coolant_recipe).toBe(-1);
    const result = writeHellrage(raw);
    expect(result.issues).toEqual([
      "design[0]: coolant_recipe is unset; using the configuration's first coolant_recipes element (Water)",
    ]);
    expect(objectAt(result.json.Data).CoolantRecipeName).toBe('Water');
  });
});

// ----------------------------------------------------------- hand-built input

/** A minimal v6 document exercising every section codec at once. */
const SYNTHETIC = {
  SaveVersion: { Major: 2, Minor: 1, Build: 1, Revision: 0, MajorRevision: 0, MinorRevision: 0 },
  Data: {
    HeatSinks: { Water: [{ X: 1, Y: 1, Z: 1 }] },
    Moderators: { Graphite: [{ X: 1, Y: 1, Z: 3 }] },
    Reflectors: { 'Beryllium-Carbon': [{ X: 2, Y: 1, Z: 1 }] },
    FuelCells: { '[OX]TBU;False;None': [{ X: 3, Y: 1, Z: 1 }] },
    Irradiators: { '{"HeatPerFlux":0,"EfficiencyMultiplier":0.5}': [{ X: 3, Y: 1, Z: 3 }] },
    NeutronShields: { 'Boron-Silver': [{ X: 2, Y: 1, Z: 3 }] },
    Conductors: [{ X: 2, Y: 1, Z: 2 }],
    InteriorDimensions: { X: 3, Y: 3, Z: 3 },
    CoolantRecipeName: 'Water to High Pressure Steam',
  },
};

/** The synthetic document, via the reader (so the tree is exactly a read tree). */
function synthetic(overrides: (data: Record<string, unknown>) => void = () => {}): JsonObject {
  const document = JSON.parse(JSON.stringify(SYNTHETIC)) as { Data: Record<string, unknown> };
  overrides(document.Data);
  return readText(JSON.stringify(document), '<synthetic>');
}

describe('R2.5 Hellrage writer: section codecs', () => {
  it('round trips every section of a hand-built v6 document exactly', () => {
    // Java's own spelling for every key (`Water`, `Graphite`, `Boron-Silver`, …):
    // the reader resolves them, the writer normalizes them to element identity.
    const raw = synthetic();
    const { written, again } = roundTrip(raw);
    const data = objectAt(written.Data);

    expect(objectAt(data.HeatSinks).water).toEqual([{ X: 1, Y: 1, Z: 1 }]);
    expect(objectAt(data.Moderators).graphite).toEqual([{ X: 1, Y: 1, Z: 3 }]);
    expect(objectAt(data.Reflectors)['beryllium-carbon']).toEqual([{ X: 2, Y: 1, Z: 1 }]);
    expect(objectAt(data.NeutronShields)['boron-silver']).toEqual([{ X: 2, Y: 1, Z: 3 }]);
    expect(data.Conductors).toEqual([{ X: 2, Y: 1, Z: 2 }]);
    expectDesignRoundTrip(raw, again);
  });

  it('serializes the irradiator recipe into the key with Java float spelling', () => {
    // `HellrageWriter.java:194`: an `(int)` heat and a `Float.toString`
    // efficiency, inside a JSON object serialized into the key.
    const raw = synthetic();
    const irradiators = objectAt(objectAt(writeHellrage(raw).json.Data).Irradiators);
    expect(Object.keys(irradiators)).toEqual(['{"HeatPerFlux":0,"EfficiencyMultiplier":0.5}']);
    expect(irradiators['{"HeatPerFlux":0,"EfficiencyMultiplier":0.5}']).toEqual([{ X: 3, Y: 1, Z: 3 }]);
    expect(writeHellrageText(raw)).toContain('"{\\"HeatPerFlux\\":0,\\"EfficiencyMultiplier\\":0.5}"');
  });

  it('re-derives a primed fuel cell from the neutron source in the grid', () => {
    // A `True;<source>` key makes the reader place the source in the *casing*
    // layer (`LegacyNeutronSourceHandler`); the writer has to find it again from
    // the grid, because the NCPF tree stores it nowhere else. Java reads
    // `block.source`, set by the same walk in the simulation
    // (`OverhaulSFR.java:237-259`).
    const raw = synthetic((data) => {
      data.FuelCells = { '[OX]TBU;True;Cf-252 Neutron Source': [{ X: 3, Y: 1, Z: 1 }] };
    });
    const result = writeHellrage(raw);
    const keys = Object.keys(objectAt(objectAt(result.json.Data).FuelCells));
    // A primed cell names its source in full (deviation 2), so the frozen reader
    // can resolve it — Java writes the shortened `Cf-252` and cannot.
    expect(keys).toEqual(['[OX]TBU;True;Cf-252 Neutron Source']);

    // The casing-layer source block survives the round trip.
    const again = readText(result.text, '<primed-written>');
    expectDesignRoundTrip(raw, again);
    expect(jsonDiff(interiorOf(raw), interiorOf(again))).toBeNull();
  });

  it('reports a configuration whose legacy names have been stripped', () => {
    // `writeNcpfExport` trims every `plannerator:*` module, so the identity name
    // falls back to the data name — which the frozen reader cannot resolve. Java
    // degrades the same way (`getDisplayName()` → `definition.getName()`), so the
    // writer says so instead of pretending. The configuration is injected because
    // the synthetic document is fully Java-resolvable and therefore carries none.
    const configuration = deepCloneJson(objectAt(objectAt(defaultHellrageRoot().configuration)[SFR_OVERHAUL]));
    for (const element of configuration.blocks as JsonObject[]) {
      if (isJsonObject(element.modules)) delete element.modules['plannerator:legacy_names'];
    }
    const project: JsonObject = { ...synthetic(), configuration: { [SFR_OVERHAUL]: configuration } };
    const result = writeHellrage(project);
    expect(result.issues.some((issue) => issue.includes('no plannerator:legacy_names module'))).toBe(true);
  });
});

// ------------------------------------------------------ version / type limits

describe('R2.5 Hellrage writer: the frozen writer’s limits', () => {
  const underhaul = readFixture('historical/underhaul.json');

  it('refuses a project without a design', () => {
    expect(() => writeHellrage({ ...underhaul, designs: [] })).toThrow(
      'Cannot export NCPF configuration to Hellrage JSON format!',
    );
  });

  it('refuses more than one design', () => {
    const designs = designsOf(underhaul);
    expect(() => writeHellrage({ ...underhaul, designs: [designs[0], designs[0]] })).toThrow(
      'Multiple designs are not supported by Hellrage JSON!',
    );
  });

  it('refuses a design type Hellrage JSON has no dialect for', () => {
    const designs = designsOf(underhaul);
    const turbine = { ...designs[0], type: 'nuclearcraft:overhaul_turbine' };
    expect(() => writeHellrage({ ...underhaul, designs: [turbine] })).toThrow(
      'Overhaul Turbine is not supported by Hellrage JSON!',
    );
  });

  it('refuses a non-multiblock (unregistered) design type', () => {
    const designs = designsOf(underhaul);
    const unknown = { ...designs[0], type: 'plannerator:not_a_design' };
    expect(() => writeHellrage({ ...underhaul, designs: [unknown] })).toThrow(
      'Cannot export non-multiblock design plannerator:not_a_design to Hellrage JSON!',
    );
  });
});

// ------------------------------------------- the R2.5 fixture itself, if ready

describe.skipIf(!SFR_HELLRAGE_READABLE)('R2.5 Hellrage writer: sfr-hellrage.json', () => {
  it('round trips the Java writer’s own overhaul file', () => {
    const raw = readFixture('sfr-hellrage.json');
    const { again } = roundTrip(raw);
    expect(designsOf(raw)[0].type).toBe(SFR_OVERHAUL);
    expectDesignRoundTrip(raw, again);
  });

  it('downgrades `True;Self` to `False;None`, which the frozen reader accepts', () => {
    const written = writeHellrage(readFixture('sfr-hellrage.json')).json;
    const keys = Object.keys(objectAt(objectAt(written.Data).FuelCells));
    expect(keys.some((key) => key.endsWith(';True;Self'))).toBe(false);
    expect(keys).toContain('[NI]HECf-249;False;None');
  });
});
