/**
 * R2.5 — the **Hellrage** format family, write side.
 *
 * Ported from the frozen Java writer
 * `planner/file/writer/HellrageWriter.java` (257 lines). It writes the NCPF JSON
 * tree used everywhere else in this package (the shape `readAnyProjectBytes`
 * produces and `writeNcpfSave` / `writeNcpfExport` consume) back out as Hellrage
 * JSON, so a design can be published to the third-party Hellrage planner — the
 * only exchange format the frozen version supports
 * (`docs/r0/compat-contract.md` §3).
 *
 * ------------------------------------------------------------- format support
 *
 * Exactly the two configurations and design types the Java writer knows, and no
 * others:
 *
 * | design type | file written | Java |
 * |---|---|---|
 * | `nuclearcraft:underhaul_sfr` | Underhaul SFR v2 (`CompressedReactor` at the top level) | `HellrageWriter.java:38-80` |
 * | `nuclearcraft:overhaul_sfr` | Overhaul SFR v6 (`Data.{HeatSinks,…,CoolantRecipeName}`) | `HellrageWriter.java:81-247` |
 *
 * Deliberately **not** supported, with the Java citation for each limit:
 *
 *  - **any other design type** (`overhaul_msr`, `overhaul_turbine`,
 *    `overhaul_distiller`, `plannerator:fusion_test`) —
 *    `HellrageWriter.java:247` `throw new IllegalArgumentException(multi.getDefinitionName()+" is not supported by Hellrage JSON!")`.
 *    The Hellrage **MSR** dialect exists as a *reader* only
 *    (`OverhaulHellrageMSR1..6Reader`, R2.7 / P2: no sample file anywhere);
 *    `isMultiblockSupported` (`:253-256`) is likewise `OverhaulSFR ||
 *    UnderhaulSFR`.
 *  - **a non-multiblock design** — `HellrageWriter.java:36`
 *    (`Cannot export non-multiblock design …`).
 *  - **more than one design** — `HellrageWriter.java:34`
 *    (`Multiple designs are not supported by Hellrage JSON!`).
 *  - **a project with no design at all** (the "export a configuration" case) —
 *    `HellrageWriter.java:250`
 *    (`Cannot export NCPF configuration to Hellrage JSON format!`, an
 *    `UnsupportedOperationException`; the `//TODO config export?` above it is
 *    never implemented).
 *
 * Two things the format cannot represent at all, both documented by the Java
 * writer itself (`HellrageWriter.java:31`, the `Core.warning` text):
 *
 *  - **casings are never written** — `:54` skips `x|y|z == 0` and
 *    `== internal+1`, comment verbatim `can't save the casing :(`;
 *  - **configurations, addons and (for underhaul) coolant recipes are lost** —
 *    the file only carries block names, positions, the fuel and, for overhaul,
 *    the coolant recipe *name*. The Java `Core.warning` at `:31` is a UI
 *    notification and has no counterpart here.
 *
 * --------------------------------------------------------------- verification
 *
 * A file written by this module was fed back into the frozen Java chain
 * (`pwsh -File tools/golden/format-golden.ps1 -Probe …`):
 *
 *  - **underhaul** (`datasets/fixtures/historical/underhaul.json` → TS → Java):
 *    `reader: UnderhaulHellrage2Reader`, `read: OK`, `designs: 1`;
 *  - **overhaul** (`historical/overhaul.json` → TS → Java): the reader resolves
 *    *every* name — heat sinks, moderators, reflectors, fuel cells including the
 *    full `Cf-252 Neutron Source` spelling, conductors, the coolant recipe — and
 *    then dies inside `FileReader.read`'s own `project.copyTo(Project::new)`
 *    with `NullPointerException: … "this.definition.coolantRecipe" is null`.
 *    That is the R0 finding #9 product bug and **not** a property of this
 *    writer: `NCPFSettingsElement.matches` (`element/NCPFSettingsElement.java`,
 *    `ELEMENT_STACK_SET` branch) compares a `HashSet<NCPFElementStack>` against
 *    `NCPFElementDefinition`, so it is never reflexive for a `legacy_recipe`;
 *    `NCPFObject.setIndex` therefore writes `coolant_recipe: -1`
 *    (`NCPFObject.java:282-296`) and `getIndex` returns `null`
 *    (`OverhaulSFRDesign.java:42`). A minimally patched **Java-authored**
 *    `sfr-hellrage.json` (bare fuel names prefixed, `True;Self` downgraded) fails
 *    with the byte-identical exception, so the frozen build cannot import *any*
 *    overhaul SFR design, its own writer's output included. The rewrite plan is
 *    explicit that TS must not reproduce this (`docs/r0/compat-contract.md` §3,
 *    `docs/r0/findings.md` §8) — and it does not: `writeNcpfSave` /
 *    `writeNcpfExport` re-index from element identity, which is what the TS
 *    round trip in `test/r2.5-hellrage-write.test.ts` asserts.
 *
 * ------------------------------------------------------------------ deviations
 *
 * Every deviation is one of two kinds: (a) the R2.10 identity rule (never write
 * a *display* name — iron law 2 / `docs/rewrite-plan.md` §2, the very bug that
 * makes the frozen writer's output unreadable: `Invalid fuel name: MOX-241!`,
 * `Invalid block name: !`, `docs/r0/findings.md` §8.6), or (b) an escape from a
 * *reader* defect that would otherwise make a TS-written file unreadable by the
 * frozen Java version (the R2.5 acceptance criterion). Each is labelled below
 * with the Java line it replaces.
 *
 *  1. **Names are element identities, not display names.** Java writes
 *     `b.getDisplayName()` (`:63,112,126,140,154`); this port writes
 *     `identityName(element)` (`hellrage.ts`) — the element's first registered
 *     legacy name — pushed through the *same* `HELLRAGE_NAME_TRANSFORMS` entry
 *     the reader indexes that section with. That is what makes the frozen
 *     reader resolve the key: `NonRecoveryHandler.recoverFallbackName` matches
 *     `stringutil.superRemove(lowercase(legacyName), …)` against
 *     `superRemove(lowercase(fileKey), " ")`, and the transform is exactly that
 *     normal form. A localized configuration therefore keeps exporting.
 *     Consequence: keys are lower-cased (`water`) where Java wrote `Water` —
 *     both readers are case-insensitive (`equalsIgnoreCase`), so this is
 *     cosmetic in the file, never in the round trip.
 *  2. **Neutron source names are written in full** (`Cf-252 Neutron Source`),
 *     not Java's shortened `superRemove(displayName, " Neutron Source")`
 *     (`:166`, ⇒ `Cf-252`). The frozen reader runs a source name through the
 *     *block* processor, which strips spaces but **not** the word
 *     `neutronsource`; the shortened spelling can therefore never match
 *     (`Invalid block name: Cf-252!` — the real 2020 file
 *     `datasets/fixtures/historical/overhaul.json` fails exactly there,
 *     `docs/r0/historical-fixtures.md` §25). The full legacy name normalizes to
 *     the same string on both sides and resolves.
 *  3. **A self-priming fuel cell is written `;False;None`.** `isPrimed()`
 *     (`overhaul/fissionsfr/Block.java:143-147`) is
 *     `fuel.selfPriming || source != null`, so Java writes
 *     `True;Self` (`HellrageWriter.java:166`) whenever a Californium fuel sits
 *     in a cell — and then cannot read its own file, because
 *     `OverhaulHellrageSFR6Reader.java:143-145` looks *every* `True` source name
 *     up through `recoverOverhaulSFRBlock` and `NonRecoveryHandler` throws
 *     `Invalid block name: Self!` (that is the error `datasets/fixtures/sfr-hellrage.json`
 *     produces, `docs/r0/fixture-coverage.md` §16). TS writes `True` when — and
 *     only when — a neutron source block is actually present in the readable
 *     grid, which is also the only case the reader can reconstruct. No
 *     information is lost: primedness is *derived* again from the fuel when the
 *     file is read (`isPrimed()`), so `False;None` and `True;Self` describe the
 *     same reactor.
 *  4. **A suffix-less fuel name gets the `[ID]` prefix**
 *     (`HellrageWriter.java:161-164` writes no prefix at all). The frozen
 *     reader unconditionally decodes fuel keys as
 *     `name.substring(4)` + one of `""`, `" Oxide"`, `" Nitride"`,
 *     `"-Zirconium Alloy"` (`RecoveryModeHandler.recoverOverhaulSFRFuel:203-210`),
 *     so a bare `MOX-241` key is decoded as `241` and cannot match
 *     (`Invalid fuel name: MOX-241!`). `[ID]` is the literal-name prefix the TS
 *     reader already understands (`hellrage.ts` `fuelNameCandidates`); it keeps
 *     the Java writer's four-character-prefix shape while carrying the name
 *     through `substring(4)` intact.
 *
 *     One residual limit of the frozen reader that no spelling can remove: its
 *     candidate set is derived from the text *after* the prefix and always
 *     contains the plain, ` Oxide`, ` Nitride` and `-Zirconium Alloy` spellings
 *     of it, and `RecoveryModeHandler.recoverOverhaulSFRFuel` scans the *element
 *     list* testing all four candidates — so for a nitride or zirconium fuel
 *     whose base is shared with an earlier-listed oxide (`TBU Nitride` vs
 *     `TBU Oxide`) the frozen reader stops at the oxide. The file is still
 *     readable (nothing throws, `RecoveryModeHandler:203-210`), which is what
 *     R2.5 requires; TS decodes by prefix and is exact.
 *  5. **The design's element references are re-resolved by identity.** Java
 *     round trips through `Design.toMultiblock()` (`:37`) and compares
 *     `block.template == b` / `block.getRecipe()`; this port resolves the raw
 *     `design` / `block_recipes` grids through `buildProjectDocument` (R1.4d:
 *     identity, never "index + structural equality") and then compares the
 *     resolved element *objects* — which is Java's `==` on the very same list.
 *  6. **A missing scalar reference is repaired instead of crashing.** Java's
 *     design classes NPE on a `null` `coolantRecipe` / `fuel` (`:71,240`); TS
 *     falls back to the configuration's first element of that list — the
 *     default the design constructors use — and reports it in
 *     {@link HellrageWriteResult.issues}.
 *  7. **The active configuration is used per configuration id.** Java resolves
 *     against `isConfigEmpty() ? Core.project : this` (`Project.java:36`) for
 *     the whole project, with addons merged in by `conglomerate()`. TS fills in
 *     every configuration id the project does not declare from the injected
 *     `root` (the shipped `nuclearcraft.ncpf.json`), and does not merge addon
 *     elements — the same limitation `writeNcpfExport` carries (R1.4).
 *  8. **Key order is the Java *source* order, not Java's `HashMap` order.**
 *     `JSON.JSONObject extends HashMap` (`JSON.java:54`), so the frozen writer's
 *     on-disk key order is hash order (visible in `datasets/fixtures/sfr-hellrage.json`).
 *     Neither reader cares — object keys are looked up, not scanned — and the
 *     position arrays inside a section *are* emitted in Java's scan order
 *     (`x`, then `y`, then `z`).
 *  9. **Number formatting is Java's.** `JSON.JSONObject.write` prints
 *     `Float.toString` (`JSON.java:236-237`), so `1080.0f` is `1080.0`, not
 *     `1080`; {@link writeHellrageText} reproduces that (and therefore the
 *     irradiator key `{"HeatPerFlux":0,"EfficiencyMultiplier":0.0}`, whose
 *     default-value spelling differs from the *null* recipe's integer `0`:
 *     `HellrageWriter.java:194`). The `JSON` tree returned by
 *     {@link writeHellrage} carries plain numbers — `JSON.parse` of the text
 *     yields the same values.
 *  10. **Escaping.** Java's `write()` concatenates raw strings, so a name
 *     containing `"` corrupts the file; TS escapes, which is byte-identical for
 *     every legal name and produces a parseable file for the illegal ones.
 *
 * The Java `ReactorOverallStats` block that the v5 reader tolerates is *not*
 * written: the v6 writer never emits it (`HellrageWriter.java:217-240`).
 */
