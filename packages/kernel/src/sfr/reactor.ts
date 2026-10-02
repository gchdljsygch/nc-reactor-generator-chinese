import { type NCPFElementDefinition, type PlacementRule, type RawModules } from '@ncplanner/ncpf';
import { CuboidGrid, DIRECTION_VECTORS, offsetDir, type Pos } from '../geometry.js';
import {
  blocksLOS,
  buildSfrConfig,
  createsCluster,
  isCasing,
  type SfrConfig,
  type SfrFuel,
  type SfrIrradiatorRecipe,
  type SfrTemplate,
} from './config.js';
import { d2f, f, fadd, fdiv, fmul, fsub, intAccumulateFloat, jexp } from '../float.js';
import { placementRuleIsValid, type RuleGrid } from '../rules.js';

/**
 * `net.ncplanner.plannerator.multiblock.overhaul.fissionsfr.OverhaulSFR` — the
 * single Overhaul SFR physics kernel.
 *
 * The port is *behavioural*, not stylistic. It reproduces the frozen editor
 * engine's
 *
 *  - block scan order (x, then y, then z) — `float` sums depend on it;
 *  - three-phase calculation (base → shutdown → partial shutdown);
 *  - iteration-to-fixpoint loops (flux re-propagation, heat sink validation);
 *  - `float` rounding at every intermediate step (see `../float.ts`);
 *  - template toggling for neutron shields: they are re-opened while the reactor
 *    runs and closed again while the shutdown factor is computed (a "closed"
 *    shield is a plain line-of-sight-blocking block with no shield module).
 *
 * Line references are to
 * `src/net/ncplanner/plannerator/multiblock/overhaul/fissionsfr/OverhaulSFR.java`
 * at the R0 freeze.
 *
 * Deliberate divergences (see `docs/r1/d1-decision.md`):
 *  - the irradiator branch carries the same width guard as its sister branch, so
 *    the `OverhaulSFR.java:1024` NPE class cannot occur here (D1 option B);
 *  - `stats().shutdownFactor` is defined on `[0, 1]` with `totalOutput === 0 → 0`.
 *    `statsRaw()` still exposes the unnormalized value so the old behaviour
 *    stays observable (and testable).
 */

export interface SfrStats {
  functionalBlocks: number;
  missingCasings: number;
  netHeat: number;
  numControllers: number;
  offOutput: number;
  rawOutput: number;
  shutdownFactor: number;
  sparsityMult: number;
  totalCooling: number;
  totalEfficiency: number;
  totalFuelCells: number;
  totalHeat: number;
  totalHeatMult: number;
  totalIrradiation: number;
  totalOutput: number;
}

export interface SfrCoolantRecipe {
  readonly heat: number;
  readonly ratio: number;
}

export class SfrBlock {
  template: SfrTemplate;
  fuel: SfrFuel | null = null;
  irradiatorRecipe: SfrIrradiatorRecipe | null = null;
  hasPropogated = false;
  moderatorLines = 0;
  neutronFlux = 0;
  positionalEfficiency = 0;
  moderatorValid = false;
  moderatorActive = false;
  heatsinkValid = false;
  reflectorActive = false;
  shieldActive = false;
  efficiency = 0;
  wasActive = false;
  hadFlux = 0;
  cluster: Cluster | null = null;
  source: SfrBlock | null = null;
  casingValid = false;

  constructor(
    readonly pos: Pos,
    template: SfrTemplate,
  ) {
    this.template = template;
  }

  /** Java `Block.clearData()`. */
  clearData(): void {
    this.hasPropogated = false;
    this.positionalEfficiency = 0;
    this.efficiency = 0;
    this.moderatorLines = 0;
    this.neutronFlux = 0;
    this.wasActive = false;
    this.moderatorValid = false;
    this.moderatorActive = false;
    this.heatsinkValid = false;
    this.reflectorActive = false;
    this.shieldActive = false;
    this.casingValid = false;
    this.cluster = null;
    this.source = null;
  }

