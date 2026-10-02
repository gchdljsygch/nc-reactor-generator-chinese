import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { SFR_CONFIG_ID, buildSfrConfig, type SfrConfig } from './sfr/config.js';
import { USFR_CONFIG_ID, buildUsfrConfig, type UsfrConfig, type UsfrTemplate } from './usfr/config.js';
import {
  MSR_CONFIG_ID,
  buildMsrConfig,
  type MsrConfig,
  type MsrFuel,
  type MsrHeaterRecipe,
  type MsrIrradiatorRecipe,
  type MsrTemplate,
} from './msr/config.js';
import {
  TURBINE_CONFIG_ID,
  buildTurbineConfig,
  type TurbineConfig,
  type TurbineTemplate,
} from './turbine/config.js';
import { OverhaulSfrReactor, SfrBlock } from './sfr/reactor.js';
import { UnderhaulSfrReactor, UsfrBlock } from './usfr/reactor.js';
import { MsrBlock, OverhaulMsrReactor } from './msr/reactor.js';
import { OverhaulTurbineReactor, TurbineBlock } from './turbine/reactor.js';
import { loadProjectFile, outputRatio, type Configuration } from '@ncplanner/ncpf';
import { pos } from './geometry.js';

/**
 * Golden dataset access + reactor reconstruction.
 *
 * The dataset (`datasets/golden/*.jsonl.gz`, `datasetVersion 3`) is
 * self-describing: `size` is the **full** grid size (interior + 2 casing
 * layers), `grid` is flattened as `x*dimY*dimZ + y*dimZ + z`, `-1` means air,
 * and `recipes` indexes `recipeNames` the same way.
 *
 * Reconstruction is the first thing the new kernel has to do, and it validates
 * the dataset's self-description: if the rebuild is wrong, every physics
 * comparison fails at once.
 */

export interface GoldenMeta {
  generator: string;
  datasetVersion: number;
  reactorType: string;
  definitionName: string;
  hasLiteEngine: boolean;
  cases: number;
  seed: number;
  minSize: number;
  maxSize: number;
  config: string;
  engine: string;
  statsExtraction: string;
  [key: string]: unknown;
}

export type GoldenNumber = number | 'NaN' | 'Infinity' | '-Infinity';

export interface GoldenRecord {
  id: string;
  type: string;
  strategy: string;
  size: [number, number, number];
  /** Template names; `datasetVersion >= 3` uses the injective `definition.toString()`. */
  blockNames: string[];
  recipeNames: string[];
  grid: number[];
  recipes: number[];
  editor: Record<string, GoldenNumber>;
  lite: Record<string, GoldenNumber> | null;
  divergence: Record<string, number[]>;
  error?: string;
}

export interface GoldenDataset {
  meta: GoldenMeta;
  records: GoldenRecord[];
}

function readMaybeGzip(path: string): string {
  const buf = readFileSync(path);
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    return gunzipSync(buf).toString('utf8');
  }
  return buf.toString('utf8');
}

export function readGoldenDataset(path: string): GoldenDataset {
  const lines = readMaybeGzip(path).split('\n').filter((l) => l.trim().length > 0);
  const first = lines[0];
  if (first === undefined) throw new Error(`empty dataset: ${path}`);
  const head = JSON.parse(first) as { __meta: GoldenMeta };
  const records = lines.slice(1).map((l) => JSON.parse(l) as GoldenRecord);
  return { meta: head.__meta, records };
}

export interface ResolvedTemplates {
  /** identity → template name index → the template, in first-seen order. */
  readonly byName: Map<string, string>;
}

export interface RebuildResult<R = OverhaulSfrReactor> {
  reactor: R;
  /** Templates that could only be resolved by name (dataset < v3 or ambiguity). */
  ambiguous: { name: string; identity: string; chosen: number }[];
  /** Names with no template at all. */
  unresolved: string[];
}

/**
 * Rebuild an Overhaul SFR from a golden record.
 *
 * `identityFirst` resolves `blockNames` as definition identities (dataset v3);
 * when a name is not an identity, the rebuild falls back to `definition.name`
 * (dataset v2) and records the ambiguity — which is exactly the R1.0 finding
 * that motivated v3.
 */
