/**
 * LegacyNCPF **v9** reader — a port of
 * `src/net/ncplanner/plannerator/planner/file/reader/LegacyNCPF9Reader.java`
 * (744 lines; a bare `:NNN` below is a line of that frozen file).
 *
 * v9 is the oldest reader of the chain and the last-but-one encoding before the
 * "modern" configuration layout. Its blocks are plain `name` strings with a
 * fixed, small module set, and its recipes live in flat per-configuration lists
 * (`fuels`, `sources`, `irradiatorRecipes`, `coolantRecipes`, `breedingBlanketRecipes`)
 * instead of the per-block `recipes` list v10/v11 use. None of the later modules
 * (display names, `plannerator:legacy_names`, casing, controller, port, coolant
 * vent, recipe ports) exist yet — so most of the five `load*` overrides below
 * *drop* code relative to v11 rather than add any.
 *
 * Inherited unchanged: the header (`read`), the placement-rule readers
 * (`readUnderRule` &c. from `ncpf11.ts`), the design metadata pass and the whole
 * post-load step (`loadConfiguration` → `resolvePostLoadRules` →
 * `combineActiveCoolers` → `propagateRecipePortRecipes`). The multiblock readers
 * differ: v9 spells the dimensions `size` (three or four numbers) and its design
 * arrays are laid out differently, so all five are overridden here.
 *
 * ## Deliberate deviations from the frozen reader
 *
 * Every one of them is a place where the frozen reader cannot work at all; the
 * first two are what makes every `*-v1`…`*-v8` fixture in
 * `datasets/converted/MANIFEST.json` fail in Java.
 *
 *  1. **`configuration.settings` is never created** (`:306`, `:364`, `:464`,
 *     `:557`, `:626`). v11 does it first (`LegacyNCPF11Reader.java:626`) and v9
 *     does not, so the very first settings assignment throws
 *     `NullPointerException` — the manifest's
 *     `Cannot assign field "minSize" because "<local5>.settings" is null`.
 *     The port creates the settings module (with exactly the fields the Java
 *     line-by-line assignments name) and records a note.
 *  2. **Four of the five loaders forget `project.setConfiguration(configuration)`**
 *     (`:354` has it; `:456`, `:549`, `:618` and `:711` do not) and then read the
 *     configuration back out of the *project* (`:418`, `:440`, `:521`, `:543`,
 *     `:605`, `:679`), which throws `NullPointerException` on the unregistered
 *     configuration as well. The port writes the configuration into the container
 *     exactly like v11 (`LegacyNCPF11Reader.java:902`, `:1078`, `:1166`, `:1308`)
 *     and iterates the list it just built.
 *  3. **Flat lists are read with the generic `Config.get`** (`:344`, `:408`,
 *     `:424`, `:433`, `:446`, `:511`, `:527`, `:536`, `:565`, `:587`, `:609`,
 *     `:676`, `:690`, `:701`), so an absent key is a `null` list and `.size()` /
 *     `.getConfig(i)` throws. `asdf.ncpf` and `qwerty.ncpf` really do omit
 *     `coolantRecipes`; absent lists are read as empty here, with a note.
 *  4. **The SFR/MSR design loops dereference possibly-null cells** (`:138`,
 *     `:199`) while walking one cell past the interior on every axis — the last
 *     plane of a compact design is always empty, so Java throws
 *     `NullPointerException` for every SFR/MSR multiblock. v11 guards the same
 *     loop (`LegacyNCPF11Reader.java:222`); this port skips null cells and notes
 *     it.
 *  5. **The dead `allCoils`/`allBlades` loop** (`:603-608`) reads
 *     `project.getConfiguration(TURBINE)` — an unregistered configuration — and
 *     the two lists it fills are never used again. The loop is not ported.
 *  6. **`setBearing` / `setBlade`** (`:713-731`, `:732-743`) walk past the design
 *     array (`z < design[0][0].length+2`, `x <= design.length`), i.e. they throw
 *     `ArrayIndexOutOfBoundsException` whenever the turbine configuration has a
 *     shaft or a bearing block. A JS array would silently grow instead, so the
 *     out-of-range write is an explicit {@link LegacyFormatError}.
 *  7. **The fusion design reader** (`:272-280`, `:283-293`) indexes all three axes
 *     with `design.length` although `OverhaulFusionDesign` allocates
 *     `[width()][height()][width()]` and `width() > height()` always
 *     (`OverhaulFusionDesign.java:33`, `:65-70`) — every v9 fusion multiblock
 *     throws `ArrayIndexOutOfBoundsException` in Java. Like v11's fusion reader in
 *     `ncpf11.ts`, the index recoveries run first and the block pass throws.
 *  8. **`readBladeStator`** (`:57-59`) unboxes `config.get(name)`, i.e. a blade
 *     without a `stator` key is a `NullPointerException`; the port reads a strict
 *     boolean (`getBoolean`), which fails the same way on a malformed file.
 *  9. **`parseInputRate` / `parseOutputRate`** (`:42-47`) are never called
 *     anywhere in the frozen chain (only v8 overrides them); they are ported for
 *     completeness.
 *
 * Texture payloads are dropped on purpose: the golden run sets
 * `plannerator.skipTextures` (`Bootstrap.java`), so `loadNCPFTexture` never runs
 * and every `plannerator:texture` module stays `{}` — same treatment as the v11
 * port.
 */
import { ConfigObject } from '../config2.js';
import { isJsonObject, type JsonObject } from '../json.js';
import { LegacyFormatError } from './types.js';
import { LegacyNCPF10Reader } from './ncpf10.js';
import {
  blockIndices,
  configModules,
  createConfiguration,
  createDesignJson,
  definitionToString,
  elementList,
  elementStack,
  emptyCells,
  javaFloat,
  legacyBlockDefinition,
  legacyElementJson,
  legacyFluidDefinition,
  legacyItemDefinition,
  legacyRecipeDefinition,
  makeIntegerRatio,
  modulesOf,
  namedModules,
  numberList,
  requireList,
  requireObject,
  setModuleIfPresent,
  writeDesign,
  type Cell,
  type ProjectJson,
} from './ncpf11.js';

/** Configuration keys (`ncpf11.ts` keeps its copies module-private). */
const UH = 'nuclearcraft:underhaul_sfr';
const SFR = 'nuclearcraft:overhaul_sfr';
const MSR = 'nuclearcraft:overhaul_msr';
const TURBINE = 'nuclearcraft:overhaul_turbine';
const FUSION = 'plannerator:fusion_test';

/** `Direction.values()` (`Direction.java:2-8`) — also the tie-break order below. */
const DIRECTIONS: readonly (readonly [number, number, number])[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [-1, 0, 0],
  [0, -1, 0],
  [0, 0, -1],
];

/** A candidate cell for `addNeutronSource`, with the distance that ranks it. */
interface SourceCandidate {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly distance: number;
}

