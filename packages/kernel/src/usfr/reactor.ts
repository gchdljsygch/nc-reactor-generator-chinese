import type { NCPFElementDefinition, PlacementRule, RawModules } from '@ncplanner/ncpf';
import { CuboidGrid, DIRECTION_VECTORS, offsetDir, type Pos } from '../geometry.js';
import { placementRuleIsValid, type RuleGrid } from '../rules.js';
import { fadd, fdiv, fmul, f2i } from '../float.js';
import type { UsfrActiveCoolerRecipe, UsfrConfig, UsfrTemplate } from './config.js';

/**
 * `net.ncplanner.plannerator.multiblock.underhaul.fissionsfr.UnderhaulSFR` — the
 * single Underhaul SFR physics kernel.
 *
 * Much smaller than Overhaul SFR: one pass over the cells, a fixpoint loop over
 * the coolers, then the statistics. The reactor carries **one** fuel for the
 * whole multiblock (Java `UnderhaulSFR.fuel`), not a per-cell recipe — the R0
 * dataset is rebuilt accordingly.
 *
 * Java line references are to
 * `src/net/ncplanner/plannerator/multiblock/underhaul/fissionsfr/UnderhaulSFR.java`.
 */

export interface UsfrStats {
  cells: number;
  cooling: number;
  efficiency: number;
  heat: number;
  heatMult: number;
  missingCasings: number;
  netHeat: number;
  numControllers: number;
  power: number;
}

export class UsfrBlock {
  /** `null` for the active cooler until a coolant recipe is chosen. */
  recipe: UsfrActiveCoolerRecipe | null = null;
  adjacentCells = 0;
  adjacentModerators = 0;
  /** Java `float`. */
  energyMult = 0;
  /** Java `float`. */
  heatMult = 0;
  moderatorValid = false;
  moderatorActive = false;
  coolerValid = false;
  casingValid = false;

  constructor(
    readonly pos: Pos,
    public template: UsfrTemplate,
  ) {}

  clearData(): void {
    this.adjacentCells = 0;
    this.adjacentModerators = 0;
    this.energyMult = 0;
    this.heatMult = 0;
    this.moderatorActive = false;
    this.coolerValid = false;
    this.moderatorValid = false;
    this.casingValid = false;
  }

  isFuelCell(): boolean {
    return this.template.fuelCell;
  }
  isModerator(): boolean {
    return this.template.moderator;
  }
  /** Java `Block.isCooler()`. */
  isCooler(): boolean {
    return this.template.cooler !== null || (this.template.activeCooler && this.recipe !== null);
  }
  isCasing(): boolean {
    return this.template.casing;
  }
  isController(): boolean {
    return this.template.controller;
  }
  /** Java `Block.isActive()`. */
  isActive(): boolean {
    return this.isFuelCell() || this.moderatorActive || this.coolerValid || this.casingValid;
  }
  /** Java `Block.getRules()`. */
  getRules(): readonly PlacementRule[] {
    if (this.template.cooler !== null) return this.template.cooler.rules;
    if (this.recipe !== null) return this.recipe.cooler.rules;
    return [];
  }
  get definition(): NCPFElementDefinition {
    return this.template.element.definition;
  }
  get modules(): { modules: RawModules } {
    return { modules: this.template.element.modules };
  }
}

export class UnderhaulSfrReactor {
  readonly config: UsfrConfig;
  readonly grid: CuboidGrid<UsfrBlock>;
  private allBlocks: UsfrBlock[] = [];

  netHeat = 0;
  power = 0;
  heat = 0;
  cooling = 0;
  cells = 0;
  /** Java `float`. */
  efficiency = 0;
  /** Java `double` holding a `float` quotient. */
  heatMult = 0;
  numControllers = 0;
  missingCasings = 0;
  private readonly fuel: UsfrConfig['fuels'][number];

  constructor(config: UsfrConfig, width: number, height: number, depth: number) {
    this.config = config;
    this.grid = new CuboidGrid<UsfrBlock>(width, height, depth);
    const fuel = config.fuels[0];
    if (!fuel) throw new Error('underhaul configuration has no fuels');
    this.fuel = fuel;
  }