import { COMMON_MODULE, moduleOf, modulesOf, num, type NCPFElement } from '@ncplanner/ncpf';
import { writeFileSync } from 'node:fs';
import type { NcpfDesignDocument } from '../designs.js';
import { isJsonObject, type JsonObject, type JsonValue } from '../json.js';
import {
  buildProjectDocument,
  NcpfFormatError,
  type NcpfConfigurationDocument,
  type NcpfProjectDocument,
} from '../project.js';
import {
  defaultHellrageRoot,
  HELLRAGE_NAME_TRANSFORMS,
  identityName,
  OVERHAUL_SFR,
  UNDERHAUL_SFR,
  type NameTransform,
} from './hellrage.js';
import { javaFloat } from './ncpf11.js';

// ------------------------------------------------------------------- constants

const OVERHAUL = modulesOf(OVERHAUL_SFR);
const UNDERHAUL = modulesOf(UNDERHAUL_SFR);

/** `NCPFElement.definition.type` → Java `Multiblock.getDefinitionName()`. */
const DESIGN_NAMES: Readonly<Record<string, string>> = {
  [OVERHAUL_SFR]: 'Overhaul SFR',
  [UNDERHAUL_SFR]: 'Underhaul SFR',
  'nuclearcraft:overhaul_msr': 'Overhaul MSR',
  'nuclearcraft:overhaul_turbine': 'Overhaul Turbine',
  'nuclearcraft:overhaul_distiller': 'Overhaul Distiller',
  'plannerator:fusion_test': 'Overhaul Fusion Reactor',
};