/** LegacyNCPF v9 — the old flat configuration layout with v10 placement rules. */
export class LegacyNCPF9Reader extends LegacyNCPF10Reader {
  override readonly name: string = 'LegacyNCPF9Reader';
  /** Mirrors `FileReader.formats`: v11, v10 and then this reader. */
  override readonly order: number = 3;

  /** Java `getTargetVersion` (`:37-40`). */
  protected override getTargetVersion(): number {
    return 9;
  }

  /** Java `parseInputRate` (`:42-44`) — declared but never called in the chain. */
  protected parseInputRate(blockCfg: ConfigObject): number {
    return blockCfg.getInt('inputRate', 0);
  }

  /** Java `parseOutputRate` (`:45-47`) — declared but never called in the chain. */
  protected parseOutputRate(blockCfg: ConfigObject): number {
    return blockCfg.getInt('outputRate', 0);
  }

  /**
   * Java `loadTurbineEfficiencyFactors` (`:49-52`). Java writes the two fields
   * into the (null) settings module; the values are returned instead so the v6
   * override can replace them with its constants.
   */
  protected loadTurbineEfficiencyFactors(turbine: ConfigObject): { multiplier: number; threshold: number } {
    return {
      multiplier: javaFloat(turbine.getFloat('throughputEfficiencyLeniencyMult')),
      threshold: javaFloat(turbine.getFloat('throughputEfficiencyLeniencyThreshold')),
    };
  }

  /** Java `readOutputRatio` (`:54-56`). */
  protected readOutputRatio(config: ConfigObject, name: string): number {
    return config.getFloat(name);
  }

  /**
   * Java `readBladeStator` (`:57-59`). The `blade` argument is unused by both
   * overrides (v3 switches on `expansion` instead), so it is dropped.
   */
  protected readBladeStator(config: ConfigObject, name: string): boolean {
    return config.getBoolean(name);
  }

  // ------------------------------------------------------------------ helpers

  /**
   * `Config.get(String)` on a missing key is `null` in Java, and every flat list
   * of this reader goes through it (see deviation 3). "Absent" therefore means
   * "empty list" here — and gets recorded, because Java would throw.
   */
  private readList(config: ConfigObject, key: string, where: string): ConfigObject[] {
    if (!config.hasProperty(key)) {
      this.notes.push(`${where}: no "${key}" list (Java throws NullPointerException); read as empty`);
      return [];
    }
    return requireList(config, key);
  }

  /** `configuration.settings.…` — deviation 1. */
  private settingsModule(label: string, configKey: string, module: JsonObject): JsonObject {
    this.notes.push(
      `${label}: Java writes into a null \`configuration.settings\` (NullPointerException); ` +
        `the \`${configKey}_configuration_settings\` module was created instead`,
    );
    return module;
  }

  /** `design[x][y][z]` with the JVM's bounds behaviour (deviation 6). */
  private cellAt(cells: Cell[][][], x: number, y: number, z: number): Cell {
    const plane: Cell[][] | undefined = cells[x];
    const row: Cell[] | undefined = plane === undefined ? undefined : plane[y];
    if (row === undefined || z < 0 || z >= row.length) {
      throw new LegacyFormatError(
        `design[${x}][${y}][${z}] is outside the design — Java throws ArrayIndexOutOfBoundsException here`,
      );
    }
    return row[z] as Cell;
  }

  /** `design[x][y][z] = block` with the JVM's bounds behaviour (deviation 6). */
  private setCellAt(cells: Cell[][][], x: number, y: number, z: number, block: Cell): void {
    const plane: Cell[][] | undefined = cells[x];
    const row: Cell[] | undefined = plane === undefined ? undefined : plane[y];
    if (row === undefined || z < 0 || z >= row.length) {
      throw new LegacyFormatError(
        `design[${x}][${y}][${z}] is outside the design — Java throws ArrayIndexOutOfBoundsException here`,
      );
    }
    row[z] = block;
  }

  /** `MathUtil`-free Java int division (`/` truncates toward zero). */
  private static javaDiv(a: number, b: number): number {
    return Math.trunc(a / b);
  }

  /**
   * `RecoveryModeHandler.recoverOverhaulSFRBlockRecipeLegacyNCPF`
   * (`RecoveryModeHandler.java:38-53`): the list is the block's fuels, unless the
   * block is *also* an irradiator — then the irradiator recipes win, while the
   * `type` in the error message still comes from `fuelCell`. Java also re-points
   * `block` at `block.parent` first; the port has no `parent` (see
   * `recipeListsOf` in `ncpf11.ts`).
   */
  private sfrBlockRecipe(block: JsonObject, index: number): JsonObject {
    const modules = modulesOf(block);
    const lists = this.recipeListsOf(block);
    const fuelCell = modules[`${SFR}:fuel_cell`] !== undefined;
    const list = modules[`${SFR}:irradiator`] !== undefined ? lists.irradiators : fuelCell ? lists.fuels : [];
    return this.recoverElement(fuelCell ? 'fuel' : 'recipe', list, index);
  }

  /** `:59-77` — same shape as {@link sfrBlockRecipe}, with the heater list last. */
  private msrBlockRecipe(block: JsonObject, index: number): JsonObject {
    const modules = modulesOf(block);
    const lists = this.recipeListsOf(block);
    const fuelVessel = modules[`${MSR}:fuel_vessel`] !== undefined;
    let list: JsonObject[] = fuelVessel ? lists.fuels : [];
    if (modules[`${MSR}:irradiator`] !== undefined) list = lists.irradiators;
    if (modules[`${MSR}:heater`] !== undefined) list = lists.heaters;
    return this.recoverElement(fuelVessel ? 'fuel' : 'recipe', list, index);
  }

  /**
   * `LegacyNeutronSourceHandler.addNeutronSource` (`:9-41`): scan the six
   * directions from the fuel cell, remember the last air cell in front of
   * whatever stops the scan, and drop the source into the nearest candidate that
   * does not already hold one. Java collects the candidates in a
   * `HashMap<int[],Integer>` keyed by identity, so equidistant candidates come out
   * in an unspecified order; the `Direction` enum order breaks those ties here.
   */
  private addNeutronSource(
    cells: Cell[][][],
    x: number,
    y: number,
    z: number,
    source: JsonObject,
    sourceModule: string,
    isBlocker: (block: JsonObject) => boolean,
  ): void {
    const candidates: SourceCandidate[] = [];
    for (const [dx, dy, dz] of DIRECTIONS) {
      for (let i = 1; ; i++) {
        const cx = x + dx * i;
        const cy = y + dy * i;
        const cz = z + dz * i;
        if (
          cx < 0 ||
          cy < 0 ||
          cz < 0 ||
          cx >= cells.length ||
          cy >= cells[0]!.length ||
          cz >= cells[0]![0]!.length
        ) {
          candidates.push({ x: x + dx * (i - 1), y: y + dy * (i - 1), z: z + dz * (i - 1), distance: i });
          break;
        }
        const block = cells[cx]![cy]![cz];
        if (block === null) continue; // air
        if (isBlocker(block)) break;
      }
    }
    // `Collections.sort` is stable and so is `Array.prototype.sort`.
    candidates.sort((a, b) => a.distance - b.distance);
    for (const candidate of candidates) {
      const existing = cells[candidate.x]![candidate.y]![candidate.z];
      if (existing !== null && modulesOf(existing)[sourceModule] !== undefined) continue;
      cells[candidate.x]![candidate.y]![candidate.z] = source;
      break;
    }
  }

