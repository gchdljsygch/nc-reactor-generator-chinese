import type { NCPFElementDefinition, PlacementRule, RawModules } from '@ncplanner/ncpf';
import { CuboidGrid, DIRECTION_VECTORS, offsetDir, type Pos } from '../geometry.js';
import { d2f, fadd, fdiv } from '../float.js';
import { placementRuleIsValid, type RuleGrid } from '../rules.js';
import {
  buildTurbineConfig,
  type TurbineConfig,
  type TurbineRecipe,
  type TurbineTemplate,
} from './config.js';

/**
 * `net.ncplanner.plannerator.multiblock.overhaul.turbine.OverhaulTurbine` — the
 * single Overhaul Turbine physics kernel.
 *
 * The turbine is a single-shot calculation (no fixpoint loop except coil
 * validation) with three derived quantities:
 *
 *  - `bearingDiameter` — the largest even/odd bearing that spans the whole axis;
 *  - `blades[]` — one template per interior z slice, or `null` for an incomplete
 *    or heterogeneous slice (`rotorValid` is false if any slice is `null`);
 *  - `totalOutput` — `(long)(totalFluidEfficiency * getInputRate())`.
 *
 * Line references are to
 * `src/net/ncplanner/plannerator/multiblock/overhaul/turbine/OverhaulTurbine.java`
 * at the R0 freeze.
 *
 * Deliberate divergences from the frozen Java:
 *  - `getInputRate()` always returns `maxInput` (the frozen engine's body is
 *    `return maxInput;` with the "inputs" path commented out), which is why
 *    `throughputRatio` is 1 and `throughputEfficiencyMult` is 1 for every case
 *    in the golden dataset. Both are still computed faithfully.
 *  - the turbine's `doCopy`/`getCubeBounds`/`Suggestor` code is UI-only and is
 *    not ported (as with SFR).
 */

export interface TurbineStats {
  bearingDiameter: number;
  bladeCount: number;
  maxInput: number;
  maxUnsafeInput: number;
  rotorEfficiency: number;
  throughputEfficiency: number;
  idealityMultiplier: number;
  coilEfficiency: number;
  totalEfficiency: number;
  totalFluidEfficiency: number;
  totalOutput: number;
  safeOutput: number;
  unsafeOutput: number;
  numControllers: number;
  missingCasings: number;
}

export class TurbineBlock {
  valid = false;

  constructor(
    readonly pos: Pos,
    public template: TurbineTemplate,
  ) {}

  /** Java `Block.clearData()`. */
  clearData(): void {
    this.valid = false;
  }

  /** Java `Block.isValid()` / `Block.isActive()` — the same flag. */
  isValid(): boolean {
    return this.valid;
  }
  isActive(): boolean {
    return this.valid;
  }
  /** Java `Block.isBlade()`. */
  isBlade(): boolean {
    return this.template.blade !== null || this.template.stator !== null;
  }
  isBearing(): boolean {
    return this.template.bearing;
  }
  isCoil(): boolean {
    return this.template.coil !== null;
  }
  isConnector(): boolean {
    return this.template.connector !== null;
  }
  /** Java `Block.getRules()` — coil / connector rules. */
  getRules(): readonly PlacementRule[] {
    if (this.template.coil !== null) return this.template.coil.rules;
    if (this.template.connector !== null) return this.template.connector.rules;
    return [];
  }
  get definition(): NCPFElementDefinition {
    return this.template.element.definition;
  }
  get modules(): { modules: RawModules } {
    return { modules: this.template.element.modules };
  }
}

/** Enum-free re-implementation of `Object.is`-style template comparison. */
function sameTemplate(a: TurbineTemplate | null, b: TurbineTemplate | null): boolean {
  return a === b;
}

export class OverhaulTurbineReactor {
  readonly config: TurbineConfig;
  readonly grid: CuboidGrid<TurbineBlock>;
  private allBlocks: TurbineBlock[] = [];