  get width(): number {
    return this.grid.width;
  }
  get height(): number {
    return this.grid.height;
  }
  get depth(): number {
    return this.grid.depth;
  }
  internalVolume(): number {
    return this.grid.internalVolume();
  }
  contains(p: Pos): boolean {
    return this.grid.contains(p);
  }
  getBlock(p: Pos): UsfrBlock | null | undefined {
    return this.grid.get(p);
  }
  setBlock(p: Pos, b: UsfrBlock | null): void {
    this.grid.set(p, b);
  }
  getBlocks(): UsfrBlock[] {
    return this.allBlocks;
  }

  recalculate(): void {
    this.allBlocks = this.grid.blocks();
    this.clearData();
    this.calculate();
  }

  /** Java `UnderhaulSFR.clearData`. */
  private clearData(): void {
    for (const b of this.allBlocks) b.clearData();
    this.heatMult = 0;
    this.efficiency = 0;
    this.power = 0;
    this.heat = 0;
    this.cooling = 0;
    this.netHeat = 0;
    this.cells = 0;
  }

  /** Java `doCalculationStep` cases 0..3, run to completion. */
  private calculate(): void {
    // case 0 — casing
    this.numControllers = 0;
    forEachCasingEdgePosition(this.grid, (p) => {
      const block = this.grid.get(p) ?? null;
      if (block === null) return;
      if (block.isController()) {
        block.casingValid = true;
        this.numControllers++;
      }
    });
    this.missingCasings = 0;
    forEachCasingFacePosition(this.grid, (p) => {
      const block = this.grid.get(p) ?? null;
      if (block === null || !block.isCasing()) {
        this.missingCasings++;
      }
      if (block !== null && block.isCasing()) {
        block.casingValid = true;
      }
    });
    // case 1 — core
    for (const block of this.allBlocks) this.calculateCore(block);
    // case 2 — coolers (fixpoint)
    for (let guard = 0; guard < 10_000; guard++) {
      let somethingChanged = false;
      for (const block of this.allBlocks) if (this.calculateCooler(block)) somethingChanged = true;
      if (!somethingChanged) break;
      if (guard === 9_999) throw new Error('Calculation overflow: cooler validation did not converge');
    }
    // case 3 — stats
    this.calcStats();
  }

  /** Java `calculateCore`. */
  calculateCore(that: UsfrBlock): void {
    if (!that.template.fuelCell) return;
    const reach = this.config.settings.neutronReach;
    for (const d of DIRECTION_VECTORS) {
      const toValidate: UsfrBlock[] = [];
      for (let i = 1; i <= reach + 1; i++) {
        if (!this.contains(offsetDir(that.pos, d, i))) break;
        const block = this.grid.get(offsetDir(that.pos, d, i)) ?? null;
        if (block === null) break;
        if (block.isModerator()) {
          if (i === 1) {
            block.moderatorActive = true;
            block.moderatorValid = true;
            that.adjacentModerators++;
          }
          toValidate.push(block);
          continue;
        }
        if (block.isFuelCell()) {
          for (const b of toValidate) b.moderatorValid = true;
          that.adjacentCells++;
          break;
        }
        break;
      }
    }
    // Java: float baseEff = that.energyMult = that.adjacentCells+1;
    const baseEff = fadd(that.adjacentCells, 1);
    that.energyMult = baseEff;
    that.heatMult = fdiv(fmul(baseEff, fadd(baseEff, 1)), 2);
    const settings = this.config.settings;
    // baseEff/6*moderatorExtraPower*adjacentModerators, accumulated in float.
    that.energyMult = fadd(
      that.energyMult,
      fmul(fmul(fdiv(baseEff, 6), settings.moderatorExtraPower), that.adjacentModerators),
    );
    that.heatMult = fadd(
      that.heatMult,
      fmul(fmul(fdiv(baseEff, 6), settings.moderatorExtraHeat), that.adjacentModerators),
    );
  }

  /** Java `calculateCooler`; returns true when the validity changed. */
  calculateCooler(block: UsfrBlock): boolean {
    if (block.template.cooler === null && !block.template.activeCooler) return false;
    const wasValid = block.coolerValid;
    if (block.template.activeCooler && block.recipe === null) {
      block.coolerValid = false;
      return wasValid !== block.coolerValid;
    }
    for (const rule of block.getRules()) {
      if (!this.ruleIsValid(rule, block)) {
        block.coolerValid = false;
        return wasValid !== block.coolerValid;
      }
    }
    block.coolerValid = true;
    return wasValid !== block.coolerValid;
  }