  // --------------------------------------------------------------- multiblocks

  /** Java `readMultiblockUnderhaulSFR` (`:61-93`). */
  protected override readMultiblockUnderhaulSFR(project: ProjectJson, data: ConfigObject): JsonObject {
    const size = numberList(data, 'size');
    const x = size.get(0);
    const y = size.get(1);
    const z = size.get(2);
    const design = createDesignJson(UH, [x + 2, y + 2, z + 2]);
    design.fuel = this.recoverIndex('fuel', this.conglomerate(project, UH, 'fuels'), data.getByte('fuel', -1));
    const blocks = this.conglomerate(project, UH, 'blocks');
    const blockIds = numberList(data, 'blocks');
    const cells = emptyCells(x + 2, y + 2, z + 2);
    if (data.getBoolean('compact')) {
      let index = 0;
      // Java walks `1 .. design.length-2`, i.e. the interior only (`:70-72`).
      for (let cx = 1; cx < x + 1; cx++) {
        for (let cy = 1; cy < y + 1; cy++) {
          for (let cz = 1; cz < z + 1; cz++) {
            const bid = blockIds.get(index);
            if (bid > 0) cells[cx]![cy]![cz] = this.recoverElement('block', blocks, bid - 1);
            index++;
          }
        }
      }
    } else {
      for (let j = 0; j < blockIds.size(); j += 4) {
        const cx = blockIds.get(j) + 1;
        const cy = blockIds.get(j + 1) + 1;
        const cz = blockIds.get(j + 2) + 1;
        cells[cx]![cy]![cz] = this.recoverElement('block', blocks, blockIds.get(j + 3) - 1);
      }
    }
    // The active-cooler recipe array is never filled (`UnderhaulSFRDesign.java:40`
    // only reads it back), so every recipe-bearing cell serialises as -1.
    writeDesign(design, cells, emptyCells(x + 2, y + 2, z + 2), blocks);
    return design;
  }

  /** Java `readMultiblockOverhaulSFR` (`:94-155`). */
  protected override readMultiblockOverhaulSFR(project: ProjectJson, data: ConfigObject): JsonObject {
    const size = numberList(data, 'size');
    const x = size.get(0);
    const y = size.get(1);
    const z = size.get(2);
    const design = createDesignJson(SFR, [x + 2, y + 2, z + 2]);
    design.coolant_recipe = this.recoverIndex(
      'coolant recipe',
      this.conglomerate(project, SFR, 'coolant_recipes'),
      data.getByte('coolantRecipe', -1),
    );
    const blocks = this.conglomerate(project, SFR, 'blocks');
    const blockIds = numberList(data, 'blocks');
    const cells = emptyCells(x + 2, y + 2, z + 2);
    if (data.getBoolean('compact')) {
      let index = 0;
      for (let cx = 1; cx < x + 1; cx++) {
        for (let cy = 1; cy < y + 1; cy++) {
          for (let cz = 1; cz < z + 1; cz++) {
            const bid = blockIds.get(index);
            if (bid > 0) cells[cx]![cy]![cz] = this.recoverElement('block', blocks, bid - 1);
            index++;
          }
        }
      }
    } else {
      for (let j = 0; j < blockIds.size(); j += 4) {
        const cx = blockIds.get(j) + 1;
        const cy = blockIds.get(j + 1) + 1;
        const cz = blockIds.get(j + 2) + 1;
        cells[cx]![cy]![cz] = this.recoverElement('block', blocks, blockIds.get(j + 3) - 1);
      }
    }
    const fuelIds = numberList(data, 'fuels');
    const sourceIds = numberList(data, 'sources');
    const irradiatorIds = numberList(data, 'irradiatorRecipes');
    let fuelIndex = 0;
    let sourceIndex = 0;
    let recipeIndex = 0;
    // `:131-134` — every block of the conglomeration that carries a neutron source.
    const sources = blocks.filter((block) => modulesOf(block)[`${SFR}:neutron_source`] !== undefined);
    const recipes = emptyCells(x + 2, y + 2, z + 2);
    // Java walks `1 .. design.length-1` (`:135-137`), which includes the (always
    // empty) far border plane — deviation 4.
    for (let cx = 1; cx < x + 2; cx++) {
      for (let cy = 1; cy < y + 2; cy++) {
        for (let cz = 1; cz < z + 2; cz++) {
          const block = cells[cx]![cy]![cz];
          if (block === null) continue;
          const modules = modulesOf(block);
          if (modules[`${SFR}:fuel_cell`] !== undefined) {
            // No `-1`, and no zero check: index 0 is the block's first fuel (`:140`).
            recipes[cx]![cy]![cz] = this.sfrBlockRecipe(block, fuelIds.get(fuelIndex));
            fuelIndex++;
            const sid = sourceIds.get(sourceIndex);
            if (sid > 0) {
              this.addNeutronSource(
                cells,
                cx,
                cy,
                cz,
                this.recoverElement('block', sources, sid - 1),
                `${SFR}:neutron_source`,
                (candidate) => {
                  const candidateModules = modulesOf(candidate);
                  return (
                    candidateModules[`${SFR}:fuel_cell`] !== undefined ||
                    candidateModules[`${SFR}:reflector`] !== undefined ||
                    candidateModules[`${SFR}:irradiator`] !== undefined
                  );
                },
              );
            }
            sourceIndex++;
          }
          if (modules[`${SFR}:irradiator`] !== undefined) {
            const rid = irradiatorIds.get(recipeIndex);
            if (rid > 0) recipes[cx]![cy]![cz] = this.sfrBlockRecipe(block, rid - 1);
            recipeIndex++;
          }
        }
      }
    }
    writeDesign(design, cells, recipes, blocks);
    return design;
  }