/** `Direction.values()` order — the walk `LegacyNeutronSourceHandler` uses. */
const DIRECTIONS: readonly Position[] = [
  { x: 1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: -1 },
];

interface Position {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

// --------------------------------------------------------------- value nodes

/**
 * A Hellrage value. The `int` / `float` split exists only so
 * {@link writeHellrageText} can print Java's `Float.toString` (`1080` → `1080.0`)
 * where Java holds a `Float`; `int` is Java's `Integer` (`1080` → `1080`).
 */
type HNode =
  | { readonly kind: 'object'; readonly entries: readonly (readonly [string, HNode])[] }
  | { readonly kind: 'array'; readonly items: readonly HNode[] }
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'int'; readonly value: number }
  | { readonly kind: 'float'; readonly value: number }
  | { readonly kind: 'boolean'; readonly value: boolean };

function hstr(value: string): HNode {
  return { kind: 'string', value };
}

function hint(value: number): HNode {
  return { kind: 'int', value };
}

function hfloat(value: number): HNode {
  return { kind: 'float', value };
}

function hobj(entries: readonly (readonly [string, HNode])[]): HNode {
  return { kind: 'object', entries };
}

function harr(items: readonly HNode[]): HNode {
  return { kind: 'array', items };
}

/** A position object, Java `bl.set("X"/"Y"/"Z", …)` (`HellrageWriter.java:56-59`). */
function hpos(position: Position): HNode {
  return hobj([
    ['X', hint(position.x)],
    ['Y', hint(position.y)],
    ['Z', hint(position.z)],
  ]);
}

