import {
  type NCPFElementDefinition,
  type PlacementRule,
  type RawModules,
} from '@ncplanner/ncpf';
import { CuboidGrid, DIRECTION_VECTORS, offsetDir, type Pos } from '../geometry.js';
import {
  msrBlocksLOS,
  msrCreatesCluster,
  msrIsCasing,
  buildMsrConfig,
  type MsrConfig,
  type MsrElementStack,
  type MsrFuel,
  type MsrHeaterRecipe,
  type MsrIrradiatorRecipe,
  type MsrTemplate,
} from './config.js';
import { d2f, fadd, fdiv, fmul, fsub, intAccumulateFloat, jexp } from '../float.js';
import { placementRuleIsValid, type RuleGrid } from '../rules.js';

/**
 * `net.ncplanner.plannerator.multiblock.overhaul.fissionmsr.OverhaulMSR` — the
 * single Overhaul MSR physics kernel.
 *
 * The port is *behavioural*, not stylistic. It reproduces the frozen editor
 * engine's
 *
 *  - block scan order (x, then y, then z) — `float` sums depend on it;
 *  - `Direction.values()` order (PX, PY, PZ, NX, NY, NZ);
 *  - three-phase calculation (base → shutdown → partial shutdown);
 *  - iteration-to-fixpoint loops (flux re-propagation per vessel group, heater
 *    rule validation);
 *  - `float` rounding at every intermediate step (see `../float.ts`);
 *  - shield toggling: opened for the base pass, closed for the shutdown pass,
 *    restored for the partial-shutdown pass.
 *
 * Line references are to
 * `src/net/ncplanner/plannerator/multiblock/overhaul/fissionmsr/OverhaulMSR.java`
 * at the R0 freeze.
 *
 * Deliberate divergences from the frozen Java (documented in
 * `docs/r1/r1.6-msr-turbine.md`):
 *  - `totalIrradiation` is summed exactly as Java does, but Java never folds it
 *    into any output, so the golden value is what the sum says (irradiator
 *    recipes in the shipped MSR configuration all have `heat = 0`).
 *  - `totalOutput` (the per-output stack accumulation, Java `ArrayList<NCPFElementStack>`)
 *    is carried for completeness; `totalTotalOutput` is the compared quantity.
 */

export interface MsrStats {
  totalFuelVessels: number;
  totalCooling: number;
  totalHeat: number;
  netHeat: number;
  totalEfficiency: number;
  totalHeatMult: number;
  totalIrradiation: number;
  functionalBlocks: number;
  sparsityMult: number;
  totalTotalOutput: number;
  shutdownFactor: number;
  offOutput: number;
  numControllers: number;
  missingCasings: number;
}

export class MsrBlock {
  template: MsrTemplate;
  fuel: MsrFuel | null = null;
  irradiatorRecipe: MsrIrradiatorRecipe | null = null;
  heaterRecipe: MsrHeaterRecipe | null = null;
  hasPropogated = false;
  neutronFlux = 0;
  moderatorValid = false;
  moderatorActive = false;
  heaterValid = false;
  reflectorActive = false;
  shieldActive = false;
  /** Java `float`. */
  efficiency = 0;
  cluster: MsrCluster | null = null;
  vesselGroup: MsrVesselGroup | null = null;
  source: MsrBlock | null = null;
  casingValid = false;

  constructor(
    readonly pos: Pos,
    template: MsrTemplate,
  ) {
    this.template = template;
  }

  /** Java `Block.clearData()` (`fissionmsr/Block.java:58`). */
  clearData(): void {
    this.hasPropogated = false;
    this.efficiency = 0;
    this.neutronFlux = 0;
    this.moderatorValid = false;
    this.moderatorActive = false;
    this.heaterValid = false;
    this.reflectorActive = false;
    this.shieldActive = false;
    this.casingValid = false;
    this.cluster = null;
    this.source = null;
    // NOTE: Java deliberately does not clear `vesselGroup` here (the field is
    // owned by `VesselGroup.clearData` / the group-building step).
  }