export function rebuildSfr(config: SfrConfig, record: GoldenRecord): RebuildResult {
  const [dimX, dimY, dimZ] = record.size;
  const width = dimX - 2;
  const height = dimY - 2;
  const depth = dimZ - 2;

  const templates: (ReturnType<typeof config.byIdentity.get> | undefined)[] = record.blockNames.map(
    (name) => config.findByIdentity(name),
  );

  // Fallback: match by the (lossy) definition name; report the ambiguity.
  const ambiguous: RebuildResult['ambiguous'] = [];
  const unresolved: string[] = [];
  for (let i = 0; i < record.blockNames.length; i++) {
    if (templates[i]) continue;
    const name = record.blockNames[i];
    const candidates = config.templates.filter((t) => t.name === name);
    if (candidates.length === 0) {
      unresolved.push(name);
      continue;
    }
    templates[i] = candidates[0];
    ambiguous.push({ name, identity: candidates[0].identity, chosen: candidates.length });
  }

  // Coolant recipe: the golden generator always ran with the first coolant
  // recipe (OverhaulSFR's constructor default).
  const coolant = firstCoolantRecipe(config.configuration);

  const reactor = new OverhaulSfrReactor(config, width, height, depth, coolant);
  for (let x = 0; x < dimX; x++) {
    for (let y = 0; y < dimY; y++) {
      for (let z = 0; z < dimZ; z++) {
        const idx = x * dimY * dimZ + y * dimZ + z;
        const bi = record.grid[idx];
        if (bi === undefined || bi < 0) continue;
        const template = templates[bi];
        if (!template) {
          throw new Error(
            `${record.id}: no template for blockNames[${bi}] = ${String(record.blockNames[bi])}`,
          );
        }
        const block = new SfrBlock(pos(x, y, z), template);
        const ri = record.recipes[idx];
        if (ri !== undefined && ri >= 0) {
          const recipeName = record.recipeNames[ri];
          assignRecipe(block, recipeName);
        }
        reactor.setBlock(block.pos, block);
      }
    }
  }
  return { reactor, ambiguous, unresolved };
}

function assignRecipe(block: SfrBlock, recipeName: string | undefined): void {
  if (recipeName === undefined) return;
  const eq = recipeName.indexOf('=');
  if (eq < 0) return;
  const field = recipeName.slice(0, eq);
  const name = recipeName.slice(eq + 1);
  if (field === 'fuel') {
    const fuel = block.template.fuels.find((x) => x.name === name);
    if (!fuel) throw new Error(`unknown fuel '${name}' on ${block.template.identity}`);
    block.fuel = fuel;
    return;
  }
  if (field === 'irradiatorRecipe') {
    const recipe = block.template.irradiatorRecipes.find((x) => x.name === name);
    if (!recipe) {
      throw new Error(`unknown irradiator recipe '${name}' on ${block.template.identity}`);
    }
    block.irradiatorRecipe = recipe;
    return;
  }
  throw new Error(`Unsupported recipe field '${field}' (${recipeName})`);
}

export interface CoolantRecipeView {
  heat: number;
  ratio: number;
}

function firstCoolantRecipe(configuration: Configuration): CoolantRecipeView {
  const list = configuration.lists.get('coolant_recipes') ?? [];
  const first = list[0];
  if (!first) return { heat: 1, ratio: 1 };
  const stats = first.modules[`${SFR_CONFIG_ID}:coolant_recipe_stats`] as
    | { heat?: number }
    | undefined;
  const heat = typeof stats?.heat === 'number' ? stats.heat : 1;
  return { heat, ratio: outputRatio(first.raw) };
}

/** Load the shipped NuclearCraft configuration and build the SFR view. */
export function loadShippedSfrConfig(configPath: string): SfrConfig {
  const project = loadProjectFile(configPath);
  const configuration = project.getConfiguration(SFR_CONFIG_ID);
  if (!configuration) {
    throw new Error(`${configPath} has no configuration '${SFR_CONFIG_ID}'`);
  }
  return buildSfrConfig(configuration);
}

/** Load the shipped NuclearCraft configuration and build the Underhaul SFR view. */
export function loadShippedUsfrConfig(configPath: string): UsfrConfig {
  const project = loadProjectFile(configPath);
  const configuration = project.getConfiguration(USFR_CONFIG_ID);
  if (!configuration) {
    throw new Error(`${configPath} has no configuration '${USFR_CONFIG_ID}'`);
  }
  return buildUsfrConfig(configuration);
}

/**
 * Rebuild an Underhaul SFR from a golden record.
 *
 * Underhaul reactors carry a single fuel for the whole multiblock (Java
 * `UnderhaulSFR.fuel`, defaulting to the configuration's first fuel), so the
 * record's `recipes` only ever name active-cooler coolants.
 */