  /** Java `readMultiblockOverhaulMSR` (`:156-216`). */
  protected override readMultiblockOverhaulMSR(project: ProjectJson, data: ConfigObject): JsonObject {
    const size = numberList(data, 'size');
    const x = size.get(0);
    const y = size.get(1);
    const z = size.get(2);
    // v9 has no MSR coolant recipe: the reader never recovers one (`:157-159`).
    const design = createDesignJson(MSR, [x + 2, y + 2, z + 2]);
    const blocks = this.conglomerate(project, MSR, 'blocks');
    const blockIds = numberList(data, 'blocks');
    const cells = emptyCells(x + 2, y + 2, z + 2);
    if (data.getBoolean('compact')) {
      let index = 0;
      for (let cx = 1; cx < x + 1; cx++) {
        for (let cy = 1; cy < y + 1; cy++) {
          for (let cz = 1; cz < z + 1; cz++) {
            const bid = blockIds.get(index);
            if (bid > 0) cells[cx]![cy]![cz] = this.recoverElement('block', blocks, bid - 1);
            index++;
          }
        }
      }
    } else {
      for (let j = 0; j < blockIds.size(); j += 4) {
        const cx = blockIds.get(j) + 1;
        const cy = blockIds.get(j + 1) + 1;
        const cz = blockIds.get(j + 2) + 1;
        cells[cx]![cy]![cz] = this.recoverElement('block', blocks, blockIds.get(j + 3) - 1);
      }
    }
    const fuelIds = numberList(data, 'fuels');
    const sourceIds = numberList(data, 'sources');
    const irradiatorIds = numberList(data, 'irradiatorRecipes');
    let fuelIndex = 0;
    let sourceIndex = 0;
    let recipeIndex = 0;
    const sources = blocks.filter((block) => modulesOf(block)[`${MSR}:neutron_source`] !== undefined);
    const recipes = emptyCells(x + 2, y + 2, z + 2);
    for (let cx = 1; cx < x + 2; cx++) {
      for (let cy = 1; cy < y + 2; cy++) {
        for (let cz = 1; cz < z + 2; cz++) {
          const block = cells[cx]![cy]![cz];
          if (block === null) continue; // deviation 4
          const modules = modulesOf(block);
          if (modules[`${MSR}:fuel_vessel`] !== undefined) {
            recipes[cx]![cy]![cz] = this.msrBlockRecipe(block, fuelIds.get(fuelIndex));
            fuelIndex++;
            const sid = sourceIds.get(sourceIndex);
            if (sid > 0) {
              this.addNeutronSource(
                cells,
                cx,
                cy,
                cz,
                this.recoverElement('block', sources, sid - 1),
                `${MSR}:neutron_source`,
                (candidate) => {
                  const candidateModules = modulesOf(candidate);
                  return (
                    candidateModules[`${MSR}:fuel_vessel`] !== undefined ||
                    candidateModules[`${MSR}:reflector`] !== undefined ||
                    candidateModules[`${MSR}:irradiator`] !== undefined
                  );
                },
              );
            }
            sourceIndex++;
          }
          if (modules[`${MSR}:irradiator`] !== undefined) {
            const rid = irradiatorIds.get(recipeIndex);
            if (rid > 0) recipes[cx]![cy]![cz] = this.msrBlockRecipe(block, rid - 1);
            recipeIndex++;
          }
        }
      }
    }
    writeDesign(design, cells, recipes, blocks);
    return design;
  }

  /**
   * Java `readMultiblockOverhaulTurbine` (`:217-263`). The `externalDepth` local
   * (`:222`) is dead in Java and not ported.
   */
  protected override readMultiblockOverhaulTurbine(project: ProjectJson, data: ConfigObject): JsonObject {
    const size = numberList(data, 'size');
    const width = size.get(0);
    const depth = size.get(1);
    const bearingSize = size.get(2);
    const design = createDesignJson(TURBINE, [width + 2, width + 2, depth + 2]);
    design.recipe = this.recoverIndex(
      'recipe',
      this.conglomerate(project, TURBINE, 'recipes'),
      data.getByte('recipe', -1),
    );
    const blocks = this.conglomerate(project, TURBINE, 'blocks');
    const cells = emptyCells(width + 2, width + 2, depth + 2);
    this.setBearing(cells, bearingSize, blocks);
    if (data.hasProperty('inputs')) {
      const inputs = numberList(data, 'inputs');
      const ids: number[] = [];
      for (let i = 0; i < inputs.size(); i++) ids.push(inputs.get(i));
      this.turbinePostLoadInputs.set(design, ids);
    }
    const allBlades = blocks.filter((block) => modulesOf(block)[`${TURBINE}:blade`] !== undefined);
    const coilIds = numberList(data, 'coils');
    let index = 0;
    // `:241-252` — the loop variable is assigned inside its own body, so only
    // z = 0 and z = depth-1 are visited.
    for (let cz = 0; cz < 2; cz++) {
      if (cz === 1) cz = depth - 1;
      for (let cx = 1; cx <= width; cx++) {
        for (let cy = 1; cy <= width; cy++) {
          const bid = coilIds.get(index);
          if (bid > 0) cells[cx]![cy]![cz] = this.recoverElement('block', blocks, bid - 1);
          index++;
        }
      }
    }
    const bladeIds = numberList(data, 'blades');
    index = 0;
    for (let cz = 1; cz <= depth; cz++) {
      const bid = bladeIds.get(index);
      if (bid > 0) this.setBlade(cells, bearingSize, cz, this.recoverElement('blade', allBlades, bid - 1));
      index++;
    }
    design.design = blockIndices(cells, blocks);
    return design;
  }

  /**
   * Java `readMultiblockOverhaulFusionReactor` (`:264-296`) — deviation 7: the
   * block pass cannot be ported as a conversion because Java walks
   * `design[y]`/`design[z]` with the *width* bound and therefore always throws.
   */
  protected override readMultiblockOverhaulFusionReactor(project: ProjectJson, data: ConfigObject): JsonObject {
    const size = numberList(data, 'size');
    this.recoverIndex('recipe', this.conglomerate(project, FUSION, 'recipes'), data.getByte('recipe', -1));
    this.recoverIndex(
      'coolant recipe',
      this.conglomerate(project, FUSION, 'coolant_recipes'),
      data.getByte('coolantRecipe', -1),
    );
    throw new LegacyFormatError(
      'v9 fusion multiblock: Java walks the design with the width bound on every axis ' +
        '(ArrayIndexOutOfBoundsException)',
    );
  }

  /**
   * `setBearing` (`:713-731`) — fills the bearing/shaft disk at both z ends of the
   * turbine. Java's `z` bound is two past the end of the array, so this throws for
   * any configuration with a shaft or a bearing block (deviation 6).
   */
  private setBearing(cells: Cell[][][], bearingSize: number, blocks: readonly JsonObject[]): void {
    const size = cells.length;
    const bearingMax = LegacyNCPF9Reader.javaDiv(size + 2, 2) + LegacyNCPF9Reader.javaDiv(bearingSize, 2);
    const bearingMin = LegacyNCPF9Reader.javaDiv(size + 2, 2) - LegacyNCPF9Reader.javaDiv(bearingSize, 2);
    let bearing: JsonObject | null = null;
    let shaft: JsonObject | null = null;
    for (const block of blocks) {
      const modules = modulesOf(block);
      if (shaft === null && modules[`${TURBINE}:shaft`] !== undefined) shaft = block;
      if (bearing === null && modules[`${TURBINE}:bearing`] !== undefined) bearing = block;
    }
    const depth = cells[0]![0]!.length + 2;
    for (let z = 0; z < depth; z++) {
      for (let x = bearingMin; x <= bearingMax; x++) {
        for (let y = bearingMin; y <= bearingMax; y++) {
          const block = z === 0 || z === depth - 1 ? bearing : shaft;
          if (block !== null) this.setCellAt(cells, x, y, z, block);
        }
      }
    }
  }