/**
 * Java `Float.toString` (JDK ≥ 19: shortest decimal that round-trips through a
 * 32-bit float — the same rule `ncpf11.ts`'s `javaFloat` implements), rendered
 * as a *literal*: an integer value keeps its `.0`. Values large enough for
 * `toPrecision` to go exponential keep JavaScript's spelling; no field this
 * writer emits (fuel stats, irradiator stats) is anywhere near that.
 */
export function javaFloatToString(value: number): string {
  const narrowed = Math.fround(value);
  if (Number.isNaN(narrowed)) return 'NaN';
  if (narrowed === Infinity) return 'Infinity';
  if (narrowed === -Infinity) return '-Infinity';
  if (narrowed === 0) return Object.is(narrowed, -0) ? '-0.0' : '0.0';
  const text = String(javaFloat(narrowed));
  return /[.eE]/.test(text) ? text : `${text}.0`;
}

/** The plain `JsonObject` twin of a value node (`float` → a plain number). */
function toJsonValue(node: HNode): JsonValue {
  switch (node.kind) {
    case 'object': {
      const out: JsonObject = {};
      for (const [key, value] of node.entries) out[key] = toJsonValue(value);
      return out;
    }
    case 'array':
      return node.items.map(toJsonValue);
    case 'string':
      return node.value;
    case 'int':
    case 'float':
      return node.value;
    case 'boolean':
      return node.value;
  }
}

/**
 * Java `JSON.JSONObject.write` / `JSONArray.write` (`JSON.java:218-247,489-514`):
 * compact, insertion order, no trailing comma (an empty object/array collapses
 * to `{}` / `[]`). Strings are escaped — see deviation 10.
 */
function renderNode(node: HNode): string {
  switch (node.kind) {
    case 'object':
      return node.entries.length === 0
        ? '{}'
        : `{${node.entries.map(([key, value]) => `${JSON.stringify(key)}:${renderNode(value)}`).join(',')}}`;
    case 'array':
      return `[${node.items.map((item) => renderNode(item)).join(',')}]`;
    case 'string':
      return JSON.stringify(node.value);
    case 'int':
      return String(Math.trunc(node.value));
    case 'float':
      return javaFloatToString(node.value);
    case 'boolean':
      return node.value ? 'true' : 'false';
  }
}

// ---------------------------------------------------------------- name codecs

function hasModule(element: NCPFElement, module: string): boolean {
  return element.modules[module] !== undefined;
}

/**
 * `transform(identityName(element))` — the shared name codec of `hellrage.ts`.
 *
 * A configuration that has lost its `plannerator:legacy_names` modules (e.g. one
 * that went through `writeNcpfExport`, which strips every `plannerator:*`
 * module) has no name left but the definition identity (`nuclearcraft:fission_casing`),
 * which the frozen reader cannot resolve — exactly like Java's own
 * `getDisplayName()` fallback to `definition.getName()`. That is reported rather
 * than hidden.
 */
function sectionKey(element: NCPFElement, transform: NameTransform, issues: string[]): string {
  if (!hasModule(element, COMMON_MODULE.legacyNames)) {
    issues.push(
      `${element.definition.identity}: no plannerator:legacy_names module; ` +
        `the Hellrage key falls back to the definition identity, which the frozen reader cannot resolve`,
    );
  }
  return transform.apply(identityName(element));
}

/** `[OX]` / `[NI]` / `[ZA]` suffixes, in Java's check order (`:162-164`). */
const FUEL_NAME_SUFFIXES: readonly (readonly [string, string])[] = [
  [' Oxide', '[OX]'],
  [' Nitride', '[NI]'],
  ['-Zirconium Alloy', '[ZA]'],
];

/**
 * The fuel half of a Hellrage fuel-cell key: `[OX|NI|ZA]<base>` exactly like
 * `HellrageWriter.java:161-164` (which replaces *all* occurrences of the suffix,
 * hence `split().join('')`), and `[ID]<name>` for a name that carries no type
 * suffix — see deviation 4.
 */