export function rebuildUsfr(
  config: UsfrConfig,
  record: GoldenRecord,
): RebuildResult<UnderhaulSfrReactor> {
  const [dimX, dimY, dimZ] = record.size;
  const width = dimX - 2;
  const height = dimY - 2;
  const depth = dimZ - 2;

  const templates: (UsfrTemplate | undefined)[] = record.blockNames.map((name) =>
    config.findByIdentity(name),
  );
  const ambiguous: RebuildResult['ambiguous'] = [];
  const unresolved: string[] = [];
  for (let i = 0; i < record.blockNames.length; i++) {
    if (templates[i]) continue;
    const name = record.blockNames[i];
    const candidates = config.templates.filter((t) => t.name === name);
    if (candidates.length === 0) {
      unresolved.push(name);
      continue;
    }
    templates[i] = candidates[0];
    ambiguous.push({ name, identity: candidates[0].identity, chosen: candidates.length });
  }

  const reactor = new UnderhaulSfrReactor(config, width, height, depth);
  for (let x = 0; x < dimX; x++) {
    for (let y = 0; y < dimY; y++) {
      for (let z = 0; z < dimZ; z++) {
        const idx = x * dimY * dimZ + y * dimZ + z;
        const bi = record.grid[idx];
        if (bi === undefined || bi < 0) continue;
        const template = templates[bi];
        if (!template) {
          throw new Error(
            `${record.id}: no template for blockNames[${bi}] = ${String(record.blockNames[bi])}`,
          );
        }
        const block = new UsfrBlock(pos(x, y, z), template);
        const ri = record.recipes[idx];
        if (ri !== undefined && ri >= 0) {
          const recipeName = record.recipeNames[ri];
          const eq = (recipeName ?? '').indexOf('=');
          const name = eq >= 0 ? recipeName!.slice(eq + 1) : '';
          const recipe = template.activeCoolerRecipes.find((r) => r.name === name);
          if (!recipe) {
            throw new Error(`unknown active cooler recipe '${name}' on ${template.identity}`);
          }
          block.recipe = recipe;
        }
        reactor.setBlock(block.pos, block);
      }
    }
  }
  return { reactor, ambiguous, unresolved };
}

/** Load the shipped NuclearCraft configuration and build the Overhaul MSR view. */
export function loadShippedMsrConfig(configPath: string): MsrConfig {
  const project = loadProjectFile(configPath);
  const configuration = project.getConfiguration(MSR_CONFIG_ID);
  if (!configuration) {
    throw new Error(`${configPath} has no configuration '${MSR_CONFIG_ID}'`);
  }
  return buildMsrConfig(configuration);
}

/** Load the shipped NuclearCraft configuration and build the Overhaul Turbine view. */
export function loadShippedTurbineConfig(configPath: string): TurbineConfig {
  const project = loadProjectFile(configPath);
  const configuration = project.getConfiguration(TURBINE_CONFIG_ID);
  if (!configuration) {
    throw new Error(`${configPath} has no configuration '${TURBINE_CONFIG_ID}'`);
  }
  return buildTurbineConfig(configuration);
}

/**
 * Rebuild an Overhaul MSR from a golden record.
 *
 * MSR reconstruction needs one extra step over SFR: **every vessel group is
 * keyed on the `Fuel` object identity**, so two adjacent vessels with the same
 * template but different `Fuel` instances form two groups (Java
 * `VesselGroup.getBlocks` compares `newBlock.fuel == start.fuel`). The golden
 * generator creates those shared instances explicitly, and the dataset records
 * the fuel *name* only — so this rebuild reproduces the grouping by reusing the
 * per-template `MsrFuel` object for every block that names it. That is exactly
 * what the generator does (it draws `groupFuel` from the template's own list).
 */
export function rebuildMsr(
  config: MsrConfig,
  record: GoldenRecord,
): RebuildResult<OverhaulMsrReactor> {
  const [dimX, dimY, dimZ] = record.size;
  const width = dimX - 2;
  const height = dimY - 2;
  const depth = dimZ - 2;

  const templates: (MsrTemplate | undefined)[] = record.blockNames.map((name) =>
    config.findByIdentity(name),
  );
  const ambiguous: RebuildResult['ambiguous'] = [];
  const unresolved: string[] = [];
  for (let i = 0; i < record.blockNames.length; i++) {
    if (templates[i]) continue;
    const name = record.blockNames[i];
    const candidates = config.templates.filter((t) => t.name === name);
    if (candidates.length === 0) {
      unresolved.push(name);
      continue;
    }
    templates[i] = candidates[0];
    ambiguous.push({ name, identity: candidates[0].identity, chosen: candidates.length });
  }

  const reactor = new OverhaulMsrReactor(config, width, height, depth);
  // Cache per (template, fuel name) so all blocks naming the same fuel share the
  // object identity the vessel-group flood fill requires.
  const fuelCache = new Map<string, MsrFuel>();
  for (let x = 0; x < dimX; x++) {
    for (let y = 0; y < dimY; y++) {
      for (let z = 0; z < dimZ; z++) {
        const idx = x * dimY * dimZ + y * dimZ + z;
        const bi = record.grid[idx];
        if (bi === undefined || bi < 0) continue;
        const template = templates[bi];
        if (!template) {
          throw new Error(
            `${record.id}: no template for blockNames[${bi}] = ${String(record.blockNames[bi])}`,
          );
        }
        const block = new MsrBlock(pos(x, y, z), template);
        const ri = record.recipes[idx];
        if (ri !== undefined && ri >= 0) {
          assignMsrRecipe(block, record.recipeNames[ri], fuelCache);
        }
        reactor.setBlock(block.pos, block);
      }
    }
  }
  return { reactor, ambiguous, unresolved };
}