  private readonly ruleGrid: RuleGrid<UsfrBlock> = {
    contains: (p) => this.contains(p),
    blockAt: (p) => this.getBlock(p),
  };

  ruleIsValid(rule: PlacementRule, block: UsfrBlock): boolean {
    return placementRuleIsValid(rule, block, this.ruleGrid);
  }

  /** Java `Block.getCooling()`. */
  getCooling(block: UsfrBlock): number {
    if (block.template.cooler !== null) return block.template.cooler.cooling;
    if (block.template.activeCooler && block.recipe !== null) {
      // Java integer arithmetic: (cooling * rate) / 20
      return Math.trunc(
        (block.recipe.cooler.cooling * this.config.settings.activeCoolerRate) / 20,
      );
    }
    return 0;
  }

  /** Java case 3. */
  private calcStats(): void {
    let totalHeatMult = 0;
    let totalEnergyMult = 0;
    this.cells = 0;
    this.cooling = 0;
    for (const block of this.allBlocks) {
      if (block.isFuelCell()) {
        totalHeatMult = fadd(totalHeatMult, block.heatMult);
        totalEnergyMult = fadd(totalEnergyMult, block.energyMult);
        this.cells++;
      }
      if ((block.isCooler() || block.template.activeCooler) && block.isActive()) {
        this.cooling += this.getCooling(block);
      }
    }
    // Java `this.heatMult = totalHeatMult/cells` (float division widened to double).
    this.heatMult = fdiv(totalHeatMult, this.cells);
    if (Number.isNaN(this.heatMult)) this.heatMult = 0;
    this.heat = f2i(fmul(totalHeatMult, this.fuel.stats.heat));
    this.netHeat = this.heat - this.cooling;
    this.power = f2i(fmul(totalEnergyMult, this.fuel.stats.power));
    this.efficiency = fdiv(totalEnergyMult, this.cells);
    if (Number.isNaN(this.efficiency)) this.efficiency = 0;
  }

  stats(): UsfrStats {
    return {
      cells: this.cells,
      cooling: this.cooling,
      efficiency: this.efficiency,
      heat: this.heat,
      heatMult: this.heatMult,
      missingCasings: this.missingCasings,
      netHeat: this.netHeat,
      numControllers: this.numControllers,
      power: this.power,
    };
  }

  /** The reactor-level fuel (Java `UnderhaulSFR.fuel`), exposed for tooling. */
  getFuel(): UsfrConfig['fuels'][number] {
    return this.fuel;
  }
}

/** Java `CuboidalMultiblock.forEachCasingEdgePosition`. */
function forEachCasingEdgePosition(grid: CuboidGrid<UsfrBlock>, fn: (p: Pos) => void): void {
  grid.forEachPosition((p) => {
    const onShell =
      p.x === 0 || p.y === 0 || p.z === 0 || p.x === grid.width + 1 || p.y === grid.height + 1 || p.z === grid.depth + 1;
    if (!onShell) return;
    const x0 = p.x === 0 || p.x === grid.width + 1;
    const y0 = p.y === 0 || p.y === grid.height + 1;
    const z0 = p.z === 0 || p.z === grid.depth + 1;
    const edgeCount = (x0 ? 1 : 0) + (y0 ? 1 : 0) + (z0 ? 1 : 0);
    if (edgeCount >= 2) fn(p);
  });
}

/** Java `CuboidalMultiblock.forEachCasingFacePosition`. */
function forEachCasingFacePosition(grid: CuboidGrid<UsfrBlock>, fn: (p: Pos) => void): void {
  grid.forEachPosition((p) => {
    const onShell =
      p.x === 0 || p.y === 0 || p.z === 0 || p.x === grid.width + 1 || p.y === grid.height + 1 || p.z === grid.depth + 1;
    if (!onShell) return;
    const x0 = p.x === 0 || p.x === grid.width + 1;
    const y0 = p.y === 0 || p.y === grid.height + 1;
    const z0 = p.z === 0 || p.z === grid.depth + 1;
    const edgeCount = (x0 ? 1 : 0) + (y0 ? 1 : 0) + (z0 ? 1 : 0);
    if (edgeCount < 2) fn(p);
  });
}