  isFuelCell(): boolean {
    return this.template.fuelCell;
  }
  isModerator(): boolean {
    return this.template.moderator !== null;
  }
  isReflector(): boolean {
    return this.template.reflector !== null;
  }
  isIrradiator(): boolean {
    return this.template.irradiator;
  }
  isShield(): boolean {
    return this.template.neutronShield !== null;
  }
  isHeatsink(): boolean {
    return this.template.heatsink !== null;
  }
  isConductor(): boolean {
    return this.template.conductor;
  }
  isNeutronSource(): boolean {
    return this.template.neutronSource !== null;
  }
  isController(): boolean {
    return this.template.controller;
  }
  isCasing(): boolean {
    return isCasing(this.template);
  }
  isPrimed(): boolean {
    if (!this.isFuelCell()) return false;
    if (this.fuel !== null && this.fuel.stats.selfPriming) return true;
    return this.source !== null;
  }
  isFuelCellActive(): boolean {
    if (this.fuel === null) return false;
    return this.isFuelCell() && this.neutronFlux >= this.fuel.stats.criticality;
  }
  isModeratorActive(): boolean {
    return this.isModerator() && this.moderatorActive;
  }
  isHeatsinkActive(): boolean {
    return this.isHeatsink() && this.heatsinkValid;
  }
  isIrradiatorActive(): boolean {
    if (this.irradiatorRecipe === null) return false;
    return this.isIrradiator() && this.neutronFlux > 0;
  }
  isShieldActive(): boolean {
    return this.isShield() && this.shieldActive && this.moderatorValid;
  }
  /** Java `Block.isActive()`. */
  isActive(): boolean {
    return (
      this.isConductor() ||
      this.isModeratorActive() ||
      this.isFuelCellActive() ||
      this.isHeatsinkActive() ||
      this.isIrradiatorActive() ||
      this.reflectorActive ||
      this.isShieldActive() ||
      this.casingValid
    );
  }
  /** Java `Block.canCluster()`. */
  canCluster(): boolean {
    return (
      this.isConductor() ||
      (this.isActive() &&
        (this.isFuelCell() || this.isIrradiator() || this.isHeatsink() || this.isShield()))
    );
  }
  /** Java `Block.isFunctional()`. */
  isFunctional(): boolean {
    if (this.canCluster() && (this.cluster === null || !this.cluster.isCreated())) return false;
    return (
      (this.isFuelCell() ||
        this.isModerator() ||
        this.isReflector() ||
        this.isIrradiator() ||
        this.isHeatsink() ||
        this.isShield()) &&
      (this.isActive() || this.moderatorValid)
    );
  }
  /** Java `Block.isToggled()`. */
  isToggled(): boolean {
    return this.template.unToggled !== null;
  }
  /** Java `Block.setToggled(boolean)`. */
  setToggled(toggled: boolean): void {
    if (toggled === this.isToggled()) return;
    const next = toggled ? this.template.toggled : this.template.unToggled;
    if (next === null) {
      throw new Error(`Block ${this.template.identity} is not toggleable`);
    }
    this.template = next;
  }
  /** Java `Block.getRules()` — from the heat sink module. */
  getRules(): readonly PlacementRule[] {
    return this.template.heatsink?.rules ?? [];
  }
  /** `RuleBlock` bridge: the placement-rule evaluator reads these. */
  get definition(): NCPFElementDefinition {
    return this.template.element.definition;
  }
  get modules(): { modules: RawModules } {
    return { modules: this.template.element.modules };
  }
}

export class Cluster {
  readonly blocks: SfrBlock[] = [];
  isConnectedToWall = false;
  totalOutput = 0;
  efficiency = 0;
  totalHeat = 0;
  totalCooling = 0;
  netHeat = 0;
  heatMult = 0;
  coolingPenaltyMult = 0;
  irradiation = 0;

  constructor(reactor: OverhaulSfrReactor, block: SfrBlock) {
    this.blocks.push(...reactor.clusterBlocks(block, false));
    this.isConnectedToWall = reactor.wallCheck(this.blocks);
    if (!this.isConnectedToWall) {
      this.isConnectedToWall = reactor.wallCheck(reactor.clusterBlocks(block, true));
    }
    for (const b of this.blocks) b.cluster = this;
  }