export function hellrageFuelName(name: string): string {
  for (const [suffix, prefix] of FUEL_NAME_SUFFIXES) {
    if (name.endsWith(suffix)) return prefix + name.split(suffix).join('');
  }
  return `[ID]${name}`;
}

// ------------------------------------------------------------------- the grid

interface Cell {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly element: NCPFElement;
  readonly recipe: NCPFElement | null;
}

interface SolvedGrid {
  /** Interior size (`reactor.getInternalWidth()` … = `design.length - 2`). */
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  /** Every non-air interior cell, in Java's `x, y, z` scan order. */
  readonly cells: readonly Cell[];
  elementAt(x: number, y: number, z: number): NCPFElement | null;
  inGrid(x: number, y: number, z: number): boolean;
}

function is3d(value: JsonValue | undefined): value is JsonValue[][][] {
  return (
    Array.isArray(value) && value.every((plane) => Array.isArray(plane) && plane.every((row) => Array.isArray(row)))
  );
}

/**
 * Resolve the design's grids into interior dimensions plus the block/recipe view
 * Java builds in `OverhaulSFRDesign.convertToMultiblock` (`:64-78`) and
 * `UnderhaulSFRDesign.convertToMultiblock` (`:58-72`).
 */
function solveGrid(design: NcpfDesignDocument, issues: string[]): SolvedGrid {
  const grid = design.grid;
  if (grid === null) {
    throw new NcpfFormatError(
      `design[${design.index}]: type "${design.type ?? 'null'}" has no resolvable design grid`,
    );
  }
  // Java takes the interior size from the *array length* (`design.length - 2`),
  // not from the stored `dimensions`; when the two disagree the arrays win and
  // the mismatch is reported.
  const raw = design.raw.design;
  let dims: readonly number[];
  if (is3d(raw)) {
    dims = [raw.length, raw[0].length, raw[0][0].length];
    const stored = design.dimensions;
    if (stored.length === 3 && stored.some((value, index) => value !== dims[index])) {
      issues.push(
        `design[${design.index}]: dimensions [${stored.join(',')}] disagree with the design grid ` +
          `[${dims.join(',')}]; the grid is used`,
      );
    }
  } else {
    dims = [grid.blocks.length, grid.blocks[0]?.length ?? 0, grid.blocks[0]?.[0]?.length ?? 0];
  }
  const [dimX = 0, dimY = 0, dimZ = 0] = dims;
  const width = Math.max(0, dimX - 2);
  const height = Math.max(0, dimY - 2);
  const depth = Math.max(0, dimZ - 2);

  const elementAt = (x: number, y: number, z: number): NCPFElement | null =>
    grid.blocks[x]?.[y]?.[z] ?? null;
  const inGrid = (x: number, y: number, z: number): boolean =>
    x >= 0 && y >= 0 && z >= 0 && x < dimX && y < dimY && z < dimZ;

  const cells: Cell[] = [];
  for (let x = 1; x <= width; x++) {
    for (let y = 1; y <= height; y++) {
      for (let z = 1; z <= depth; z++) {
        const element = elementAt(x, y, z);
        if (element === null) continue;
        cells.push({ x, y, z, element, recipe: grid.recipes[x]?.[y]?.[z] ?? null });
      }
    }
  }
  return { width, height, depth, cells, elementAt, inGrid };
}

/**
 * Java `LegacyNeutronSourceHandler.addNeutronSource`'s candidate walk, read
 * backwards: the six ray end points (stopping at a fuel cell / reflector /
 * irradiator, which block the line of sight — `OverhaulSFR.java:246-258`), nearest
 * first, and the first one that actually holds a neutron source is this cell's
 * source.
 *
 * Deterministic by construction: the direction order is `Direction.values()` and
 * `Array#sort` is stable, exactly like the reader's placement pass. Java instead
 * lets each casing source *overwrite* `b.source` of every fuel cell in its line
 * of sight (`OverhaulSFR.java:248`), so with two sources aimed at one cell it
 * keeps the last one iterated; a design read from a Hellrage file only ever has
 * one source per cell (`LegacyNeutronSourceHandler` never reuses one), which is
 * the case this port has to reproduce.
 */
function findNeutronSource(grid: SolvedGrid, origin: Position): NCPFElement | null {
  const candidates: { readonly position: Position; readonly distance: number }[] = [];
  for (const direction of DIRECTIONS) {
    let step = 0;
    for (;;) {
      step++;
      const x = origin.x + direction.x * step;
      const y = origin.y + direction.y * step;
      const z = origin.z + direction.z * step;
      if (!grid.inGrid(x, y, z)) {
        candidates.push({
          position: {
            x: origin.x + direction.x * (step - 1),
            y: origin.y + direction.y * (step - 1),
            z: origin.z + direction.z * (step - 1),
          },
          distance: step,
        });
        break;
      }
      const block = grid.elementAt(x, y, z);
      if (block === null) continue; // air
      if (
        hasModule(block, OVERHAUL.fuelCell) ||
        hasModule(block, OVERHAUL.reflector) ||
        hasModule(block, OVERHAUL.irradiator)
      ) {
        break;
      }
    }
  }
  candidates.sort((a, b) => a.distance - b.distance);
  for (const candidate of candidates) {
    const block = grid.elementAt(candidate.position.x, candidate.position.y, candidate.position.z);
    if (block !== null && hasModule(block, OVERHAUL.neutronSource)) return block;
  }
  return null;
}