/**
 * Resolve a golden recipe string (`<field>=<definition.toString()>`) against a
 * template's own recipe lists. A recipe that cannot be resolved is a loud
 * failure: silently ignoring it would under-count cooling / flux.
 *
 * The template's *own* payloads are the right list even for recipe ports: Java's
 * `BlockElement.setRecipe` routes through the parent, but the golden generator
 * populated the port block directly from the port template's `ncpf:block_recipes`
 * list, and both lists are identical in the shipped configuration (checked in
 * `docs/r1/r1.6-msr-turbine.md`).
 */
function assignMsrRecipe(
  block: MsrBlock,
  recipeName: string | undefined,
  fuelCache: Map<string, MsrFuel>,
): void {
  if (recipeName === undefined) return;
  const eq = recipeName.indexOf('=');
  if (eq < 0) return;
  const field = recipeName.slice(0, eq);
  const name = recipeName.slice(eq + 1);
  if (field === 'fuel') {
    const key = `${block.template.identity}\u0000${name}`;
    const cached = fuelCache.get(key);
    if (cached) {
      block.fuel = cached;
      return;
    }
    const fuel = block.template.fuels.find((x) => x.name === name);
    if (!fuel) throw new Error(`unknown fuel '${name}' on ${block.template.identity}`);
    fuelCache.set(key, fuel);
    block.fuel = fuel;
    return;
  }
  if (field === 'heaterRecipe') {
    const recipe: MsrHeaterRecipe | undefined = block.template.heaterRecipes.find(
      (x) => x.name === name,
    );
    if (!recipe) throw new Error(`unknown heater recipe '${name}' on ${block.template.identity}`);
    block.heaterRecipe = recipe;
    return;
  }
  if (field === 'irradiatorRecipe') {
    const recipe: MsrIrradiatorRecipe | undefined = block.template.irradiatorRecipes.find(
      (x) => x.name === name,
    );
    if (!recipe) {
      throw new Error(`unknown irradiator recipe '${name}' on ${block.template.identity}`);
    }
    block.irradiatorRecipe = recipe;
    return;
  }
  throw new Error(`Unsupported recipe field '${field}' (${recipeName})`);
}

/**
 * Rebuild an Overhaul Turbine from a golden record.
 *
 * The turbine has exactly one multiblock-level recipe (Java
 * `OverhaulTurbine.configuration.recipes.get(0)`), so no per-block recipe data
 * is resolved: `Block.getRecipes()` is empty for this type and the golden
 * generator's `assignRecipe` therefore never sets anything.
 */
export function rebuildTurbine(
  config: TurbineConfig,
  record: GoldenRecord,
): RebuildResult<OverhaulTurbineReactor> {
  const [dimX, dimY, dimZ] = record.size;
  const width = dimX - 2;
  const height = dimY - 2;
  const depth = dimZ - 2;

  const templates: (TurbineTemplate | undefined)[] = record.blockNames.map((name) =>
    config.findByIdentity(name),
  );
  const ambiguous: RebuildResult['ambiguous'] = [];
  const unresolved: string[] = [];
  for (let i = 0; i < record.blockNames.length; i++) {
    if (templates[i]) continue;
    const name = record.blockNames[i];
    const candidates = config.templates.filter((t) => t.name === name);
    if (candidates.length === 0) {
      unresolved.push(name);
      continue;
    }
    templates[i] = candidates[0];
    ambiguous.push({ name, identity: candidates[0].identity, chosen: candidates.length });
  }

  const reactor = new OverhaulTurbineReactor(
    config,
    width,
    height,
    depth,
    config.recipes[0] ?? null,
  );
  for (let x = 0; x < dimX; x++) {
    for (let y = 0; y < dimY; y++) {
      for (let z = 0; z < dimZ; z++) {
        const idx = x * dimY * dimZ + y * dimZ + z;
        const bi = record.grid[idx];
        if (bi === undefined || bi < 0) continue;
        const template = templates[bi];
        if (!template) {
          throw new Error(
            `${record.id}: no template for blockNames[${bi}] = ${String(record.blockNames[bi])}`,
          );
        }
        reactor.setBlock(pos(x, y, z), new TurbineBlock(pos(x, y, z), template));
      }
    }
  }
  return { reactor, ambiguous, unresolved };
}