  /** `setBlade` (`:732-743`) — the cross-shaped blade rings (`y <= design.length`). */
  private setBlade(cells: Cell[][][], bearingSize: number, z: number, block: JsonObject): void {
    const bearingMax =
      LegacyNCPF9Reader.javaDiv(cells.length + 2, 2) + LegacyNCPF9Reader.javaDiv(bearingSize, 2);
    const bearingMin =
      LegacyNCPF9Reader.javaDiv(cells.length + 2, 2) - LegacyNCPF9Reader.javaDiv(bearingSize, 2);
    for (let x = 1; x <= cells.length; x++) {
      for (let y = 1; y <= cells[0]!.length; y++) {
        const isXBlade = x >= bearingMin && x <= bearingMax;
        const isYBlade = y >= bearingMin && y <= bearingMax;
        if (isXBlade && isYBlade) continue; // that's the bearing
        if (isXBlade || isYBlade) this.setCellAt(cells, x, y, z, block);
      }
    }
  }

  // ------------------------------------------------------------ configuration

  /** `loadUnderhaulBlocks` (`:298-357`). */
  protected override loadUnderhaulBlocks(
    container: Map<string, JsonObject>,
    config: ConfigObject,
    loadSettings: boolean,
  ): void {
    if (!config.hasProperty('underhaul')) return;
    const underhaul = requireObject(config, 'underhaul');
    if (!underhaul.hasProperty('fissionSFR')) return;
    const configuration = createConfiguration(UH);
    const fissionSFR = requireObject(underhaul, 'fissionSFR');
    if (loadSettings) {
      configModules(configuration)[`${UH}_configuration_settings`] = this.settingsModule(
        'underhaul SFR',
        UH,
        {
          min_size: fissionSFR.getInt('minSize'),
          max_size: fissionSFR.getInt('maxSize'),
          neutron_reach: fissionSFR.getInt('neutronReach'),
          moderator_extra_power: javaFloat(fissionSFR.getFloat('moderatorExtraPower')),
          moderator_extra_heat: javaFloat(fissionSFR.getFloat('moderatorExtraHeat')),
          active_cooler_rate: fissionSFR.getInt('activeCoolerRate'),
        },
      );
    }
    const blocks = elementList(configuration, 'blocks');
    for (const blockCfg of this.readList(fissionSFR, 'blocks', 'underhaul SFR')) {
      const definition = legacyBlockDefinition(blockCfg.getString('name') ?? '');
      const block = legacyElementJson(definition, namedModules(null, null));
      blocks.push(block);
      const active = blockCfg.getString('active');
      const cooling = blockCfg.getInt('cooling', 0);
      /** The module the placement rules attach to (`:322`, `:640-663`-style). */
      let coolerStats: JsonObject | null = null;
      const lists = this.recipeListsFor(block);
      if (active !== null) {
        setModuleIfPresent(block, `${UH}:active_cooler`, {});
        const recipe = legacyElementJson(legacyFluidDefinition(active), namedModules(null, null));
        coolerStats = { cooling };
        modulesOf(recipe)[`${UH}:cooler`] = coolerStats;
        lists.coolers.push(recipe);
      } else if (cooling !== 0) {
        coolerStats = { cooling };
        setModuleIfPresent(block, `${UH}:cooler`, coolerStats);
      }
      if (blockCfg.getBoolean('fuelCell', false)) setModuleIfPresent(block, `${UH}:fuel_cell`, {});
      if (blockCfg.getBoolean('moderator', false)) setModuleIfPresent(block, `${UH}:moderator`, {});
      if (blockCfg.hasProperty('rules')) {
        if (coolerStats === null) {
          throw new LegacyFormatError(`Rules on a block without cooler stats! (${definitionToString(definition)})`);
        }
        coolerStats.rules = requireList(blockCfg, 'rules').map((ruleCfg) =>
          this.readUnderRule(ruleCfg, definitionToString(definition)),
        );
      }
      this.applyBlockRecipes(block, ['coolers']);
    }
    for (const fuelCfg of this.readList(fissionSFR, 'fuels', 'underhaul SFR')) {
      const fuel = legacyElementJson(
        legacyItemDefinition(fuelCfg.getString('name') ?? ''),
        namedModules(null, null),
      );
      modulesOf(fuel)[`${UH}:fuel_stats`] = {
        power: javaFloat(fuelCfg.getFloat('power')),
        heat: javaFloat(fuelCfg.getFloat('heat')),
        time: fuelCfg.getInt('time'),
      };
      elementList(configuration, 'fuels').push(fuel);
    }
    container.set(UH, configuration);
  }