// ------------------------------------------------------------------- the file

export interface HellrageWriteOptions {
  /**
   * The app's active configuration — the TS equivalent of Java's `Core.project`
   * (`Configuration.NUCLEARCRAFT`), used for every configuration id the project
   * does not itself declare (`Project.java:36`). Defaults to the shipped
   * `src/configurations/nuclearcraft.ncpf.json`.
   */
  readonly root?: JsonObject;
  /** Container label used in diagnostics (`<hellrage-write>` by default). */
  readonly container?: string;
}

export interface HellrageWriteResult {
  /** The Hellrage document (`SaveVersion` plus `Data` or the v2 top level). */
  readonly json: JsonObject;
  /** The compact Java-faithful serialization of {@link json} (see deviation 9). */
  readonly text: string;
  /** Non-fatal oddities (repaired scalar references, skipped cells, …). */
  readonly issues: readonly string[];
}

/** Fill in every configuration id `project` does not declare from `root`. */
function withFallbackConfiguration(project: JsonObject, root: JsonObject): JsonObject {
  const own = isJsonObject(project.configuration) ? project.configuration : {};
  const fallback = isJsonObject(root.configuration) ? root.configuration : {};
  const merged: JsonObject = { ...own };
  for (const [id, configuration] of Object.entries(fallback)) {
    if (!(id in merged)) merged[id] = configuration;
  }
  return { ...project, configuration: merged };
}

function configurationOf(document: NcpfProjectDocument, id: string): NcpfConfigurationDocument {
  const configuration = document.getConfiguration(id);
  if (configuration === undefined) {
    throw new NcpfFormatError(`the active configuration has no "${id}" configuration`);
  }
  return configuration;
}

/** The design's scalar element reference, repaired like deviation 6 describes. */
function scalarReference(
  design: NcpfDesignDocument,
  configuration: NcpfConfigurationDocument,
  key: string,
  listName: string,
  issues: string[],
): NCPFElement | null {
  const element = design.scalarReferences.get(key)?.element ?? null;
  if (element !== null) return element;
  const fallback = configuration.list(listName)[0] ?? null;
  if (fallback === null) {
    issues.push(
      `design[${design.index}]: ${key} is unset and the configuration declares no ${listName}; ` +
        `the field is written empty, which the frozen reader rejects`,
    );
    return null;
  }
  issues.push(
    `design[${design.index}]: ${key} is unset; using the configuration's first ${listName} element ` +
      `(${identityName(fallback)})`,
  );
  return fallback;
}

/** Build the document, then dispatch on the design type (`HellrageWriter.java:33-40`). */
function buildHellrage(project: JsonObject, options: HellrageWriteOptions): HellrageWriteResult {
  const root = options.root ?? defaultHellrageRoot();
  const document = buildProjectDocument(
    withFallbackConfiguration(project, root),
    options.container ?? '<hellrage-write>',
  );

  const designs = document.designs;
  if (designs.length === 0) {
    // `HellrageWriter.java:250`
    throw new NcpfFormatError('Cannot export NCPF configuration to Hellrage JSON format!');
  }
  if (designs.length > 1) {
    // `HellrageWriter.java:34`
    throw new NcpfFormatError('Multiple designs are not supported by Hellrage JSON!');
  }
  const design = designs[0];
  const type = design.type;
  if (type === null || !(type in DESIGN_NAMES)) {
    // `HellrageWriter.java:36` — an unregistered type is a plain `Design`, not a
    // `MultiblockDesign`.
    throw new NcpfFormatError(`Cannot export non-multiblock design ${type ?? 'null'} to Hellrage JSON!`);
  }

  const issues: string[] = [];
  const node =
    type === UNDERHAUL_SFR
      ? underhaulDocument(document, design, issues)
      : type === OVERHAUL_SFR
        ? overhaulDocument(document, design, issues)
        : unsupported(type);

  return { json: toJsonValue(node) as JsonObject, text: renderNode(node), issues };
}

function unsupported(type: string): never {
  // `HellrageWriter.java:247`
  throw new NcpfFormatError(`${DESIGN_NAMES[type] ?? type} is not supported by Hellrage JSON!`);
}

/**
 * Write an NCPF project tree as Hellrage JSON (`HellrageWriter.write`).
 *
 * @throws NcpfFormatError on every input Java refuses: no design, more than one
 * design, a non-multiblock design, or a design type Hellrage has no dialect for.
 */