  isCreated(): boolean {
    for (const b of this.blocks) if (createsCluster(b.template)) return true;
    return false;
  }
  contains(block: SfrBlock): boolean {
    return this.blocks.includes(block);
  }
  isValid(): boolean {
    return this.isConnectedToWall && this.isCreated();
  }
}

export class OverhaulSfrReactor {
  readonly config: SfrConfig;
  readonly grid: CuboidGrid<SfrBlock>;
  private allBlocks: SfrBlock[] = [];
  readonly coolantRecipe: SfrCoolantRecipe;

  clusters: Cluster[] = [];
  totalFuelCells = 0;
  rawOutput = 0;
  totalOutput = 0;
  totalCooling = 0;
  totalHeat = 0;
  netHeat = 0;
  totalEfficiency = 0;
  totalHeatMult = 0;
  totalIrradiation = 0;
  functionalBlocks = 0;
  sparsityMult = 0;
  /** Unnormalized Java value (`NaN` when there is no output). */
  shutdownFactorRaw = 0;
  offOutput = 0;

  private numControllers = 0;
  private missingCasings = 0;
  private shieldsWere = new Map<SfrBlock, boolean>();
  private cellsWereActive = new Set<SfrBlock>();

  constructor(
    config: SfrConfig,
    width: number,
    height: number,
    depth: number,
    coolantRecipe: SfrCoolantRecipe,
  ) {
    this.config = config;
    this.grid = new CuboidGrid<SfrBlock>(width, height, depth);
    this.coolantRecipe = coolantRecipe;
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
  getBlock(p: Pos): SfrBlock | null | undefined {
    return this.grid.get(p);
  }
  setBlock(p: Pos, b: SfrBlock | null): void {
    this.grid.set(p, b);
  }
  /** Java `Multiblock.getBlocks()` — all non-air blocks in x,y,z order. */
  getBlocks(): SfrBlock[] {
    return this.allBlocks;
  }

  // -------------------------------------------------------------------------
  // calculation
  // -------------------------------------------------------------------------

  /** Java `Multiblock.recalculate()` with `addDecals = false`. */
  recalculate(): void {
    this.allBlocks = this.grid.blocks();
    this.clearData();
    // `OverhaulSFR.validate()` returns false: no-op.
    this.calculate();
  }

  /** Java `Multiblock.clearData` + `OverhaulSFR.clearData`. */
  private clearData(): void {
    for (const b of this.allBlocks) b.clearData();
    this.clusters = [];
    this.shutdownFactorRaw = 0;
    this.totalOutput = 0;
    this.totalEfficiency = 0;
    this.totalHeatMult = 0;
    this.sparsityMult = 0;
    this.totalFuelCells = 0;
    this.rawOutput = 0;
    this.totalCooling = 0;
    this.totalHeat = 0;
    this.netHeat = 0;
    this.totalIrradiation = 0;
    this.functionalBlocks = 0;
    // NOTE: Java `clearData` deliberately leaves `offOutput` alone — it carries
    // the shutdown-phase output into the partial-shutdown phase.
  }

  private calculate(): void {
    // ---- base pass (Java cases 0..9) ----
    this.calcCasing();
    this.openShields();
    this.propagatePass(false, true);
    this.repropagateLoop(false);
    this.postFluxPass();
    this.heatsinkLoop();
    this.initCells();
    this.buildClusters();
    this.calcClusters();
    this.calcStats();

    // ---- shutdown pass (Java cases 10..19) ----
    this.cellsWereActive.clear();
    for (const b of this.allBlocks) if (b.isFuelCellActive()) this.cellsWereActive.add(b);
    this.clearData();
    this.calcCasing();
    this.closeShields();
    this.propagatePass(true, true);
    this.repropagateLoop(true);
    this.postFluxPass();
    this.heatsinkLoop();
    this.initCells();
    this.buildClusters();
    this.calcClusters();
    this.calcStats();
    this.offOutput = this.totalOutput;

    // ---- partial shutdown pass (Java cases 20..29) ----
    this.clearData();
    this.calcCasing();
    for (const [block, toggled] of this.shieldsWere) block.setToggled(toggled);
    this.propagatePass(true, true);
    this.repropagateLoop(true);
    this.postFluxPass();
    this.heatsinkLoop();
    this.initCells();
    this.buildClusters();
    this.calcClusters();
    this.calcStats();

    // Java: shutdownFactor = 1-(offOutput/totalOutput)
    this.shutdownFactorRaw = fsub(1, fdiv(this.offOutput, this.totalOutput));
  }

  /** Java case 0 / 10 / 20 — casing scan. */
  private calcCasing(): void {
    this.numControllers = 0;
    this.missingCasings = 0;
    this.grid.forEachCasingPosition((p) => {
      const block = this.grid.get(p) ?? null;
      if (block === null || !block.isCasing()) {
        this.missingCasings++;
      }
      if (block !== null && block.isCasing()) {
        if (block.isController()) this.numControllers++;
        if (block.template.neutronSource !== null) {
          let hasTarget = false;
          for (const d of DIRECTION_VECTORS) {
            for (let i = 1; ; i++) {
              if (!this.contains(offsetDir(block.pos, d, i))) break;
              const b = this.grid.get(offsetDir(block.pos, d, i)) ?? null;
              if (b === null) continue; // air
              if (b.template.fuelCell) {
                hasTarget = true;
                b.source = block;
              }
              if (blocksLOS(b.template)) break;
            }
          }
          if (!hasTarget) return; // Java `return` exits the lambda: casingValid is not set
        }
        block.casingValid = true;
      }
    });
  }

  /** Java case 1. */
  private openShields(): void {
    this.shieldsWere = new Map();
    this.cellsWereActive = new Set();
    for (const block of this.allBlocks) {
      if (block.template.neutronShield !== null) {
        this.shieldsWere.set(block, block.isToggled());
        block.setToggled(false);
      }
    }
  }

  /** Java case 11. */
  private closeShields(): void {
    for (const block of this.allBlocks) {
      if (block.template.neutronShield !== null) block.setToggled(true);
    }
  }

  /** Java case 2 / 12 / 22 — one pass over every block. */
  private propagatePass(useActiveSubset: boolean, initial: boolean): void {
    for (const block of this.allBlocks) {
      const force = useActiveSubset && this.cellsWereActive.has(block);
      this.propagate(block, force, initial);
    }
  }

  /** Java case 3 / 13 / 23 — repeat until the active cell count is stable. */
  private repropagateLoop(useActiveSubset: boolean): void {
    for (let guard = 0; guard < 10_000; guard++) {
      let lastActive = 0;
      for (const block of this.allBlocks) {
        const wasActive = block.isFuelCellActive();
        block.hadFlux = block.neutronFlux;
        const source = block.source;
        if (
          block.isFuelCell() ||
          block.isModerator() ||
          block.isShield() ||
          block.isReflector() ||
          block.isIrradiator()
        ) {
          block.clearData();
        }
        block.source = source;
        if (wasActive) lastActive++;
        block.wasActive = wasActive;
      }
      for (const block of this.allBlocks) {
        const force = useActiveSubset && this.cellsWereActive.has(block);
        this.propagate(block, force, false);
      }
      let nowActive = 0;
      for (const block of this.allBlocks) {
        if (block.isFuelCellActive()) nowActive++;
        if (block.isFuelCell() && !block.wasActive) block.neutronFlux = block.hadFlux;
      }
      if (nowActive !== lastActive) continue;
      return;
    }
    throw new Error('Calculation overflow: flux re-propagation did not converge');
  }

  /** Java case 4 / 14 / 24. */
  private postFluxPass(): void {
    for (const block of this.allBlocks) if (block.isFuelCell()) this.postFluxCalc(block);
  }

  /** Java case 5 / 15 / 25 — repeat until no heat sink changes state. */
  private heatsinkLoop(): void {
    for (let guard = 0; guard < 10_000; guard++) {
      let somethingChanged = false;
      for (const block of this.allBlocks) {
        if (this.calculateHeatsink(block)) somethingChanged = true;
      }
      if (!somethingChanged) return;
    }
    throw new Error('Calculation overflow: heat sink validation did not converge');
  }

  /** Java case 6 / 16 / 26. */
  private initCells(): void {
    for (const block of this.allBlocks) {
      if (block.isFuelCell() && block.fuel !== null) {
        // (float)(1/(1+MathUtil.exp(2*(neutronFlux-2*criticality))))
        const criticalityModifier = d2f(
          1 / (1 + jexp(2 * (block.neutronFlux - 2 * block.fuel.stats.criticality))),
        );
        const sourceEfficiency =
          block.source === null ? 1 : (block.source.template.neutronSource?.efficiency ?? 1);
        block.efficiency = fmul(
          fmul(fmul(block.fuel.stats.efficiency, block.positionalEfficiency), sourceEfficiency),
          criticalityModifier,
        );
      }
    }
  }

  /** Java case 7 / 17 / 27. */
  private buildClusters(): void {
    for (const block of this.allBlocks) {
      const cluster = this.getCluster(block);
      if (cluster === null) continue;
      if (this.clusters.includes(cluster)) continue;
      this.clusters.push(cluster);
    }
  }

  /** Java `getCluster(Block)`. */
  getCluster(block: SfrBlock | null): Cluster | null {
    if (block === null) return null;
    if (!block.canCluster()) return null;
    for (const cluster of this.clusters) if (cluster.contains(block)) return cluster;
    return new Cluster(this, block);
  }

  /** Java case 8 / 18 / 28 — per-cluster statistics. */
  private calcClusters(): void {
    for (const cluster of this.clusters) {
      let fuelCells = 0;
      for (const b of cluster.blocks) {
        if (b.isFuelCellActive() && b.fuel !== null) {
          fuelCells++;
          cluster.totalOutput = fadd(cluster.totalOutput, fmul(b.fuel.stats.heat, b.efficiency));
          cluster.efficiency = fadd(cluster.efficiency, b.efficiency);
          cluster.totalHeat += b.moderatorLines * b.fuel.stats.heat;
          cluster.heatMult = fadd(cluster.heatMult, b.moderatorLines);
        }
        if (b.isHeatsinkActive() && b.template.heatsink !== null) {
          cluster.totalCooling += b.template.heatsink.cooling;
        }
        if (b.isShieldActive() && b.template.neutronShield !== null) {
          const shield = b.template.neutronShield;
          cluster.totalOutput = fadd(
            cluster.totalOutput,
            fmul(shield.heatPerFlux * b.neutronFlux, shield.efficiency),
          );
          cluster.totalHeat += shield.heatPerFlux * b.neutronFlux;
        }
        if (b.isIrradiatorActive() && b.irradiatorRecipe !== null) {
          cluster.irradiation += b.neutronFlux;
          cluster.totalHeat = intAccumulateFloat(
            cluster.totalHeat,
            fmul(b.irradiatorRecipe.stats.heat, b.neutronFlux),
          );
        }
      }
      cluster.efficiency = fdiv(cluster.efficiency, fuelCells);
      cluster.heatMult = fdiv(cluster.heatMult, fuelCells);
      if (Number.isNaN(cluster.efficiency)) cluster.efficiency = 0;
      if (Number.isNaN(cluster.heatMult)) cluster.heatMult = 0;
      cluster.netHeat = cluster.totalHeat - cluster.totalCooling;
      if (cluster.totalCooling === 0) cluster.coolingPenaltyMult = 1;
      else {
        // Java `Math.min(1, (totalHeat+leniency)/(float)totalCooling)`: the
        // division is float, the min resolves to the float overload.
        const raw = fdiv(
          cluster.totalHeat + this.config.settings.coolingEfficiencyLeniency,
          cluster.totalCooling,
        );
        cluster.coolingPenaltyMult = f(Math.min(1, raw));
      }
      cluster.efficiency = fmul(cluster.efficiency, cluster.coolingPenaltyMult);
      cluster.totalOutput = fmul(cluster.totalOutput, cluster.coolingPenaltyMult);

      this.totalFuelCells += fuelCells;
      // Java `rawOutput += cluster.totalOutput` with rawOutput an int: the sum is
      // computed in float and narrowed.
      this.rawOutput = intAccumulateFloat(this.rawOutput, cluster.totalOutput);
      this.totalOutput = fadd(this.totalOutput, cluster.totalOutput);
      this.totalCooling += cluster.totalCooling;
      this.totalHeat += cluster.totalHeat;
      this.netHeat += cluster.netHeat;
      this.totalEfficiency = fadd(this.totalEfficiency, fmul(cluster.efficiency, fuelCells));
      this.totalHeatMult = fadd(this.totalHeatMult, fmul(cluster.heatMult, fuelCells));
      this.totalIrradiation += cluster.irradiation;
    }
  }

  /** Java case 9 / 19 / 29 — aggregate statistics. */
  private calcStats(): void {
    this.totalEfficiency = fdiv(this.totalEfficiency, this.totalFuelCells);
    this.totalHeatMult = fdiv(this.totalHeatMult, this.totalFuelCells);
    if (Number.isNaN(this.totalEfficiency)) this.totalEfficiency = 0;
    if (Number.isNaN(this.totalHeatMult)) this.totalHeatMult = 0;
    this.functionalBlocks = 0;
    for (const block of this.allBlocks) if (block.isFunctional()) this.functionalBlocks++;
    const volume = this.internalVolume();
    const settings = this.config.settings;
    if (fdiv(this.functionalBlocks, volume) >= settings.sparsityPenaltyThreshold) {
      this.sparsityMult = 1;
    } else {
      // Java evaluates the else-branch in double and casts the result to float;
      // `(1 - multiplier)` and `2*volume*threshold` are float expressions.
      const inverse = fsub(1, settings.sparsityPenaltyMultiplier);
      const period = fmul(2 * volume, settings.sparsityPenaltyThreshold);
      const angle = (Math.PI * this.functionalBlocks) / period;
      this.sparsityMult = d2f(settings.sparsityPenaltyMultiplier + inverse * Math.sin(angle));
    }
    this.totalOutput = fmul(this.totalOutput, this.sparsityMult);
    this.totalEfficiency = fmul(this.totalEfficiency, this.sparsityMult);
    this.totalOutput = fdiv(this.totalOutput, fdiv(this.coolantRecipe.heat, this.coolantRecipe.ratio));
  }

  // -------------------------------------------------------------------------
  // flux
  // -------------------------------------------------------------------------

  /** Java `propogateNeutronFlux`. */
  propagate(that: SfrBlock, force: boolean, initialPropogation: boolean): void {
    if (!that.isFuelCell()) return;
    if (that.fuel === null) return;
    if (!initialPropogation && !that.wasActive) return;
    if (!force && !that.isPrimed() && that.neutronFlux < that.fuel.stats.criticality) return;
    if (that.hasPropogated) return;
    that.hasPropogated = true;
    const reach = this.config.settings.neutronReach;
    const halfReach = Math.trunc(reach / 2);
    for (const d of DIRECTION_VECTORS) {
      let flux = 0;
      let length = 0;
      let efficiency = 0;
      for (let i = 1; i <= reach + 1; i++) {
        if (!this.contains(offsetDir(that.pos, d, i))) break;
        const block = this.grid.get(offsetDir(that.pos, d, i)) ?? null;
        if (block === null) break;
        if (block.isModerator() && block.template.moderator !== null) {
          flux += block.template.moderator.flux;
          efficiency = fadd(efficiency, block.template.moderator.efficiency);
          length++;
          continue;
        }
        if (block.isShield() && block.template.neutronShield !== null) {
          efficiency = fadd(efficiency, block.template.neutronShield.efficiency);
          length++;
          continue;
        }
        if (block.isFuelCell()) {
          if (length === 0) break;
          if (block.fuel === null) break;
          block.neutronFlux += flux;
          block.moderatorLines++;
          if (flux > 0) {
            block.positionalEfficiency = fadd(block.positionalEfficiency, fdiv(efficiency, length));
          }
          this.propagate(block, false, initialPropogation);
          break;
        }
        if (block.isReflector() && block.template.reflector !== null) {
          if (length === 0) break;
          if (length > halfReach) break;
          // int += float
          that.neutronFlux = intAccumulateFloat(
            that.neutronFlux,
            fmul(flux * 2, block.template.reflector.reflectivity),
          );
          if (flux > 0) {
            that.positionalEfficiency = fadd(
              that.positionalEfficiency,
              fmul(fdiv(efficiency, length), block.template.reflector.efficiency),
            );
          }
          that.moderatorLines++;
          break;
        }
        if (block.isIrradiator()) {
          // D1 option B: the frozen engine dereferences `moderator` here without
          // a guard (OverhaulSFR.java:1024) and throws; this port cannot.
          if (length === 0) break;
          if (block.irradiatorRecipe === null) break;
          that.moderatorLines++;
          if (flux > 0) {
            that.positionalEfficiency = fadd(
              that.positionalEfficiency,
              fmul(fdiv(efficiency, length), block.irradiatorRecipe.stats.efficiency),
            );
          }
          break;
        }
        break;
      }
    }
  }

  /** Java `postFluxCalc`. */
  postFluxCalc(that: SfrBlock): void {
    if (!that.isFuelCellActive()) return;
    if (that.fuel === null) return;
    const reach = this.config.settings.neutronReach;
    const halfReach = Math.trunc(reach / 2);
    for (const d of DIRECTION_VECTORS) {
      let flux = 0;
      let length = 0;
      const shieldFluxes = new Map<SfrBlock, number>();
      const toActivate: SfrBlock[] = [];
      const toValidate: SfrBlock[] = [];
      for (let i = 1; i <= reach + 1; i++) {
        if (!this.contains(offsetDir(that.pos, d, i))) break;
        const block = this.grid.get(offsetDir(that.pos, d, i)) ?? null;
        if (block === null) break;
        let skip = false;
        if (block.isModerator() && block.template.moderator !== null) {
          length++;
          flux += block.template.moderator.flux;
          if (i === 1) toActivate.push(block);
          toValidate.push(block);
          skip = true;
        }
        if (block.isShield() && block.template.neutronShield !== null) {
          length++;
          if (i === 1) toActivate.push(block);
          toValidate.push(block);
          block.shieldActive = true;
          shieldFluxes.set(block, flux);
          skip = true;
        }
        if (skip) continue;
        if (block.isFuelCellActive()) {
          if (length === 0) break;
          if (block.fuel === null) break;
          for (const [b, fv] of shieldFluxes) b.neutronFlux += fv;
          for (const b of toActivate) b.moderatorActive = true;
          for (const b of toValidate) b.moderatorValid = true;
          break;
        }
        if (block.isReflector() && block.template.reflector !== null) {
          if (length === 0) break;
          if (length > halfReach) break;
          block.reflectorActive = true;
          const mult = fadd(1, block.template.reflector.reflectivity);
          for (const [b] of shieldFluxes) {
            b.neutronFlux = intAccumulateFloat(b.neutronFlux, fmul(flux, mult));
          }
          for (const b of toActivate) b.moderatorActive = true;
          for (const b of toValidate) b.moderatorValid = true;
          break;
        }
        if (block.isIrradiator()) {
          if (length === 0) break;
          if (block.irradiatorRecipe === null) break;
          for (const [b, fv] of shieldFluxes) b.neutronFlux += fv;
          block.neutronFlux += flux;
          for (const b of toActivate) b.moderatorActive = true;
          for (const b of toValidate) b.moderatorValid = true;
          break;
        }
        break;
      }
    }
    that.hasPropogated = true;
  }

  /** Java `calculateHeatsink`; returns true when the validity changed. */
  calculateHeatsink(block: SfrBlock): boolean {
    if (!block.isHeatsink()) return false;
    const wasValid = block.heatsinkValid;
    for (const rule of block.getRules()) {
      if (!this.ruleIsValid(rule, block)) {
        block.heatsinkValid = false;
        return wasValid !== block.heatsinkValid;
      }
    }
    block.heatsinkValid = true;
    return wasValid !== block.heatsinkValid;
  }

  /** Java `NCPFPlacementRule.isValid` — shared implementation (`../rules.ts`). */
  ruleIsValid(rule: PlacementRule, block: SfrBlock): boolean {
    return placementRuleIsValid(rule, block, this.ruleGrid);
  }

  private readonly ruleGrid: RuleGrid<SfrBlock> = {
    contains: (p) => this.contains(p),
    blockAt: (p) => this.getBlock(p),
  };

  // -------------------------------------------------------------------------
  // clusters
  // -------------------------------------------------------------------------

  /** Java `Cluster.wallCheck`. */
  wallCheck(blocks: readonly SfrBlock[]): boolean {
    for (const block of blocks) {
      const { x, y, z } = block.pos;
      if (x === 1 || y === 1 || z === 1) return true;
      if (x === this.width || y === this.height || z === this.depth) return true;
    }
    return false;
  }

  /** Java `getClusterBlocks` — layered flood fill; layers flattened in order. */
  clusterBlocks(start: SfrBlock, useConductors: boolean): SfrBlock[] {
    const results = new Map<number, SfrBlock[]>();
    const zero: SfrBlock[] = [];
    if (start.canCluster() || (useConductors && start.isConductor())) zero.push(start);
    results.set(0, zero);
    const maxDistance = this.internalVolume();
    for (let i = 0; i < maxDistance; i++) {
      const layer: SfrBlock[] = [];
      const lastLayer = [...(results.get(i) ?? [])];
      if (i === 0 && lastLayer.length === 0) lastLayer.push(start);
      for (const block of lastLayer) {
        for (const d of DIRECTION_VECTORS) {
          const np = offsetDir(block.pos, d);
          if (!this.contains(np)) continue;
          const newBlock = this.grid.get(np) ?? null;
          if (newBlock === null) continue;
          if (!(newBlock.canCluster() || (useConductors && newBlock.isConductor()))) continue;
          if (lastLayer.includes(newBlock)) continue;
          if (i > 0 && (results.get(i - 1) ?? []).includes(newBlock)) continue;
          if (layer.includes(newBlock)) continue;
          layer.push(newBlock);
        }
      }
      if (layer.length === 0) break;
      results.set(i + 1, layer);
    }
    const list: SfrBlock[] = [];
    for (const key of [...results.keys()].sort((a, b) => a - b)) list.push(...(results.get(key) ?? []));
    return list;
  }

  /** The golden value: every numeric field the Java reflection dump captured. */
  statsRaw(): SfrStats {
    return {
      functionalBlocks: this.functionalBlocks,
      missingCasings: this.missingCasings,
      netHeat: this.netHeat,
      numControllers: this.numControllers,
      offOutput: this.offOutput,
      rawOutput: this.rawOutput,
      shutdownFactor: this.shutdownFactorRaw,
      sparsityMult: this.sparsityMult,
      totalCooling: this.totalCooling,
      totalEfficiency: this.totalEfficiency,
      totalFuelCells: this.totalFuelCells,
      totalHeat: this.totalHeat,
      totalHeatMult: this.totalHeatMult,
      totalIrradiation: this.totalIrradiation,
      totalOutput: this.totalOutput,
    };
  }

  /** Statistics with the R1 defined domain applied (`shutdownFactor ∈ [0,1]`). */
  stats(): SfrStats {
    const raw = this.statsRaw();
    raw.shutdownFactor = normalizeShutdownFactor(raw.shutdownFactor, raw.totalOutput);
    return raw;
  }
}

/** R1 definition: a NaN/out-of-range `shutdownFactor` is not a value. */
export function normalizeShutdownFactor(raw: number, totalOutput: number): number {
  if (totalOutput === 0) return 0;
  if (!Number.isFinite(raw)) return 0;
  if (raw < 0) return 0;
  if (raw > 1) return 1;
  return raw;
}

export { buildSfrConfig, type SfrConfig };
