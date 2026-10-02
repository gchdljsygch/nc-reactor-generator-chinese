import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import {
  f,
  fadd,
  fdiv,
  fmul,
  loadShippedSfrConfig,
  OverhaulSfrReactor,
  SfrBlock,
  type SfrConfig,
  type SfrTemplate,
} from '@ncplanner/kernel';

/**
 * R1.5h — **independent** verification of the physics (the plan marks this as
 * non-optional: matching the frozen Java engine is only a necessary condition,
 * because R0 proved the old implementation disagrees with itself, and the real
 * 2020 save differs by 6.78× on `cooling`).
 *
 * So this test does not consult the golden dataset at all. It builds one tiny
 * reactor by hand, computes the expected numbers from NuclearCraft's documented
 * formulas (written out below), and asserts the kernel agrees.
 *
 * Reactor: interior 3×1×1 — `[fuel cell][heavy water][fuel cell]`, with a full
 * casing shell and one controller.
 *
 * Physics walkthrough (Documented NC Overhauled rules):
 *
 *  - A moderator between two cells forms a *moderator line*: each cell gains
 *    `moderatorLines += 1`, `neutronFlux += moderator.flux` and
 *    `positionalEfficiency += moderator.efficiency / lineLength` (lineLength = 1
 *    here, one moderator). Heavy water: flux 36, efficiency 1.0.
 *  - A fuel cell is active when `neutronFlux >= criticality`. HECf-249-ZA is
 *    self-priming with criticality 25, so 36 ≥ 25 → both cells run.
 *  - Cell efficiency = fuelEfficiency × positionalEfficiency × sourceEfficiency ×
 *    criticalityModifier, where the modifier is 1/(1+exp(2·(flux − 2·criticality)))
 *    — for flux 36 and criticality 25 that is 1/(1+e^-28) ≈ 1.
 *  - Cluster heat = Σ moderatorLines × fuelHeat; cluster output = Σ fuelHeat × efficiency.
 *    No cooling → no cooling penalty.
 *  - `rawOutput` accumulates the float cluster outputs through an `int` (Java
 *    `int += float`), i.e. truncation per cluster.
 *  - `functionalBlocks` = 3 (2 cells + 1 active moderator; casing is not functional),
 *    internal volume = 3 → functional/volume = 1 ≥ sparsity threshold 0.75 → no penalty.
 *  - Output is divided by `coolantHeat / outputRatio` = 64 / 4 = 16 (mb/t).
 *  - The shutdown pass repeats the same calculation with the cells that were
 *    active forced to propagate, so `offOutput == totalOutput` and
 *    `shutdownFactor == 0`.
 */

const ROOT = new URL('../../../', import.meta.url);
const config: SfrConfig = loadShippedSfrConfig(
  fileURLToPath(new URL('src/configurations/nuclearcraft.ncpf.json', ROOT)),
);

const FUEL = 'ingotHECf249ZA';
const CELL = 'nuclearcraft:solid_fission_cell';
const MODERATOR = 'nuclearcraft:heavy_water_moderator';
const GRAPHITE = 'blockGraphite';

/** Build the 3×1×1 hand-check reactor with a full casing shell. */
function buildReactor(moderatorIdentity: string): OverhaulSfrReactor {
  const reactor = new OverhaulSfrReactor(config, 3, 1, 1, { heat: 64, ratio: 4 });
  const byName = (name: string): SfrTemplate => {
    const template = config.templates.find((t) => t.name === name);
    if (!template) throw new Error(`template not found: ${name}`);
    return template;
  };
  const casing = config.templates.find((t) => t.casing && !t.controller)!;
  const controller = config.templates.find((t) => t.controller)!;
  const cell = byName(CELL);
  const moderator = byName(moderatorIdentity);

  for (let x = 0; x < reactor.grid.externalWidth; x++) {
    for (let y = 0; y < reactor.grid.externalHeight; y++) {
      for (let z = 0; z < reactor.grid.externalDepth; z++) {
        const pos = { x, y, z };
        if (reactor.grid.get(pos) !== null) continue;
        const onShell =
          x === 0 || y === 0 || z === 0 || x === 4 || y === 2 || z === 2;
        if (!onShell) continue;
        const template = x === 0 && y === 0 && z === 0 ? controller : casing;
        reactor.setBlock(pos, new SfrBlock(pos, template));
      }
    }
  }
  const cellA = new SfrBlock({ x: 1, y: 1, z: 1 }, cell);
  cellA.fuel = cell.fuels.find((fu) => fu.name === FUEL)!;
  const cellB = new SfrBlock({ x: 3, y: 1, z: 1 }, cell);
  cellB.fuel = cell.fuels.find((fu) => fu.name === FUEL)!;
  reactor.setBlock({ x: 1, y: 1, z: 1 }, cellA);
  reactor.setBlock({ x: 2, y: 1, z: 1 }, new SfrBlock({ x: 2, y: 1, z: 1 }, moderator));
  reactor.setBlock({ x: 3, y: 1, z: 1 }, cellB);
  reactor.recalculate();
  return reactor;
}