export function writeHellrage(project: JsonObject, options: HellrageWriteOptions = {}): HellrageWriteResult {
  return buildHellrage(project, options);
}

/** The Hellrage JSON tree only (see {@link writeHellrage}). */
export function writeHellrageJson(project: JsonObject, options: HellrageWriteOptions = {}): JsonObject {
  return writeHellrage(project, options).json;
}

/**
 * The Java-faithful compact text (what `JSON.JSONObject.write` would have
 * produced, modulo key order and escaping — deviations 8 and 10).
 */
export function writeHellrageText(project: JsonObject, options: HellrageWriteOptions = {}): string {
  return writeHellrage(project, options).text;
}

export function writeHellrageFile(
  project: JsonObject,
  path: string,
  options: HellrageWriteOptions = {},
): HellrageWriteResult {
  const result = writeHellrage(project, options);
  writeFileSync(path, result.text, 'utf8');
  return result;
}

// ------------------------------------------------------------------ underhaul

/**
 * `HellrageWriter.java:38-80` — Underhaul SFR v2.
 *
 * `CompressedReactor` carries one key per `UnderhaulSFRConfiguration.blocks`
 * entry (empty arrays included, hence `put` on every element), the interior size,
 * and the fuel's name plus its three stats. Coolant ("active cooler") recipes are
 * *not* saved — the Java `Core.warning` says so in as many words, and the reader
 * guesses them back from the key (`UnderhaulHellrage2Reader.java:42-46`).
 */
function underhaulDocument(
  document: NcpfProjectDocument,
  design: NcpfDesignDocument,
  issues: string[],
): HNode {
  const configuration = configurationOf(document, UNDERHAUL_SFR);
  const grid = solveGrid(design, issues);

  const positions = new Map<NCPFElement, Position[]>();
  for (const cell of grid.cells) {
    const list = positions.get(cell.element);
    if (list === undefined) positions.set(cell.element, [{ x: cell.x, y: cell.y, z: cell.z }]);
    else list.push({ x: cell.x, y: cell.y, z: cell.z });
  }

  const compressedReactor: (readonly [string, HNode])[] = [];
  for (const block of configuration.list('blocks')) {
    const key = sectionKey(block, HELLRAGE_NAME_TRANSFORMS.underhaulBlockWrite, issues);
    compressedReactor.push([key, harr((positions.get(block) ?? []).map(hpos))]);
  }

  const fuel = scalarReference(design, configuration, 'fuel', 'fuels', issues);
  const stats = fuel === null ? undefined : moduleOf(fuel, UNDERHAUL.fuelStats);

  const usedFuel = hobj([
    ['Name', hstr(fuel === null ? '' : identityName(fuel))],
    ['BasePower', hfloat(num(stats, 'power'))],
    ['BaseHeat', hfloat(num(stats, 'heat'))],
    ['FuelTime', hint(num(stats, 'time'))],
  ]);

  return hobj([
    ['SaveVersion', saveVersion(1, 2, 23)],
    ['CompressedReactor', hobj(compressedReactor)],
    ['InteriorDimensions', hobj([['X', hint(grid.width)], ['Y', hint(grid.height)], ['Z', hint(grid.depth)]])],
    ['UsedFuel', usedFuel],
  ]);
}

// ------------------------------------------------------------------- overhaul

/**
 * `HellrageWriter.java:81-247` — Overhaul SFR v6, sections nested under `Data`.
 */