  /** Java `OverhaulTurbine.recipe` (multiblock-level, defaults to `recipes[0]`). */
  recipe: TurbineRecipe | null;

  rotorValid = false;
  bladeCount = 0;
  /** Java `float`. */
  rotorEfficiency = 0;
  maxInput = 0;
  maxUnsafeInput = 0;
  /** Java `double`. */
  throughputEfficiency = 0;
  /** Java `double`. */
  idealityMultiplier = 0;
  /** Java `float`. */
  coilEfficiency = 0;
  /** Java `double`. */
  totalEfficiency = 0;
  /** Java `double`. */
  totalFluidEfficiency = 0;
  totalOutput = 0;
  safeOutput = 0;
  unsafeOutput = 0;
  /** Java `double[]`, exposed for tooling. */
  idealExpansion: number[] = [];
  /** Java `double[]`, exposed for tooling. */
  actualExpansion: number[] = [];
  bearingDiameter = 0;

  private hasInlet = false;
  private hasOutlet = false;
  private numControllers = 0;
  private missingCasings = 0;
  private blades: (TurbineTemplate | null)[] = [];
  private bladesComplete: boolean[] = [];

  constructor(
    config: TurbineConfig,
    width: number,
    height: number,
    depth: number,
    recipe: TurbineRecipe | null,
  ) {
    this.config = config;
    this.grid = new CuboidGrid<TurbineBlock>(width, height, depth);
    // Java: `recipe = recipe==null ? (exists() ? recipes.get(0) : null) : recipe`.
    this.recipe = recipe ?? config.recipes[0] ?? null;
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
  getBlock(p: Pos): TurbineBlock | null | undefined {
    return this.grid.get(p);
  }
  setBlock(p: Pos, b: TurbineBlock | null): void {
    this.grid.set(p, b);
  }
  /** Java `Multiblock.getBlocks()` — all non-air blocks in x,y,z order. */
  getBlocks(): TurbineBlock[] {
    return this.allBlocks;
  }

  /** Java `getMinBearingDiameter()`. */
  getMinBearingDiameter(): number {
    return this.width % 2 === 0 ? 2 : 1;
  }
  /** Java `getMaxBearingDiameter()`. */
  getMaxBearingDiameter(): number {
    return this.width - 2;
  }

  // -------------------------------------------------------------------------
  // calculation
  // -------------------------------------------------------------------------

  /** Java `Multiblock.recalculate()` with `addDecals = false`. */
  recalculate(): void {
    this.allBlocks = this.grid.blocks();
    this.clearData();
    this.calculate();
  }

  /** Java `Multiblock.clearData` + `OverhaulTurbine.clearData` (`:500`). */
  private clearData(): void {
    for (const b of this.allBlocks) b.clearData();
    this.rotorValid = false;
    this.bladeCount = 0;
    this.bearingDiameter = 0;
    this.idealityMultiplier = 0;
    this.throughputEfficiency = 0;
    this.totalEfficiency = 0;
    this.totalFluidEfficiency = 0;
    this.rotorEfficiency = 0;
    this.coilEfficiency = 0;
    this.totalOutput = 0;
    this.safeOutput = 0;
    this.unsafeOutput = 0;
    this.maxInput = 0;
    this.maxUnsafeInput = 0;
  }

  /** Java `doCalculationStep` cases 0..5, run to completion. */
  private calculate(): void {
    this.calcCasing();
    this.calcBearing();
    this.calcBlades();
    this.calcRotor();
    this.coilLoop();
    this.calcStats();
  }

  /** Java case 0 — casing scan. */
  private calcCasing(): void {
    this.numControllers = 0;
    this.missingCasings = 0;
    this.hasInlet = false;
    this.hasOutlet = false;
    this.grid.forEachCasingPosition((p) => {
      const block = this.grid.get(p) ?? null;
      if (block === null) {
        this.missingCasings++;
      }
      if (block !== null) {
        if (block.template.inlet) this.hasInlet = true;
        if (block.template.outlet) this.hasOutlet = true;
        if (block.template.controller) this.numControllers++;
        if (
          block.template.casing !== null ||
          block.template.inlet ||
          block.template.outlet ||
          block.template.controller
        ) {
          block.valid = true;
        }
      }
    });
  }

  /** Java case 1 — bearing. */
  private calcBearing(): void {
    const minBearingDiameter = this.getMinBearingDiameter();
    const maxBearingDiameter = this.getMaxBearingDiameter();
    const externalWidth = this.grid.externalWidth;
    const externalDepth = this.grid.externalDepth;
    let realToValidate: TurbineBlock[] = [];
    BEARING: for (let i = minBearingDiameter; i <= maxBearingDiameter; i += 2) {
      const toValidate: TurbineBlock[] = [];
      const bearingMin = Math.trunc(externalWidth / 2) - Math.trunc(i / 2);
      const bearingMax = Math.trunc(externalWidth / 2) + Math.trunc(i / 2) - (i % 2 === 0 ? 1 : 0);
      for (let x = bearingMin; x <= bearingMax; x++) {
        for (let y = bearingMin; y <= bearingMax; y++) {
          for (let z = 0; z < externalDepth; z++) {
            const block = this.grid.get({ x, y, z }) ?? null;
            const valid =
              block !== null &&
              (z === 0 || z === externalDepth - 1
                ? block.template.bearing
                : block.template.shaft);
            if (!valid) break BEARING;
            toValidate.push(block as TurbineBlock);
          }
        }
      }
      this.bearingDiameter = i;
      realToValidate = toValidate;
    }
    for (const b of realToValidate) b.valid = true;
  }

  /** Java case 2 — blades: one template per interior z slice. */
  private calcBlades(): void {
    const depth = this.depth;
    const externalWidth = this.grid.externalWidth;
    this.blades = new Array<TurbineTemplate | null>(depth).fill(null);
    this.bladesComplete = new Array<boolean>(depth).fill(false);
    const bearingMin = Math.trunc(externalWidth / 2) - Math.trunc(this.bearingDiameter / 2);
    const bearingMax =
      Math.trunc(externalWidth / 2) +
      Math.trunc(this.bearingDiameter / 2) -
      (this.bearingDiameter % 2 === 0 ? 1 : 0);
    for (let z = 1; z <= depth; z++) {
      let badBlade = false;
      let bladeIncomplete = false;
      const toValidate: TurbineBlock[] = [];
      for (let x = 1; x <= this.width; x++) {
        for (let y = 1; y <= this.height; y++) {
          const block = this.grid.get({ x, y, z }) ?? null;
          const xBlade = x >= bearingMin && x <= bearingMax;
          const yBlade = y >= bearingMin && y <= bearingMax;
          if (xBlade && yBlade) continue; // that's a bearing, already done
          if (!xBlade && !yBlade) continue;
          if (block === null) {
            bladeIncomplete = true;
          } else {
            toValidate.push(block);
            if (this.blades[z - 1] === null) this.blades[z - 1] = block.template;
            else if (!sameTemplate(this.blades[z - 1], block.template)) badBlade = true;
          }
        }
      }
      if (badBlade) this.blades[z - 1] = null;
      else for (const b of toValidate) b.valid = true;
      this.bladesComplete[z - 1] = !bladeIncomplete;
    }
  }

  /**
   * Java case 3 — rotor. Every intermediate here is Java-typed:
   * `rotorEfficiency` is `float`, `idealExpansion`/`actualExpansion`/
   * `expansionSoFar`/`throughputEfficiency`/`idealityMultiplier` are `double`.
   */
  private calcRotor(): void {
    this.rotorValid = true;
    this.bladeCount = 0;
    for (const blade of this.blades) {
      if (blade === null) this.rotorValid = false;
      else this.bladeCount++;
    }
    if (!this.rotorValid) return;
    const recipe = this.recipe;
    if (recipe === null) return;
    const settings = this.config.settings;
    const blades = this.blades;
    this.idealExpansion = new Array<number>(blades.length).fill(0);
    this.actualExpansion = new Array<number>(blades.length).fill(0);
    let expansionSoFar = 1;
    this.rotorEfficiency = 0;
    let minBladeExpansion = Number.MAX_VALUE;
    let maxBladeExpansion = 0;
    let minStatorExpansion = 1;
    let numBlades = 0;
    let numberOfBlades = 0;
    for (let i = 0; i < blades.length; i++) {
      const blade = blades[i] as TurbineTemplate;
      const expansion =
        blade.stator !== null
          ? blade.stator.expansion
          : (blade.blade?.expansion ?? 0);
      if (blade.stator !== null) {
        minStatorExpansion = Math.min(expansion, minStatorExpansion);
      } else {
        numberOfBlades++;
        // Java integer arithmetic: `bearingDiameter*4*(width/2 - bearingDiameter/2)`.
        numBlades +=
          this.bearingDiameter * 4 * (Math.trunc(this.width / 2) - Math.trunc(this.bearingDiameter / 2));
        minBladeExpansion = Math.min(expansion, minBladeExpansion);
        maxBladeExpansion = Math.max(expansion, maxBladeExpansion);
      }
      this.idealExpansion[i] = Math.pow(recipe.stats.coefficient, (i + 0.5) / blades.length);
      this.actualExpansion[i] = expansionSoFar * Math.sqrt(expansion);
      expansionSoFar *= expansion;
      const ratio = Math.min(
        this.actualExpansion[i] / this.idealExpansion[i],
        this.idealExpansion[i] / this.actualExpansion[i],
      );
      const bladeEfficiency = blade.blade === null ? 0 : blade.blade.efficiency;
      // Java: `rotorEfficiency += blade.efficiency * min(...)`. The product is
      // computed in `float` (both operands are float) and the compound
      // assignment narrows the sum, so `d2f(rotorEfficiency + product)`.
      // (`bladeEfficiency * ratio` is a double in JS; the operand is narrowed
      // first by `d2f` below to match Java's float multiply.)
      this.rotorEfficiency = d2f(
        this.rotorEfficiency + d2f(bladeEfficiency * d2f(ratio)),
      );
    }
    // Java `rotorEfficiency /= numberOfBlades` — a float division.
    this.rotorEfficiency = fdiv(this.rotorEfficiency, numberOfBlades);
    this.maxInput = numBlades * settings.fluidPerBlade;
    this.maxUnsafeInput = this.maxInput * 2;
    let effectiveMaxLength: number;
    if (minBladeExpansion <= 1 || minStatorExpansion >= 1) {
      effectiveMaxLength = settings.maxSize;
    } else {
      effectiveMaxLength = Math.ceil(
        Math.max(
          settings.minLength,
          Math.min(
            settings.maxSize,
            (Math.log(recipe.stats.coefficient) - settings.maxSize * Math.log(minStatorExpansion)) /
              (Math.log(minBladeExpansion) - Math.log(minStatorExpansion)),
          ),
        ),
      );
    }
    const bladeArea =
      this.bearingDiameter * 4 * (Math.trunc(this.width / 2) - Math.trunc(this.bearingDiameter / 2));
    const rate = Math.min(this.getInputRate(), this.maxInput);
    const lengthBonus =
      rate / (settings.fluidPerBlade * bladeArea * effectiveMaxLength);
    const areaBonus = Math.sqrt(
      (2 * rate) /
        (settings.fluidPerBlade * this.depth * settings.maxSize * effectiveMaxLength),
    );
    const effectiveMinLength =
      recipe.stats.coefficient <= 1 || maxBladeExpansion <= 1
        ? settings.maxSize
        : Math.ceil(Math.log(recipe.stats.coefficient) / Math.log(maxBladeExpansion));
    const minBladeArea = (settings.minWidth - 1) * 2;
    const absoluteLeniency = effectiveMinLength * minBladeArea * settings.fluidPerBlade;
    const throughputRatio =
      this.maxInput === 0 ? 1 : Math.min(1, (this.getInputRate() + absoluteLeniency) / this.maxInput);
    const throughputEfficiencyMult =
      throughputRatio >= settings.throughputEfficiencyLeniencyThreshold
        ? 1
        : (1 - settings.throughputEfficiencyLeniencyMultiplier) *
            Math.sin(
              (throughputRatio * Math.PI) / (2 * settings.throughputEfficiencyLeniencyThreshold),
            ) +
          settings.throughputEfficiencyLeniencyMultiplier;
    this.throughputEfficiency =
      (1 + settings.powerBonus * Math.pow(lengthBonus * areaBonus, 2 / 3)) *
      throughputEfficiencyMult;
    this.idealityMultiplier =
      Math.min(expansionSoFar, recipe.stats.coefficient) /
      Math.max(expansionSoFar, recipe.stats.coefficient);
  }

  /** Java `getInputRate()` — the frozen engine's inputs path is commented out. */
  getInputRate(): number {
    return this.maxInput;
  }

  /** Java case 4 — repeat until no coil changes state. */
  private coilLoop(): void {
    for (let guard = 0; guard < 10_000; guard++) {
      let somethingChanged = false;
      for (const block of this.allBlocks) {
        if (this.calculateCoil(block)) somethingChanged = true;
      }
      if (!somethingChanged) return;
    }
    throw new Error('Calculation overflow: coil validation did not converge');
  }

  /** Java `calculateCoil(Block, …)`; returns true when `valid` changed. */
  calculateCoil(block: TurbineBlock): boolean {
    if (!block.isCoil() && !block.isConnector()) return false;
    const wasValid = block.valid;
    let hasAny = false;
    for (const d of DIRECTION_VECTORS) {
      const p = offsetDir(block.pos, d);
      if (!this.contains(p)) continue;
      const b = this.grid.get(p) ?? null;
      if (b !== null && (b.isCoil() || b.isConnector() || b.isBearing()) && b.isValid()) {
        hasAny = true;
        break;
      }
    }
    if (!hasAny) {
      block.valid = false;
      return wasValid !== block.valid;
    }
    for (const rule of block.getRules()) {
      if (!this.ruleIsValid(rule, block)) {
        block.valid = false;
        return wasValid !== block.valid;
      }
    }
    block.valid = true;
    return wasValid !== block.valid;
  }

  /** Java `NCPFPlacementRule.isValid` — shared implementation (`../rules.ts`). */
  ruleIsValid(rule: PlacementRule, block: TurbineBlock): boolean {
    return placementRuleIsValid(rule, block, this.ruleGrid);
  }

  private readonly ruleGrid: RuleGrid<TurbineBlock> = {
    contains: (p) => this.contains(p),
    blockAt: (p) => this.getBlock(p),
  };

  /** Java case 5 — aggregate statistics. */
  private calcStats(): void {
    let inputEff = 0;
    let outputEff = 0;
    let inputCoils = 0;
    let outputCoils = 0;
    const externalDepth = this.grid.externalDepth;
    for (let x = 1; x <= this.width; x++) {
      for (let y = 1; y <= this.height; y++) {
        const input = this.grid.get({ x, y, z: 0 }) ?? null;
        if (input !== null && input.isCoil() && input.isActive() && input.template.coil !== null) {
          inputEff = fadd(inputEff, input.template.coil.efficiency);
          inputCoils++;
        }
        const output = this.grid.get({ x, y, z: externalDepth - 1 }) ?? null;
        if (
          output !== null &&
          output.isCoil() &&
          output.isActive() &&
          output.template.coil !== null
        ) {
          outputEff = fadd(outputEff, output.template.coil.efficiency);
          outputCoils++;
        }
      }
    }
    const bearings = this.bearingDiameter * this.bearingDiameter;
    inputEff = fdiv(inputEff, Math.max(inputCoils, Math.trunc(bearings / 2)));
    outputEff = fdiv(outputEff, Math.max(outputCoils, Math.trunc(bearings / 2)));
    if (Number.isNaN(inputEff)) inputEff = 0;
    if (Number.isNaN(outputEff)) outputEff = 0;
    this.coilEfficiency = fdiv(fadd(inputEff, outputEff), 2);
    this.totalEfficiency =
      this.coilEfficiency *
      this.rotorEfficiency *
      this.throughputEfficiency *
      this.idealityMultiplier;
    const power = this.recipe === null ? 0 : this.recipe.stats.power;
    this.totalFluidEfficiency = this.totalEfficiency * power;
    this.totalOutput = javaLong(this.totalFluidEfficiency * this.getInputRate());
    this.safeOutput = javaLong(this.totalFluidEfficiency * this.maxInput);
    this.unsafeOutput = javaLong(this.totalFluidEfficiency * this.maxUnsafeInput);
  }

  /** The golden value: every numeric field the Java reflection dump captured. */
  statsRaw(): TurbineStats {
    return {
      bearingDiameter: this.bearingDiameter,
      bladeCount: this.bladeCount,
      maxInput: this.maxInput,
      maxUnsafeInput: this.maxUnsafeInput,
      rotorEfficiency: this.rotorEfficiency,
      throughputEfficiency: this.throughputEfficiency,
      idealityMultiplier: this.idealityMultiplier,
      coilEfficiency: this.coilEfficiency,
      totalEfficiency: this.totalEfficiency,
      totalFluidEfficiency: this.totalFluidEfficiency,
      totalOutput: this.totalOutput,
      safeOutput: this.safeOutput,
      unsafeOutput: this.unsafeOutput,
      numControllers: this.numControllers,
      missingCasings: this.missingCasings,
    };
  }

  /**
   * Statistics with the R1 defined domain applied.
   *
   * The frozen engine divides by the blade count in `rotorEfficiency`, so a rotor
   * with **no blades** leaks `0.0f/0` → `NaN` into `rotorEfficiency`,
   * `totalEfficiency` and `totalFluidEfficiency` (17 of the 500 golden turbine
   * records; identified in `docs/r1/msr-turbine-goldens.md`). §3.1.5's rule —
   * "the old implementation's NaN is a defect, define the domain" — applies here
   * exactly as it does to `shutdownFactor`: a rotor with no blades has zero
   * efficiency, so a non-finite value becomes 0.
   *
   * Note what is deliberately **not** done: no clamping to `[0, 1]`.
   * `rotorEfficiency` is a weighted sum of blade efficiencies and legitimately
   * exceeds 1 in the golden data (up to 1.0957); clamping it would break 21
   * records. Only the undefined case is defined.
   *
   * `statsRaw()` keeps the unnormalized values so the old behaviour stays
   * observable, and the golden comparison skips `"NaN"` references, so this
   * cannot mask a physics error.
   */
  stats(): TurbineStats {
    const raw = this.statsRaw();
    if (!Number.isFinite(raw.rotorEfficiency)) raw.rotorEfficiency = 0;
    if (!Number.isFinite(raw.totalEfficiency)) raw.totalEfficiency = 0;
    if (!Number.isFinite(raw.totalFluidEfficiency)) raw.totalFluidEfficiency = 0;
    return raw;
  }
}

/** Java `(long)` of a `double`: round toward zero, saturating at the `long` bounds. */
function javaLong(v: number): number {
  if (Number.isNaN(v)) return 0;
  if (v >= 9223372036854775807) return 9223372036854775807;
  if (v <= -9223372036854775808) return -9223372036854775808;
  return Math.trunc(v);
}

export { buildTurbineConfig, type TurbineConfig };