describe('hand-calculated Overhaul SFR physics (R1.5h)', () => {
  const fuel = config.templates
    .find((t) => t.name === CELL)!
    .fuels.find((fu) => fu.name === FUEL)!;
  const heavyWater = config.templates.find((t) => t.name === MODERATOR)!;

  it('agrees with the documented physics for [cell][heavy water][cell]', () => {
    const reactor = buildReactor(MODERATOR);
    const stats = reactor.stats();
    const cells = reactor.getBlocks().filter((b) => b.isFuelCell());
    const moderator = reactor.getBlocks().find((b) => b.isModerator())!;

    // ---- inputs, straight from the configuration ---------------------------
    expect(fuel.stats.heat).toBe(2028);
    expect(fuel.stats.efficiency).toBe(Math.fround(1.8));
    expect(fuel.stats.criticality).toBe(25);
    expect(fuel.stats.selfPriming).toBe(true);
    expect(heavyWater.moderator!.flux).toBe(36);
    expect(heavyWater.moderator!.efficiency).toBe(1);

    // ---- casing physics ---------------------------------------------------
    expect(stats.numControllers).toBe(1);
    expect(stats.missingCasings).toBe(0);

    // ---- moderator line ---------------------------------------------------
    for (const cell of cells) {
      expect(cell.neutronFlux).toBe(36); // = moderator flux
      expect(cell.moderatorLines).toBe(1); // one line, one moderator long
      expect(cell.positionalEfficiency).toBe(1); // moderator efficiency / length = 1/1
      expect(cell.isFuelCellActive()).toBe(true); // 36 >= criticality 25
      // critMod = 1/(1+exp(2*(36-2*25))) is 1 to float precision
      expect(f(1 / (1 + Math.exp(2 * (36 - 2 * fuel.stats.criticality))))).toBe(1);
      // efficiency = fuelEff × posEff × source(1) × critMod
      expect(cell.efficiency).toBe(f(f(f(fuel.stats.efficiency * 1) * 1) * 1));
    }
    expect(moderator.moderatorValid).toBe(true);
    expect(moderator.moderatorActive).toBe(true);

    // ---- cluster aggregates ----------------------------------------------
    // heat = Σ moderatorLines × fuelHeat = 2 × 2028
    expect(stats.totalHeat).toBe(2 * fuel.stats.heat);
    expect(stats.netHeat).toBe(stats.totalHeat); // no cooling
    expect(stats.totalCooling).toBe(0);
    expect(stats.totalFuelCells).toBe(2);
    expect(stats.totalHeatMult).toBe(1);
    expect(stats.totalIrradiation).toBe(0);
    expect(stats.functionalBlocks).toBe(3); // 2 cells + 1 active moderator
    expect(stats.sparsityMult).toBe(1); // functional/volume = 3/3 = 1 ≥ 0.75

    // output = Σ heat × efficiency, then / (coolantHeat / outputRatio) = /16
    const perCell = fmul(fuel.stats.heat, fuel.stats.efficiency);
    const collected = fadd(perCell, perCell);
    const expectedOutput = fdiv(collected, 64 / 4);
    expect(stats.rawOutput).toBe(Math.trunc(perCell) * 2);
    expect(stats.totalOutput).toBe(expectedOutput);
    expect(stats.totalEfficiency).toBe(f(fuel.stats.efficiency));

    // ---- shutdown pass ----------------------------------------------------
    expect(stats.offOutput).toBe(expectedOutput);
    expect(stats.shutdownFactor).toBe(0);
  });

  it('produces nothing when the moderator line cannot reach criticality', () => {
    // Graphite has flux 10 < criticality 25, so neither cell can start. This is
    // the documented behaviour, and it is the bound the "one moderator line"
    // claim above depends on.
    //
    // Note the asymmetry the engine has: in the re-propagation loop an inactive
    // cell is skipped (`!wasActive`), so its *line counters* are cleared while the
    // flux it collected in the first pass is restored. Both halves are visible
    // here, and both are corroborated by the golden data (e.g. sfr-000001 has a
    // cell with flux 10 and moderatorLines 0).
    const reactor = buildReactor(GRAPHITE);
    const stats = reactor.stats();
    for (const cell of reactor.getBlocks().filter((b) => b.isFuelCell())) {
      expect(cell.neutronFlux).toBe(10);
      expect(cell.moderatorLines).toBe(0);
      expect(cell.positionalEfficiency).toBe(0);
      expect(cell.isFuelCellActive()).toBe(false);
    }
    expect(stats.totalFuelCells).toBe(0);
    expect(stats.totalOutput).toBe(0);
    expect(stats.totalHeat).toBe(0);
    expect(stats.rawOutput).toBe(0);
    // The shutdown factor is defined on [0,1] and is 0 with no output (R1 §3.1.5).
    expect(stats.shutdownFactor).toBe(0);
  });

  it('reports every statistic as a finite number', () => {
    const stats = buildReactor(MODERATOR).stats();
    for (const [key, value] of Object.entries(stats)) {
      expect(Number.isFinite(value), `${key} = ${value}`).toBe(true);
    }
  });

  it('is idempotent: recalculating the same reactor object changes nothing', () => {
    // The editor recalculates in place on every edit, so this is the TS analogue
    // of R1.0a's Java repeatability measurement (`--repeat 10`). It also catches
    // forgotten state resets (`hasPropogated`, `moderatorLines`, `wasActive`,
    // cluster membership, `offOutput`, …).
    const reactor = buildReactor(MODERATOR);
    const first = reactor.stats();
    reactor.recalculate();
    const second = reactor.stats();
    reactor.recalculate();
    const third = reactor.stats();
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });
});