  /** `loadOverhaulSFRBlocks` (`:358-457`). */
  protected override loadOverhaulSFRBlocks(
    parent: Map<string, JsonObject> | null,
    container: Map<string, JsonObject>,
    overhaul: ConfigObject,
    loadSettings: boolean,
    loadingAddon: boolean,
    isAddon: boolean,
    additionalBlocks: JsonObject[],
  ): void {
    if (!overhaul.hasProperty('fissionSFR')) return;
    // v9 has no addon-aware block handling at all: `parent`, `loadingAddon`,
    // `isAddon` and `additionalBlocks` are unused by the Java body too.
    const where = 'overhaul SFR';
    const configuration = createConfiguration(SFR);
    const fissionSFR = requireObject(overhaul, 'fissionSFR');
    if (loadSettings) {
      configModules(configuration)[`${SFR}_configuration_settings`] = this.settingsModule(where, SFR, {
        min_size: fissionSFR.getInt('minSize'),
        max_size: fissionSFR.getInt('maxSize'),
        neutron_reach: fissionSFR.getInt('neutronReach'),
        cooling_efficiency_leniency: fissionSFR.getInt('coolingEfficiencyLeniency'),
        sparsity_penalty_multiplier: javaFloat(fissionSFR.getFloat('sparsityPenaltyMult')),
        sparsity_penalty_threshold: javaFloat(fissionSFR.getFloat('sparsityPenaltyThreshold')),
      });
    }
    const blocks = elementList(configuration, 'blocks');
    for (const blockCfg of this.readList(fissionSFR, 'blocks', where)) {
      const definition = legacyBlockDefinition(blockCfg.getString('name') ?? '');
      const block = legacyElementJson(definition, namedModules(null, null));
      blocks.push(block);
      const cooling = blockCfg.getInt('cooling', 0);
      if (cooling !== 0) setModuleIfPresent(block, `${SFR}:heat_sink`, { cooling });
      if (blockCfg.getBoolean('conductor', false)) setModuleIfPresent(block, `${SFR}:conductor`, {});
      if (blockCfg.getBoolean('fuelCell', false)) setModuleIfPresent(block, `${SFR}:fuel_cell`, {});
      if (blockCfg.getBoolean('reflector', false)) {
        setModuleIfPresent(block, `${SFR}:reflector`, {
          efficiency: javaFloat(blockCfg.getFloat('efficiency')),
          reflectivity: javaFloat(blockCfg.getFloat('reflectivity')),
        });
      }
      if (blockCfg.getBoolean('irradiator', false)) setModuleIfPresent(block, `${SFR}:irradiator`, {});
      if (blockCfg.getBoolean('moderator', false)) {
        setModuleIfPresent(block, `${SFR}:moderator`, {
          flux: blockCfg.getInt('flux'),
          efficiency: javaFloat(blockCfg.getFloat('efficiency')),
        });
      }
      if (blockCfg.getBoolean('shield', false)) {
        setModuleIfPresent(block, `${SFR}:neutron_shield`, {
          heat_per_flux: blockCfg.getInt('heatMult'),
          efficiency: javaFloat(blockCfg.getFloat('efficiency')),
        });
      }
      if (blockCfg.hasProperty('rules')) {
        const heatsink = modulesOf(block)[`${SFR}:heat_sink`];
        if (!isJsonObject(heatsink)) {
          throw new LegacyFormatError(`Rules on a block without heatsink! (${definitionToString(definition)})`);
        }
        heatsink.rules = requireList(blockCfg, 'rules').map((ruleCfg) =>
          this.readOverSFRRule(ruleCfg, definitionToString(definition)),
        );
      }
    }
    // `:408-423` — every fuel goes onto every fuel cell of the configuration
    // (deviation 2: Java reads the list back out of the unregistered project).
    for (const fuelCfg of this.readList(fissionSFR, 'fuels', where)) {
      const fuel = legacyElementJson(
        legacyItemDefinition(fuelCfg.getString('name') ?? ''),
        namedModules(null, null),
      );
      modulesOf(fuel)[`${SFR}:fuel_stats`] = {
        efficiency: javaFloat(fuelCfg.getFloat('efficiency')),
        heat: javaFloat(fuelCfg.getFloat('heat')),
        time: fuelCfg.getInt('time'),
        criticality: fuelCfg.getInt('criticality'),
        self_priming: fuelCfg.getBoolean('selfPriming', false),
      };
      for (const block of blocks) {
        if (modulesOf(block)[`${SFR}:fuel_cell`] !== undefined) this.recipeListsFor(block).fuels.push(fuel);
      }
    }
    for (const sourceCfg of this.readList(fissionSFR, 'sources', where)) {
      const block = legacyElementJson(
        legacyBlockDefinition(sourceCfg.getString('name') ?? ''),
        namedModules(null, null),
      );
      blocks.push(block);
      setModuleIfPresent(block, `${SFR}:neutron_source`, {
        efficiency: javaFloat(sourceCfg.getFloat('efficiency')),
      });
    }
    for (const irradiatorCfg of this.readList(fissionSFR, 'irradiatorRecipes', where)) {
      const recipe = legacyElementJson(
        legacyItemDefinition(irradiatorCfg.getString('name') ?? ''),
        namedModules(null, null),
      );
      modulesOf(recipe)[`${SFR}:irradiator_stats`] = {
        efficiency: javaFloat(irradiatorCfg.getFloat('efficiency')),
        heat: javaFloat(irradiatorCfg.getFloat('heat')),
      };
      for (const block of blocks) {
        if (modulesOf(block)[`${SFR}:irradiator`] !== undefined) {
          this.recipeListsFor(block).irradiators.push(recipe);
        }
      }
    }
    for (const coolantRecipeCfg of this.readList(fissionSFR, 'coolantRecipes', where)) {
      const amounts = makeIntegerRatio(1, this.readOutputRatio(coolantRecipeCfg, 'outputRatio'));
      // `:451-452` pushes *both* stacks into `inputs` — v11 puts the second one
      // into `outputs` (`LegacyNCPF11Reader.java:1294`).
      const recipe = legacyElementJson(
        legacyRecipeDefinition(
          [
            elementStack(legacyFluidDefinition(coolantRecipeCfg.getString('input') ?? ''), amounts[0]),
            elementStack(legacyFluidDefinition(coolantRecipeCfg.getString('output') ?? ''), amounts[1]),
          ],
          [],
        ),
        namedModules(null, null),
      );
      modulesOf(recipe)[`${SFR}:coolant_recipe_stats`] = { heat: coolantRecipeCfg.getInt('heat') };
      elementList(configuration, 'coolant_recipes').push(recipe);
    }
    for (const block of blocks) this.applyBlockRecipes(block, ['fuels', 'irradiators']);
    container.set(SFR, configuration);
  }

