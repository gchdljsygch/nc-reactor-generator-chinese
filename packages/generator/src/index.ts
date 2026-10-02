/**
 * `@ncplanner/generator` — the R4 search engine, ported from
 * `multiblock/generator/lite/**` of the frozen Java tree.
 *
 * **Iron law 1 holds here too.** The generator does not own a physics engine: it
 * owns an *index grid* and drives `@ncplanner/kernel`'s fast entry
 * (`SfrFastReactor` / `UsfrFastReactor`), which reuses the very same
 * `OverhaulSfrReactor` / `UnderhaulSfrReactor` the editor's statistics panel calls.
 * The frozen Java code had two engines (`LiteOverhaulSFR` vs `OverhaulSFR`) and R0
 * measured them disagreeing on 33.9% of random grids; this port deliberately does
 * not reproduce that.
 *
 * What *is* ported line-for-line is the **search framework**, because that is what
 * defines the character of the reactors users get:
 *
 * | Java | here |
 * |---|---|
 * | `LiteGenerator` | `LiteGenerator` (`generator.ts`) |
 * | `GeneratorStage` / `StageTransition` / `Priority` | `generator.ts` |
 * | `variable/**` (constants, operators, settings) | `variable.ts`, `expression.ts`, `setting.ts` |
 * | `condition/**` | `condition.ts` |
 * | `mutator/**` + `overhaulSFR/mutators/**` + `underhaulSFR/mutators/**` | `mutator.ts`, `mutators/` |
 * | `Symmetry` | `symmetry.ts` |
 * | `anim/**` | `anim.ts` |
 * | `plannerator:generator_settings` NCPF module | `ncpf.ts` |
 * | `MenuGenerator.start()` / `GenerationThread` | `driver.ts` (single-threaded core + worker pool) |
 * | DSSL scripts | `script.ts` (deliberately **not** a scripting language — plan §9 D5) |
 *
 * Two things replace Java mechanisms the rewrite plan calls out:
 *
 *  - **explicit registries instead of reflection** (§4.4d). Java discovered
 *    conditions/operators/constants/parameters/mutators with a classpath scan
 *    (`planner/module/Module.java:126-131`); every registry here is a literal map,
 *    so the set of loadable types is visible in the source and the load order is
 *    deterministic.
 *  - **a seeded `java.util.Random`** instead of `new Random()` per thread. The
 *    frozen Java generator is not reproducible at all (each thread seeds from the
 *    clock); the same LCG seeded explicitly makes a generation run repeatable,
 *    which is what makes it testable. `docs/r4/README.md` records this as a
 *    deliberate improvement, not a fidelity claim.
 */

export * from './variable.js';
export * from './random.js';
export * from './json.js';
export * from './symmetry.js';
export * from './expression.js';
export * from './setting.js';
export * from './condition.js';
export * from './mutator.js';
export * from './generator.js';
export * from './compiled.js';
export * from './compiled-import.js';
export * from './grid.js';
export * from './reactors/sfr.js';
export * from './reactors/usfr.js';
export * from './ncpf.js';
export * from './presets.js';
export * from './driver.js';
export * from './anim.js';
export * from './script.js';

// Both flavour modules export the same three class names. `export *` would silently
// drop every ambiguous name, making them unreachable rather than visible, so the
// shared names are exported only through these explicit aliases.
export {
  ClearInvalidMutator as SfrClearInvalidMutator,
  RandomBlockMutator as SfrRandomBlockMutator,
  RandomCellMutator,
  RandomCoolantRecipeMutator,
  registerSfrMutators,
  forEachInCell,
} from './mutators/sfr.js';
export {
  ClearInvalidMutator as UsfrClearInvalidMutator,
  RandomBlockMutator as UsfrRandomBlockMutator,
  RandomFuelMutator,
  registerUsfrMutators,
} from './mutators/usfr.js';

/**
 * Install every shipped mutator in the registries.
 *
 * Java did this with a classpath scan at module load; here it is an explicit call so
 * the worker entry can decide when to pay for it (and so a test can assert the
 * registry contents). {@link loadGeneratorPresets} calls it, so most callers never
 * need to.
 */
import { registerSfrMutators as registerSfr } from './mutators/sfr.js';
import { registerUsfrMutators as registerUsfr } from './mutators/usfr.js';

export function registerAllMutators(): void {
  registerSfr();
  registerUsfr();
}

// Register on import.
//
// Java discovered these with a classpath scan at module load, so anything that parsed a
// generator document could assume every mutator was known. Making registration an
// explicit opt-in reproduced that guarantee only as long as every caller remembered —
// and `parseGeneratorDocument` genuinely needs it, so forgetting produced
// "failed to load unregistered mutator" from a call site that looks unrelated. Doing it
// at import keeps the Java guarantee and costs one Map write per mutator.
//
// `MUTATORS` is a plain `Map`, so registering twice is idempotent: the second write
// replaces the factory with an equivalent one.
registerAllMutators();