function overhaulDocument(
  document: NcpfProjectDocument,
  design: NcpfDesignDocument,
  issues: string[],
): HNode {
  const configuration = configurationOf(document, OVERHAUL_SFR);
  const grid = solveGrid(design, issues);

  const positions = new Map<NCPFElement, Position[]>();
  for (const cell of grid.cells) {
    const list = positions.get(cell.element);
    if (list === undefined) positions.set(cell.element, [{ x: cell.x, y: cell.y, z: cell.z }]);
    else list.push({ x: cell.x, y: cell.y, z: cell.z });
  }
  const cellOf = new Map<string, Cell>();
  for (const cell of grid.cells) cellOf.set(`${cell.x},${cell.y},${cell.z}`, cell);

  const heatSinks = new Map<string, Position[]>();
  const moderators = new Map<string, Position[]>();
  const reflectors = new Map<string, Position[]>();
  const neutronShields = new Map<string, Position[]>();
  const fuelCells = new Map<string, Position[]>();
  const irradiators = new Map<string, Position[]>();
  const conductors: Position[] = [];

  const section = (
    target: Map<string, Position[]>,
    transform: NameTransform,
    block: NCPFElement,
  ): void => {
    const key = sectionKey(block, transform, issues);
    if (key.length === 0) {
      issues.push(
        `section key for ${identityName(block)} is empty; the frozen reader reports "Invalid block name: !"`,
      );
    }
    target.set(key, positions.get(block) ?? []);
  };

  // Java walks `config.blocks` once and appends to every section the block
  // belongs to (`HellrageWriter.java:99-216`); the fuel-cell / irradiator maps
  // are keyed by the *computed* name and keep first-seen order.
  for (const block of configuration.list('blocks')) {
    if (hasModule(block, OVERHAUL.heatsink)) section(heatSinks, HELLRAGE_NAME_TRANSFORMS.heatSink, block);
    if (hasModule(block, OVERHAUL.moderator)) section(moderators, HELLRAGE_NAME_TRANSFORMS.moderator, block);
    if (hasModule(block, OVERHAUL.reflector)) section(reflectors, HELLRAGE_NAME_TRANSFORMS.reflector, block);
    if (hasModule(block, OVERHAUL.neutronShield)) {
      section(neutronShields, HELLRAGE_NAME_TRANSFORMS.neutronShield, block);
    }
    if (hasModule(block, OVERHAUL.fuelCell)) {
      for (const position of positions.get(block) ?? []) {
        const cell = cellOf.get(`${position.x},${position.y},${position.z}`);
        const fuel = cell?.recipe ?? null;
        if (fuel === null) {
          // Java NPEs on `block.getRecipe().getDisplayName()` (`:161`).
          issues.push(
            `FuelCells: (${position.x},${position.y},${position.z}) carries no fuel recipe; the cell is not written`,
          );
          continue;
        }
        const source = findNeutronSource(grid, position);
        const primed = source !== null;
        const key =
          `${hellrageFuelName(identityName(fuel))};${primed ? 'True' : 'False'};` +
          `${primed ? identityName(source) : 'None'}`;
        const list = fuelCells.get(key);
        if (list === undefined) fuelCells.set(key, [position]);
        else list.push(position);
      }
    }
    if (hasModule(block, OVERHAUL.irradiator)) {
      for (const position of positions.get(block) ?? []) {
        const key = irradiatorKey(cellOf.get(`${position.x},${position.y},${position.z}`)?.recipe ?? null);
        const list = irradiators.get(key);
        if (list === undefined) irradiators.set(key, [position]);
        else list.push(position);
      }
    }
  }

  // `Conductors` is a single flat array over every conducting block
  // (`HellrageWriter.java:223-234` → `block.isConductor()`).
  for (const cell of grid.cells) {
    if (hasModule(cell.element, OVERHAUL.conductor)) conductors.push({ x: cell.x, y: cell.y, z: cell.z });
  }

  const coolant = scalarReference(design, configuration, 'coolant_recipe', 'coolant_recipes', issues);
  const data = hobj([
    ['HeatSinks', hobj([...heatSinks].map(([key, list]) => [key, harr(list.map(hpos))] as const))],
    ['Moderators', hobj([...moderators].map(([key, list]) => [key, harr(list.map(hpos))] as const))],
    ['Reflectors', hobj([...reflectors].map(([key, list]) => [key, harr(list.map(hpos))] as const))],
    ['FuelCells', hobj([...fuelCells].map(([key, list]) => [key, harr(list.map(hpos))] as const))],
    ['Irradiators', hobj([...irradiators].map(([key, list]) => [key, harr(list.map(hpos))] as const))],
    ['NeutronShields', hobj([...neutronShields].map(([key, list]) => [key, harr(list.map(hpos))] as const))],
    ['Conductors', harr(conductors.map(hpos))],
    ['InteriorDimensions', hobj([['X', hint(grid.width)], ['Y', hint(grid.height)], ['Z', hint(grid.depth)]])],
    ['CoolantRecipeName', hstr(coolant === null ? '' : identityName(coolant))],
  ]);

  return hobj([
    ['SaveVersion', saveVersion(2, 1, 1)],
    ['Data', data],
  ]);
}

/**
 * `HellrageWriter.java:194` — the irradiator recipe is serialized *into the key*,
 * with the heat truncated to an `int` and the efficiency printed as a Java float
 * (`0` / `0.0` when the cell has no recipe, exactly the Java default branch).
 */
function irradiatorKey(recipe: NCPFElement | null): string {
  const stats = recipe === null ? undefined : moduleOf(recipe, OVERHAUL.irradiatorStats);
  const heat = Math.trunc(num(stats, 'heat'));
  const efficiency = num(stats, 'efficiency');
  return `{"HeatPerFlux":${heat},"EfficiencyMultiplier":${javaFloatToString(efficiency)}}`;
}

function saveVersion(major: number, minor: number, build: number): HNode {
  return hobj([
    ['Major', hint(major)],
    ['Minor', hint(minor)],
    ['Build', hint(build)],
    ['Revision', hint(0)],
    ['MajorRevision', hint(0)],
    ['MinorRevision', hint(0)],
  ]);
}