  /** `loadOverhaulMSRBlocks` (`:458-550`). */
  protected override loadOverhaulMSRBlocks(
    parent: Map<string, JsonObject> | null,
    container: Map<string, JsonObject>,
    overhaul: ConfigObject,
    loadSettings: boolean,
    loadingAddon: boolean,
    isAddon: boolean,
    additionalBlocks: JsonObject[],
  ): void {
    if (!overhaul.hasProperty('fissionMSR')) return;
    const where = 'overhaul MSR';
    const configuration = createConfiguration(MSR);
    const fissionMSR = requireObject(overhaul, 'fissionMSR');
    if (loadSettings) {
      configModules(configuration)[`${MSR}_configuration_settings`] = this.settingsModule(where, MSR, {
        min_size: fissionMSR.getInt('minSize'),
        max_size: fissionMSR.getInt('maxSize'),
        neutron_reach: fissionMSR.getInt('neutronReach'),
        cooling_efficiency_leniency: fissionMSR.getInt('coolingEfficiencyLeniency'),
        sparsity_penalty_multiplier: javaFloat(fissionMSR.getFloat('sparsityPenaltyMult')),
        sparsity_penalty_threshold: javaFloat(fissionMSR.getFloat('sparsityPenaltyThreshold')),
      });
    }
    const blocks = elementList(configuration, 'blocks');
    for (const blockCfg of this.readList(fissionMSR, 'blocks', where)) {
      const definition = legacyBlockDefinition(blockCfg.getString('name') ?? '');
      const block = legacyElementJson(definition, namedModules(null, null));
      blocks.push(block);
      const cooling = blockCfg.getInt('cooling', 0);
      if (cooling !== 0) {
        setModuleIfPresent(block, `${MSR}:heater`, {});
        // `:481-484` — the "recipe" of a heater is the literal fluid `null`.
        const recipe = legacyElementJson(legacyFluidDefinition('null'), namedModules(null, null));
        modulesOf(recipe)[`${MSR}:heater_stats`] = { cooling };
        this.recipeListsFor(block).heaters.push(recipe);
      }
      if (blockCfg.getBoolean('conductor', false)) setModuleIfPresent(block, `${MSR}:conductor`, {});
      if (blockCfg.getBoolean('fuelVessel', false)) setModuleIfPresent(block, `${MSR}:fuel_vessel`, {});
      if (blockCfg.getBoolean('reflector', false)) {
        setModuleIfPresent(block, `${MSR}:reflector`, {
          efficiency: javaFloat(blockCfg.getFloat('efficiency')),
          reflectivity: javaFloat(blockCfg.getFloat('reflectivity')),
        });
      }
      if (blockCfg.getBoolean('irradiator', false)) setModuleIfPresent(block, `${MSR}:irradiator`, {});
      if (blockCfg.getBoolean('moderator', false)) {
        setModuleIfPresent(block, `${MSR}:moderator`, {
          flux: blockCfg.getInt('flux'),
          efficiency: javaFloat(blockCfg.getFloat('efficiency')),
        });
      }
      if (blockCfg.getBoolean('shield', false)) {
        setModuleIfPresent(block, `${MSR}:neutron_shield`, {
          heat_per_flux: blockCfg.getInt('heatMult'),
          efficiency: javaFloat(blockCfg.getFloat('efficiency')),
        });
      }
      if (blockCfg.hasProperty('rules')) {
        const heater = modulesOf(block)[`${MSR}:heater`];
        if (!isJsonObject(heater)) {
          throw new LegacyFormatError(`Rules on a block without heater! (${definitionToString(definition)})`);
        }
        heater.rules = requireList(blockCfg, 'rules').map((ruleCfg) =>
          this.readOverMSRRule(ruleCfg, definitionToString(definition)),
        );
      }
    }
    for (const fuelCfg of this.readList(fissionMSR, 'fuels', where)) {
      const fuel = legacyElementJson(
        legacyItemDefinition(fuelCfg.getString('name') ?? ''),
        namedModules(null, null),
      );
      modulesOf(fuel)[`${MSR}:fuel_stats`] = {
        efficiency: javaFloat(fuelCfg.getFloat('efficiency')),
        heat: javaFloat(fuelCfg.getFloat('heat')),
        time: fuelCfg.getInt('time'),
        criticality: fuelCfg.getInt('criticality'),
        self_priming: fuelCfg.getBoolean('selfPriming', false),
      };
      for (const block of blocks) {
        if (modulesOf(block)[`${MSR}:fuel_vessel`] !== undefined) this.recipeListsFor(block).fuels.push(fuel);
      }
    }
    for (const sourceCfg of this.readList(fissionMSR, 'sources', where)) {
      const block = legacyElementJson(
        legacyBlockDefinition(sourceCfg.getString('name') ?? ''),
        namedModules(null, null),
      );
      blocks.push(block);
      setModuleIfPresent(block, `${MSR}:neutron_source`, {
        efficiency: javaFloat(sourceCfg.getFloat('efficiency')),
      });
    }
    for (const irradiatorCfg of this.readList(fissionMSR, 'irradiatorRecipes', where)) {
      const recipe = legacyElementJson(
        legacyItemDefinition(irradiatorCfg.getString('name') ?? ''),
        namedModules(null, null),
      );
      modulesOf(recipe)[`${MSR}:irradiator_stats`] = {
        efficiency: javaFloat(irradiatorCfg.getFloat('efficiency')),
        heat: javaFloat(irradiatorCfg.getFloat('heat')),
      };
      for (const block of blocks) {
        if (modulesOf(block)[`${MSR}:irradiator`] !== undefined) {
          this.recipeListsFor(block).irradiators.push(recipe);
        }
      }
    }
    for (const block of blocks) this.applyBlockRecipes(block, ['fuels', 'irradiators', 'heaters']);
    container.set(MSR, configuration);
  }

  /** `loadOverhaulTurbineBlocks` (`:551-619`). */
  protected override loadOverhaulTurbineBlocks(
    container: Map<string, JsonObject>,
    overhaul: ConfigObject,
    loadSettings: boolean,
  ): void {
    if (!overhaul.hasProperty('turbine')) return;
    const where = 'overhaul turbine';
    const configuration = createConfiguration(TURBINE);
    const turbine = requireObject(overhaul, 'turbine');
    if (loadSettings) {
      const efficiency = this.loadTurbineEfficiencyFactors(turbine);
      configModules(configuration)[`${TURBINE}_configuration_settings`] = this.settingsModule(where, TURBINE, {
        min_width: turbine.getInt('minWidth'),
        min_length: turbine.getInt('minLength'),
        max_size: turbine.getInt('maxSize'),
        fluid_per_blade: turbine.getInt('fluidPerBlade'),
        throughput_efficiency_leniency_multiplier: efficiency.multiplier,
        throughput_efficiency_leniency_threshold: efficiency.threshold,
        throughput_factor: javaFloat(turbine.getFloat('throughputFactor')),
        power_bonus: javaFloat(turbine.getFloat('powerBonus')),
      });
    }
    const blocks = elementList(configuration, 'blocks');
    for (const blockCfg of this.readList(turbine, 'coils', where)) {
      const definition = legacyBlockDefinition(blockCfg.getString('name') ?? '');
      const block = legacyElementJson(definition, namedModules(null, null));
      blocks.push(block);
      if (blockCfg.getBoolean('bearing', false)) setModuleIfPresent(block, `${TURBINE}:bearing`, {});
      if (blockCfg.getBoolean('connector', false)) setModuleIfPresent(block, `${TURBINE}:connector`, {});
      if (blockCfg.getFloat('efficiency') > 0) {
        // `:574-578` — the module only exists for a positive efficiency.
        setModuleIfPresent(block, `${TURBINE}:coil`, {
          efficiency: javaFloat(blockCfg.getFloat('efficiency')),
        });
      }
      if (blockCfg.hasProperty('rules')) {
        const coil = modulesOf(block)[`${TURBINE}:coil`];
        if (!isJsonObject(coil)) {
          throw new LegacyFormatError(`Rules on a block without coil! (${definitionToString(definition)})`);
        }
        coil.rules = requireList(blockCfg, 'rules').map((ruleCfg) =>
          this.readOverTurbineRule(ruleCfg, definitionToString(definition)),
        );
      }
    }
    for (const blockCfg of this.readList(turbine, 'blades', where)) {
      const definition = legacyBlockDefinition(blockCfg.getString('name') ?? '');
      const blade = legacyElementJson(definition, namedModules(null, null));
      blocks.push(blade);
      if (this.readBladeStator(blockCfg, 'stator')) {
        setModuleIfPresent(blade, `${TURBINE}:stator`, {
          expansion: javaFloat(blockCfg.getFloat('expansion')),
        });
      } else {
        setModuleIfPresent(blade, `${TURBINE}:blade`, {
          expansion: javaFloat(blockCfg.getFloat('expansion')),
          efficiency: javaFloat(blockCfg.getFloat('efficiency')),
        });
      }
    }
    // `:603-608` fills `allCoils`/`allBlades` from
    // `project.getConfiguration(TURBINE)` — a configuration this method never
    // registers — and then uses neither list; deviation 5, not ported.
    for (const recipeCfg of this.readList(turbine, 'recipes', where)) {
      const recipe = legacyElementJson(
        legacyFluidDefinition(recipeCfg.getString('input') ?? ''),
        namedModules(null, null),
      );
      modulesOf(recipe)[`${TURBINE}:recipe_stats`] = {
        power: recipeCfg.getDouble('power'),
        coefficient: recipeCfg.getDouble('coefficient'),
      };
      elementList(configuration, 'recipes').push(recipe);
    }
    // `:618` does not put the configuration into the project (deviation 2). The
    // port does, because every reader above it uses the container for the
    // metadata pass, for the `coils`/`blades` recovery of a turbine design and
    // for `resolvePostLoadRules`.
    container.set(TURBINE, configuration);
  }