  isFuelVessel(): boolean {
    return this.template.fuelVessel;
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
  isHeater(): boolean {
    return this.template.heater !== null;
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
    return msrIsCasing(this.template);
  }
  /** Java `Block.isPrimed()`. */
  isPrimed(): boolean {
    if (!this.isFuelVessel()) return false;
    if (this.fuel !== null && this.fuel.stats.selfPriming) return true;
    return this.source !== null;
  }
  /** Java `Block.isFuelVesselActive()`. */
  isFuelVesselActive(): boolean {
    if (this.fuel === null) return false;
    if (!this.isFuelVessel()) return false;
    const group = this.vesselGroup;
    if (group === null) return false;
    return group.neutronFlux >= group.criticality;
  }
  isModeratorActive(): boolean {
    return this.isModerator() && this.moderatorActive;
  }
  isHeaterActive(): boolean {
    if (this.heaterRecipe === null) return false;
    return this.isHeater() && this.heaterValid;
  }
  isIrradiatorActive(): boolean {
    if (this.irradiatorRecipe === null) return false;
    return this.isIrradiator() && this.neutronFlux > 0;
  }
  isShieldActive(): boolean {
    return this.isShield() && this.shieldActive && this.moderatorValid;
  }
  /** Java `Block.isActive()` (`fissionmsr/Block.java:171`). */
  isActive(): boolean {
    return (
      this.isConductor() ||
      this.isModeratorActive() ||
      this.isFuelVesselActive() ||
      this.isHeaterActive() ||
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
        (this.isFuelVessel() || this.isIrradiator() || this.isHeater() || this.isShield()))
    );
  }
  /** Java `Block.isFunctional()` (`fissionmsr/Block.java:220`). */
  isFunctional(): boolean {
    if (this.canCluster() && (this.cluster === null || !this.cluster.isCreated())) return false;
    return (
      (this.isFuelVessel() ||
        this.isModerator() ||
        this.isReflector() ||
        this.isIrradiator() ||
        this.isHeater() ||
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
  /**
   * Java `AbstractBlock.getRules()`: the template's `BlockRulesModule` wins,
   * otherwise the active recipe's.
   */
  getRules(): readonly PlacementRule[] {
    if (this.template.heater !== null) return this.template.heater.rules;
    if (this.template.irradiator && this.irradiatorRecipe !== null) {
      return this.irradiatorRecipe.rules;
    }
    return [];
  }
  /** `RuleBlock` bridge: the placement-rule evaluator reads these. */
  get definition(): NCPFElementDefinition {
    return this.template.element.definition;
  }
  get modules(): { modules: RawModules } {
    return { modules: this.template.element.modules };
  }
}

export class MsrCluster {
  readonly blocks: MsrBlock[] = [];
  isConnectedToWall = false;
  /** Java `float`. */
  efficiency = 0;
  totalHeat = 0;
  totalCooling = 0;
  netHeat = 0;
  /** Java `float`. */
  heatMult = 0;
  /** Java `float`. */
  coolingPenaltyMult = 0;
  irradiation = 0;

  constructor(reactor: OverhaulMsrReactor, block: MsrBlock) {
    this.blocks.push(...reactor.clusterBlocks(block, false));
    this.isConnectedToWall = reactor.wallCheck(this.blocks);
    if (!this.isConnectedToWall) {
      this.isConnectedToWall = reactor.wallCheck(reactor.clusterBlocks(block, true));
    }
    for (const b of this.blocks) b.cluster = this;
  }

  isCreated(): boolean {
    for (const b of this.blocks) if (msrCreatesCluster(b.template)) return true;
    return false;
  }
  isValid(): boolean {
    return this.isConnectedToWall && this.isCreated();
  }
  contains(block: MsrBlock): boolean {
    return this.blocks.includes(block);
  }
}

/**
 * Java `OverhaulMSR.VesselGroup` — the fuel-vessel bunch. It owns the neutron
 * flux, the criticality and the moderator-line bookkeeping; the blocks only own
 * their own `efficiency`.
 */
export class MsrVesselGroup {
  readonly blocks: MsrBlock[] = [];
  criticality = 0;
  neutronFlux = 0;
  moderatorLines = 0;
  /** Java `float`. */
  positionalEfficiency = 0;
  hadFlux = 0;
  wasActive = false;
  openFaces = -1;

  constructor(reactor: OverhaulMsrReactor, block: MsrBlock) {
    this.blocks.push(...reactor.vesselGroupBlocks(block));
    let fuelCriticality = 0;
    for (const b of this.blocks) {
      b.vesselGroup = this;
      if (b.fuel === null) continue;
      fuelCriticality = b.fuel.stats.criticality;
    }
    this.criticality = fuelCriticality * this.getSurfaceFactor();
  }

  contains(block: MsrBlock): boolean {
    return this.blocks.includes(block);
  }
  size(): number {
    return this.blocks.length;
  }
  /** Java `VesselGroup.getOpenFaces()` — cached in `openFaces`. */
  getOpenFaces(): number {
    if (this.openFaces === -1) {
      let open = 0;
      for (const b1 of this.blocks) {
        DIRECTION: for (const d of DIRECTION_VECTORS) {
          const p = offsetDir(b1.pos, d);
          for (const b2 of this.blocks) {
            if (b2.pos.x === p.x && b2.pos.y === p.y && b2.pos.z === p.z) continue DIRECTION;
          }
          open++;
        }
      }
      this.openFaces = open;
    }
    return this.openFaces;
  }
  /** Java `VesselGroup.getBunchingFactor()` — integer division, widened to float. */
  getBunchingFactor(): number {
    return (6 * this.size()) / this.getOpenFaces();
  }
  /** Java `VesselGroup.getSurfaceFactor()` — integer division. */
  getSurfaceFactor(): number {
    return Math.trunc(this.getOpenFaces() / 6);
  }
  /** Java `VesselGroup.getHeatMult()` (`float * float`). */
  getHeatMult(): number {
    return fmul(this.moderatorLines, this.getBunchingFactor());
  }
  isActive(): boolean {
    return this.neutronFlux >= this.criticality;
  }
  /** Java `VesselGroup.getSources()`. */
  getSources(): number {
    let sources = 0;
    for (const b of this.blocks) if (b.isPrimed()) sources++;
    return sources;
  }
  /** Java `VesselGroup.getRequiredSources()`. */
  getRequiredSources(): number {
    return this.getSurfaceFactor();
  }
  isPrimed(): boolean {
    return this.getSources() >= this.getRequiredSources();
  }
  /** Java `VesselGroup.clearData()`. */
  clearData(): void {
    for (const b of this.blocks) b.clearData();
    this.openFaces = -1;
    this.wasActive = false;
    this.neutronFlux = 0;
    this.positionalEfficiency = 0;
    this.moderatorLines = 0;
  }
}

export class OverhaulMsrReactor {
  readonly config: MsrConfig;
  readonly grid: CuboidGrid<MsrBlock>;
  private allBlocks: MsrBlock[] = [];

  clusters: MsrCluster[] = [];
  vesselGroups: MsrVesselGroup[] = [];

  totalFuelVessels = 0;
  totalCooling = 0;
  totalHeat = 0;
  netHeat = 0;
  /** Java `float`. */
  totalEfficiency = 0;
  /** Java `float`. */
  totalHeatMult = 0;
  totalIrradiation = 0;
  functionalBlocks = 0;
  /** Java `float`. */
  sparsityMult = 0;
  totalOutput: MsrElementStack[] = [];
  /** Java `float`. */
  totalTotalOutput = 0;
  /** Java `float`; the R1 domain-normalized value is exposed through `stats()`. */
  shutdownFactorRaw = 0;

  private numControllers = 0;
  private missingCasings = 0;
  private offOutput = 0;
  private shieldsWere = new Map<MsrBlock, boolean>();
  private vesselGroupsWereActive = new Set<MsrVesselGroup>();

  constructor(config: MsrConfig, width: number, height: number, depth: number) {
    this.config = config;
    this.grid = new CuboidGrid<MsrBlock>(width, height, depth);
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
  getBlock(p: Pos): MsrBlock | null | undefined {
    return this.grid.get(p);
  }
  setBlock(p: Pos, b: MsrBlock | null): void {
    this.grid.set(p, b);
  }
  /** Java `Multiblock.getBlocks()` — all non-air blocks in x,y,z order. */
  getBlocks(): MsrBlock[] {
    return this.allBlocks;
  }

  // -------------------------------------------------------------------------
  // calculation
  // -------------------------------------------------------------------------

  /**
   * Java `Multiblock.recalculate()` with `addDecals = false`.
   *
   * Java's `recalculate` calls `clearData(blocks)` and then the state machine
   * calls `clearData(allBlocks)` again in cases 11 and 22; the double clear is
   * idempotent, so this port performs it once per phase (`ShutdownClear` /
   * `PartialShutdownClear`).
   */
  recalculate(): void {
    this.allBlocks = this.grid.blocks();
    this.clearData();
    this.calculate();
  }

  /**
   * Java `Multiblock.clearData` + `OverhaulMSR.clearData`
   * (`OverhaulMSR.java:1630`).
   *
   * `offOutput` is deliberately **not** reset here. The field list that *is*
   * reset matters: `totalTotalOutput` is zeroed in every phase, so the
   * shutdown pass accumulates its own total (captured into `offOutput` by case
   * 21) and the partial-shutdown pass accumulates a fresh one, which is what
   * `shutdownFactor = 1-(offOutput/totalTotalOutput)` compares.
   */
  private clearData(): void {
    for (const b of this.allBlocks) b.clearData();
    this.clusters = [];
    this.vesselGroups = [];
    this.totalOutput = [];
    this.shutdownFactorRaw = 0;
    this.totalTotalOutput = 0;
    this.totalEfficiency = 0;
    this.totalHeatMult = 0;
    this.sparsityMult = 0;
    this.totalFuelVessels = 0;
    this.totalCooling = 0;
    this.totalHeat = 0;
    this.netHeat = 0;
    this.totalIrradiation = 0;
    this.functionalBlocks = 0;
  }

  /** Java `doCalculationStep` cases 0..10, run to completion. */
  private calculate(): void {
    // ---- base pass (Java cases 0..10) ----
    this.calcCasing();
    this.openShields();
    this.buildGroups();
    this.propagateGroups(false, true);
    this.repropagateGroups(false);
    this.postFluxPass();
    this.heaterLoop();
    this.initVessels();
    this.buildClusters();
    this.calcClusters();
    this.calcStats();

    // ---- shutdown pass (Java cases 11..21) ----
    this.vesselGroupsWereActive.clear();
    for (const group of this.vesselGroups) if (group.isActive()) this.vesselGroupsWereActive.add(group);
    this.clearData();
    this.calcCasing();
    this.closeShields();
    this.buildGroups();
    this.propagateGroups(true, true);
    this.repropagateGroups(true);
    this.postFluxPass();
    this.heaterLoop();
    this.initVessels();
    this.buildClusters();
    this.calcClusters();
    this.calcStats();
    this.offOutput = this.totalTotalOutput;

    // ---- partial shutdown pass (Java cases 22..32) ----
    this.clearData();
    this.calcCasing();
    for (const [block, toggled] of this.shieldsWere) block.setToggled(toggled);
    this.buildGroups();
    this.propagateGroups(true, true);
    this.repropagateGroups(true);
    this.postFluxPass();
    this.heaterLoop();
    this.initVessels();
    this.buildClusters();
    this.calcClusters();
    this.calcStats();

    // Java: shutdownFactor = 1-(offOutput/totalTotalOutput)
    this.shutdownFactorRaw = fsub(1, fdiv(this.offOutput, this.totalTotalOutput));
  }

  /** Java case 0 / 11 / 22 — casing scan (identical in all three phases). */
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
              if (b.template.fuelVessel) {
                hasTarget = true;
                b.source = block;
              }
              if (msrBlocksLOS(b.template)) break;
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
    this.vesselGroupsWereActive = new Set();
    for (const block of this.allBlocks) {
      if (block.template.neutronShield !== null) {
        this.shieldsWere.set(block, block.isToggled());
        block.setToggled(false);
      }
    }
  }

  /** Java case 12. */
  private closeShields(): void {
    for (const block of this.allBlocks) {
      if (block.template.neutronShield !== null) block.setToggled(true);
    }
  }

  /** Java case 2 / 13 / 24 — vessel-group discovery, in `allBlocks` order. */
  private buildGroups(): void {
    this.vesselGroups = [];
    for (const b of this.allBlocks) b.vesselGroup = null;
    for (const block of this.allBlocks) {
      const group = this.getVesselGroup(block);
      if (group === null) continue;
      if (this.vesselGroups.includes(group)) continue;
      this.vesselGroups.push(group);
    }
  }

  /** Java `getVesselGroup(Block)`. */
  getVesselGroup(block: MsrBlock | null): MsrVesselGroup | null {
    if (block === null) return null;
    if (!block.isFuelVessel()) return null;
    for (const group of this.vesselGroups) if (group.contains(block)) return group;
    return new MsrVesselGroup(this, block);
  }

  /** Java case 3 / 14 / 25 — one pass over every vessel group. */
  private propagateGroups(useActiveSubset: boolean, initial: boolean): void {
    for (const group of this.vesselGroups) {
      const force = useActiveSubset && this.vesselGroupsWereActive.has(group);
      this.propagateGroup(group, force, initial);
    }
  }

  /** Java `propogateNeutronFlux(VesselGroup, …)`. */
  propagateGroup(group: MsrVesselGroup, force: boolean, initialPropogation: boolean): void {
    if (!initialPropogation && !group.wasActive) return;
    for (const b of [...group.blocks]) {
      this.propagate(b, force, initialPropogation);
    }
  }

  /** Java case 4 / 15 / 26 — repeat until the active vessel count is stable. */
  private repropagateGroups(useActiveSubset: boolean): void {
    for (let guard = 0; guard < 10_000; guard++) {
      let lastActive = 0;
      for (const group of this.vesselGroups) {
        const wasActive = group.isActive();
        group.hadFlux = group.neutronFlux;
        const sources = new Map<MsrBlock, MsrBlock | null>();
        for (const b of group.blocks) sources.set(b, b.source);
        group.clearData();
        for (const [b, source] of sources) b.source = source;
        if (wasActive) lastActive += group.size();
        group.wasActive = wasActive;
      }
      for (const group of this.vesselGroups) {
        const force = useActiveSubset && this.vesselGroupsWereActive.has(group);
        this.propagateGroup(group, force, false);
      }
      let nowActive = 0;
      for (const group of this.vesselGroups) {
        if (group.isActive()) nowActive += group.size();
        if (!group.wasActive) group.neutronFlux = group.hadFlux;
      }
      if (nowActive !== lastActive) continue;
      return;
    }
    throw new Error('Calculation overflow: flux re-propagation did not converge');
  }

  /** Java case 5 / 16 / 27. */
  private postFluxPass(): void {
    for (const block of this.allBlocks) if (block.isFuelVessel()) this.postFluxCalc(block);
  }

  /** Java case 6 / 17 / 28 — repeat until no heater changes state. */
  private heaterLoop(): void {
    for (let guard = 0; guard < 10_000; guard++) {
      let somethingChanged = false;
      for (const block of this.allBlocks) {
        if (this.calculateHeater(block)) somethingChanged = true;
      }
      if (!somethingChanged) return;
    }
    throw new Error('Calculation overflow: heater validation did not converge');
  }

  /** Java case 7 / 18 / 29. */
  private initVessels(): void {
    for (const group of this.vesselGroups) {
      group.positionalEfficiency = fmul(group.positionalEfficiency, group.getBunchingFactor());
      for (const block of group.blocks) {
        if (block.fuel === null) continue;
        // (float)(1/(1+MathUtil.exp(2*(group.neutronFlux-2*group.criticality))))
        const criticalityModifier = d2f(
          1 / (1 + jexp(2 * (group.neutronFlux - 2 * group.criticality))),
        );
        const sourceEfficiency =
          block.source === null ? 1 : (block.source.template.neutronSource?.efficiency ?? 1);
        // Java evaluates this as a chained float product: `a*b*c*d` narrows
        // after every `*` (JLS 15.17), so three `fmul`s.
        block.efficiency = fmul(
          fmul(fmul(block.fuel.stats.efficiency, group.positionalEfficiency), sourceEfficiency),
          criticalityModifier,
        );
      }
    }
  }

  /** Java case 8 / 19 / 30. */
  private buildClusters(): void {
    for (const block of this.allBlocks) {
      const cluster = this.getCluster(block);
      if (cluster === null) continue;
      if (this.clusters.includes(cluster)) continue;
      this.clusters.push(cluster);
    }
  }

  /** Java `getCluster(Block)`. */
  getCluster(block: MsrBlock | null): MsrCluster | null {
    if (block === null) return null;
    if (!block.canCluster()) return null;
    for (const cluster of this.clusters) if (cluster.contains(block)) return cluster;
    return new MsrCluster(this, block);
  }

  /** Java case 9 / 20 / 31 — per-cluster statistics. */
  private calcClusters(): void {
    for (const cluster of this.clusters) {
      let fuelVessels = 0;
      const alreadyProcessedGroups: MsrVesselGroup[] = [];
      for (const b of cluster.blocks) {
        if (b.isFuelVesselActive() && b.vesselGroup !== null && b.fuel !== null) {
          const group = b.vesselGroup;
          if (alreadyProcessedGroups.includes(group)) continue;
          alreadyProcessedGroups.push(group);
          fuelVessels += group.size();
          cluster.efficiency = fadd(cluster.efficiency, b.efficiency);
          // `moderatorLines * heat` is int*int = int, then `* bunchingFactor`
          // is float (Java widens the left product before the float multiply).
          cluster.totalHeat += fmul(fmul(group.moderatorLines, b.fuel.stats.heat), group.getBunchingFactor());
          cluster.heatMult = fadd(cluster.heatMult, group.getHeatMult());
        }
        if (b.isHeaterActive()) {
          cluster.totalCooling += b.heaterRecipe === null ? 0 : b.heaterRecipe.stats.cooling;
        }
        if (b.isShieldActive() && b.template.neutronShield !== null) {
          cluster.totalHeat += fmul(b.template.neutronShield.heatPerFlux, b.neutronFlux);
        }
        if (b.isIrradiatorActive() && b.irradiatorRecipe !== null) {
          cluster.irradiation += b.neutronFlux;
          cluster.totalHeat += fmul(b.irradiatorRecipe.stats.heat, b.neutronFlux);
        }
      }
      // Java: `cluster.efficiency /= fuelVessels` — a float division that yields
      // 0/0 = NaN when the cluster has no active vessel; normalized below.
      cluster.efficiency = fdiv(cluster.efficiency, fuelVessels);
      cluster.heatMult = fdiv(cluster.heatMult, fuelVessels);
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
        cluster.coolingPenaltyMult = d2f(Math.min(1, raw));
      }
      cluster.efficiency = fmul(cluster.efficiency, cluster.coolingPenaltyMult);

      this.totalFuelVessels += fuelVessels;
      this.totalCooling += cluster.totalCooling;
      this.totalHeat += cluster.totalHeat;
      this.netHeat += cluster.netHeat;
      this.totalEfficiency = fadd(this.totalEfficiency, fmul(cluster.efficiency, fuelVessels));
      this.totalHeatMult = fadd(this.totalHeatMult, fmul(cluster.heatMult, fuelVessels));
      this.totalIrradiation += cluster.irradiation;
      if (cluster.totalHeat === 0) cluster.isConnectedToWall = true;
    }
  }

  /** Java case 10 / 21 / 32 — aggregate statistics. */
  private calcStats(): void {
    this.totalEfficiency = fdiv(this.totalEfficiency, this.totalFuelVessels);
    this.totalHeatMult = fdiv(this.totalHeatMult, this.totalFuelVessels);
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
    this.totalEfficiency = fmul(this.totalEfficiency, this.sparsityMult);
    for (const c of this.clusters) {
      for (const b of c.blocks) {
        if (b.template.heater !== null && b.heaterRecipe !== null) {
          const out = fmul(c.efficiency, this.sparsityMult);
          const outputs = b.heaterRecipe.outputs;
          // Java only folds outputs into `totalOutput` for legacy *recipes*; a
          // plain legacy fluid has no in/out stacks (`OverhaulMSR.java:477`).
          if (outputs !== undefined) {
            for (const output of outputs) {
              const found = this.totalOutput.find((s) => s.identity === output.identity);
              if (found) found.amount = fadd(found.amount, fmul(out, output.amount));
              else this.totalOutput.push({ identity: output.identity, amount: output.amount });
            }
          }
          this.totalTotalOutput = fadd(this.totalTotalOutput, out);
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // flux
  // -------------------------------------------------------------------------

  /**
   * Java `propogateNeutronFlux(Block, …)`.
   *
   * Unlike SFR, the flux counters live on the **vessel group**, and the
   * recursion is group-level (`propogateNeutronFlux(group, …)`), which is why a
   * `hasPropogated` flag alone is not enough: the group pass is what terminates.
   */
  propagate(that: MsrBlock, force: boolean, initialPropogation: boolean): void {
    if (!that.isFuelVessel()) return;
    if (that.fuel === null) return;
    const group = that.vesselGroup;
    // Java dereferences `that.vesselGroup` unconditionally here (would throw).
    // A fuel vessel outside a group cannot occur after `buildGroups`, so this
    // guard is defensive only.
    if (group === null) return;
    if (!force && !group.isPrimed() && group.neutronFlux < group.criticality) return;
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
        if (block.isHeater()) {
          length++;
          continue;
        }
        if (block.isShield() && block.template.neutronShield !== null) {
          efficiency = fadd(efficiency, block.template.neutronShield.efficiency);
          length++;
          continue;
        }
        if (block.isFuelVessel()) {
          if (length === 0) break;
          if (block.fuel === null) break;
          const target = block.vesselGroup ?? group;
          target.neutronFlux += flux;
          target.moderatorLines++;
          if (flux > 0) {
            target.positionalEfficiency = fadd(
              target.positionalEfficiency,
              fdiv(efficiency, length),
            );
          }
          this.propagateGroup(target, false, initialPropogation);
          break;
        }
        if (block.isReflector() && block.template.reflector !== null) {
          if (length === 0) break;
          if (length > halfReach) break;
          // Java `int += float`: the product is computed in float, then narrowed.
          group.neutronFlux = intAccumulate(
            group.neutronFlux,
            fmul(flux * 2, block.template.reflector.reflectivity),
          );
          if (flux > 0) {
            group.positionalEfficiency = fadd(
              group.positionalEfficiency,
              fmul(fdiv(efficiency, length), block.template.reflector.efficiency),
            );
          }
          group.moderatorLines++;
          break;
        }
        if (block.isIrradiator()) {
          if (length === 0) break;
          if (block.irradiatorRecipe === null) break;
          group.moderatorLines++;
          if (flux > 0) {
            group.positionalEfficiency = fadd(
              group.positionalEfficiency,
              fmul(fdiv(efficiency, length), block.irradiatorRecipe.stats.efficiency),
            );
          }
          break;
        }
        break;
      }
    }
  }

  /** Java `postFluxCalc(Block, …)`. */
  postFluxCalc(that: MsrBlock): void {
    if (!that.isFuelVesselActive()) return;
    if (that.fuel === null) return;
    const reach = this.config.settings.neutronReach;
    const halfReach = Math.trunc(reach / 2);
    for (const d of DIRECTION_VECTORS) {
      let flux = 0;
      let length = 0;
      const shieldFluxes = new Map<MsrBlock, number>();
      const toActivate: MsrBlock[] = [];
      const toValidate: MsrBlock[] = [];
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
        if (block.isHeater()) {
          length++;
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
        if (block.isFuelVesselActive()) {
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
            b.neutronFlux = intAccumulate(b.neutronFlux, fmul(flux, mult));
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

  /**
   * Java `calculateHeater(Block, …)`; returns true when the validity changed.
   * Unlike SFR heat sinks this also short-circuits when the recipe is missing.
   */
  calculateHeater(block: MsrBlock): boolean {
    if (!block.isHeater()) return false;
    if (block.heaterRecipe === null) return false;
    const wasValid = block.heaterValid;
    for (const rule of block.getRules()) {
      if (!this.ruleIsValid(rule, block)) {
        block.heaterValid = false;
        return wasValid !== block.heaterValid;
      }
    }
    block.heaterValid = true;
    return wasValid !== block.heaterValid;
  }

  /** Java `NCPFPlacementRule.isValid` — shared implementation (`../rules.ts`). */
  ruleIsValid(rule: PlacementRule, block: MsrBlock): boolean {
    return placementRuleIsValid(rule, block, this.ruleGrid);
  }

  private readonly ruleGrid: RuleGrid<MsrBlock> = {
    contains: (p) => this.contains(p),
    blockAt: (p) => this.getBlock(p),
  };

  // -------------------------------------------------------------------------
  // clusters + vessel groups
  // -------------------------------------------------------------------------

  /** Java `Cluster.wallCheck`. */
  wallCheck(blocks: readonly MsrBlock[]): boolean {
    for (const block of blocks) {
      const { x, y, z } = block.pos;
      if (x === 1 || y === 1 || z === 1) return true;
      if (x === this.width || y === this.height || z === this.depth) return true;
    }
    return false;
  }

  /** Java `getClusterBlocks` — layered flood fill; layers flattened in order. */
  clusterBlocks(start: MsrBlock, useConductors: boolean): MsrBlock[] {
    const results = new Map<number, MsrBlock[]>();
    const zero: MsrBlock[] = [];
    if (start.canCluster() || (useConductors && start.isConductor())) zero.push(start);
    results.set(0, zero);
    const maxDistance = this.internalVolume();
    for (let i = 0; i < maxDistance; i++) {
      const layer: MsrBlock[] = [];
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
    const list: MsrBlock[] = [];
    for (const key of [...results.keys()].sort((a, b) => a - b)) list.push(...(results.get(key) ?? []));
    return list;
  }

  /**
   * Java `VesselGroup.getBlocks(Block)` — layered flood fill that additionally
   * requires the same template *and the same `Fuel` object* (`Block.isEqual` +
   * `newBlock.fuel == start.fuel`).
   */
  vesselGroupBlocks(start: MsrBlock): MsrBlock[] {
    const results = new Map<number, MsrBlock[]>();
    const zero: MsrBlock[] = [];
    if (start.isFuelVessel()) zero.push(start);
    results.set(0, zero);
    const maxDistance = this.internalVolume();
    for (let i = 0; i < maxDistance; i++) {
      const layer: MsrBlock[] = [];
      const lastLayer = [...(results.get(i) ?? [])];
      if (i === 0 && lastLayer.length === 0) lastLayer.push(start);
      for (const block of lastLayer) {
        FOR: for (const d of DIRECTION_VECTORS) {
          const np = offsetDir(block.pos, d);
          if (!this.contains(np)) continue;
          const newBlock = this.grid.get(np) ?? null;
          if (newBlock === null) continue;
          // Java `newBlock.isEqual(start)` → definition equality.
          if (
            !(
              newBlock.template.element.definition.identity ===
                start.template.element.definition.identity &&
              newBlock.template.element.definition.type === start.template.element.definition.type
            )
          ) {
            continue;
          }
          if (!newBlock.isFuelVessel() || newBlock.fuel !== start.fuel) continue;
          for (const oldbl of lastLayer) if (oldbl === newBlock) continue FOR;
          if (i > 0) for (const oldbl of results.get(i - 1) ?? []) if (oldbl === newBlock) continue FOR;
          for (const oldbl of layer) if (oldbl === newBlock) continue FOR;
          layer.push(newBlock);
        }
      }
      if (layer.length === 0) break;
      results.set(i + 1, layer);
    }
    const list: MsrBlock[] = [];
    for (const key of [...results.keys()].sort((a, b) => a - b)) list.push(...(results.get(key) ?? []));
    return list;
  }

  /** The golden value: every numeric field the Java reflection dump captured. */
  statsRaw(): MsrStats {
    return {
      totalFuelVessels: this.totalFuelVessels,
      totalCooling: this.totalCooling,
      totalHeat: this.totalHeat,
      netHeat: this.netHeat,
      totalEfficiency: this.totalEfficiency,
      totalHeatMult: this.totalHeatMult,
      totalIrradiation: this.totalIrradiation,
      functionalBlocks: this.functionalBlocks,
      sparsityMult: this.sparsityMult,
      totalTotalOutput: this.totalTotalOutput,
      shutdownFactor: this.shutdownFactorRaw,
      offOutput: this.offOutput,
      numControllers: this.numControllers,
      missingCasings: this.missingCasings,
    };
  }

  /** Statistics with the R1 defined domain applied (`shutdownFactor ∈ [0,1]`). */
  stats(): MsrStats {
    const raw = this.statsRaw();
    raw.shutdownFactor = normalizeMsrShutdownFactor(
      raw.shutdownFactor,
      raw.totalTotalOutput,
    );
    return raw;
  }
}

/** R1 definition: a NaN/out-of-range `shutdownFactor` is not a value. */
export function normalizeMsrShutdownFactor(raw: number, totalOutput: number): number {
  if (totalOutput === 0) return 0;
  if (!Number.isFinite(raw)) return 0;
  if (raw < 0) return 0;
  if (raw > 1) return 1;
  return raw;
}

/** Java narrowing `int += float` (see `docs/r1/float-fidelity.md` §3). */
const intAccumulate = intAccumulateFloat;

export { buildMsrConfig, type MsrConfig };