  /** `loadOverhaulFusionGeneratorBlocks` (`:620-712`). */
  protected override loadOverhaulFusionGeneratorBlocks(
    container: Map<string, JsonObject>,
    overhaul: ConfigObject,
    loadSettings: boolean,
  ): void {
    if (!overhaul.hasProperty('fusion')) return;
    const where = 'overhaul fusion';
    const configuration = createConfiguration(FUSION);
    const fusion = requireObject(overhaul, 'fusion');
    if (loadSettings) {
      configModules(configuration)[`${FUSION}_configuration_settings`] = this.settingsModule(where, FUSION, {
        min_inner_radius: fusion.getInt('minInnerRadius'),
        max_inner_radius: fusion.getInt('maxInnerRadius'),
        min_core_size: fusion.getInt('minCoreSize'),
        max_core_size: fusion.getInt('maxCoreSize'),
        min_toroid_width: fusion.getInt('minToroidWidth'),
        max_toroid_width: fusion.getInt('maxToroidWidth'),
        min_lining_thickness: fusion.getInt('minLiningThickness'),
        max_lining_thickness: fusion.getInt('maxLiningThickness'),
        cooling_efficiency_leniency: fusion.getInt('coolingEfficiencyLeniency'),
        sparsity_penalty_multiplier: javaFloat(fusion.getFloat('sparsityPenaltyMult')),
        sparsity_penalty_threshold: javaFloat(fusion.getFloat('sparsityPenaltyThreshold')),
      });
    }
    const blocks = elementList(configuration, 'blocks');
    /** `:640` — one flag for the whole block list, set by the *last* block. */
    let augmented = false;
    for (const blockCfg of this.readList(fusion, 'blocks', where)) {
      const definition = legacyBlockDefinition(blockCfg.getString('name') ?? '');
      const block = legacyElementJson(definition, namedModules(null, null));
      blocks.push(block);
      const cooling = blockCfg.getInt('cooling', 0);
      if (cooling !== 0) setModuleIfPresent(block, `${FUSION}:heatsink`, { cooling });
      if (blockCfg.getBoolean('conductor', false)) setModuleIfPresent(block, `${FUSION}:conductor`, {});
      if (blockCfg.getBoolean('connector', false)) setModuleIfPresent(block, `${FUSION}:connector`, {});
      if (blockCfg.getBoolean('core', false)) setModuleIfPresent(block, `${FUSION}:core`, {});
      if (blockCfg.getBoolean('electromagnet', false)) {
        setModuleIfPresent(block, `${FUSION}:toroidal_electromagnet`, {});
        setModuleIfPresent(block, `${FUSION}:poloidal_electromagnet`, {});
      }
      if (blockCfg.getBoolean('heatingBlanket', false)) setModuleIfPresent(block, `${FUSION}:heating_blanket`, {});
      if (blockCfg.getBoolean('reflector', false)) {
        setModuleIfPresent(block, `${FUSION}:reflector`, {
          efficiency: javaFloat(blockCfg.getFloat('efficiency')),
        });
      }
      if (blockCfg.getBoolean('breedingBlanket', false)) {
        setModuleIfPresent(block, `${FUSION}:breeding_blanket`, {});
      }
      augmented = blockCfg.getBoolean('breedingBlanketAugmented', false);
      if (blockCfg.getBoolean('shielding', false)) {
        setModuleIfPresent(block, `${FUSION}:shielding`, {
          shieldiness: javaFloat(blockCfg.getFloat('shieldiness')),
        });
      }
      if (blockCfg.hasProperty('rules')) {
        const heatsink = modulesOf(block)[`${FUSION}:heatsink`];
        if (!isJsonObject(heatsink)) {
          throw new LegacyFormatError(`Rules on a block without heatsink! (${definitionToString(definition)})`);
        }
        heatsink.rules = requireList(blockCfg, 'rules').map((ruleCfg) =>
          this.readOverFusionRule(ruleCfg, definitionToString(definition)),
        );
      }
    }
    for (const blanketCfg of this.readList(fusion, 'breedingBlanketRecipes', where)) {
      for (const block of blocks) {
        if (modulesOf(block)[`${FUSION}:breeding_blanket`] === undefined) continue;
        // `:678-688` — a fresh recipe per blanket block, all carrying the one
        // `augmented` flag of the block list (`:685`).
        const recipe = legacyElementJson(
          legacyBlockDefinition(blanketCfg.getString('name') ?? ''),
          namedModules(null, null),
        );
        modulesOf(recipe)[`${FUSION}:breeding_blanket_stats`] = {
          efficiency: javaFloat(blanketCfg.getFloat('efficiency')),
          heat: javaFloat(blanketCfg.getFloat('heat')),
          augmented,
        };
        this.recipeListsFor(block).blankets.push(recipe);
      }
    }
    for (const recipeCfg of this.readList(fusion, 'recipes', where)) {
      const recipe = legacyElementJson(
        legacyFluidDefinition(recipeCfg.getString('name') ?? ''),
        namedModules(null, null),
      );
      modulesOf(recipe)[`${FUSION}:recipe_stats`] = {
        efficiency: javaFloat(recipeCfg.getFloat('efficiency')),
        heat: recipeCfg.getInt('heat'),
        time: recipeCfg.getInt('time'),
        fluxiness: javaFloat(recipeCfg.getFloat('fluxiness')),
      };
      elementList(configuration, 'recipes').push(recipe);
    }
    for (const coolantRecipeCfg of this.readList(fusion, 'coolantRecipes', where)) {
      const amounts = makeIntegerRatio(1, this.readOutputRatio(coolantRecipeCfg, 'outputRatio'));
      // `:706-707` — both stacks go into `inputs`, like the SFR coolant recipe.
      const recipe = legacyElementJson(
        legacyRecipeDefinition(
          [
            elementStack(legacyFluidDefinition(coolantRecipeCfg.getString('input') ?? ''), amounts[0]),
            elementStack(legacyFluidDefinition(coolantRecipeCfg.getString('output') ?? ''), amounts[1]),
          ],
          [],
        ),
        namedModules(null, null),
      );
      modulesOf(recipe)[`${FUSION}:coolant_recipe_stats`] = { heat: coolantRecipeCfg.getInt('heat') };
      elementList(configuration, 'coolant_recipes').push(recipe);
    }
    for (const block of blocks) this.applyBlockRecipes(block, ['blankets']);
    container.set(FUSION, configuration);
  }
}
