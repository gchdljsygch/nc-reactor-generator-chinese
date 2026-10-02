/**
 * `mutator/**` of the frozen generator — the framework plus the two *quantity*
 * wrappers.
 *
 * ## The two-level shape, and why it is confusing
 *
 * Java has **two** unrelated `Mutator` concepts, and the presets' JSON shows both:
 *
 *  - `Mutator<T>` (`mutatorType` like `nuclearcraft:overhaul_sfr:random_block`) —
 *    the thing that actually edits a grid. Its serialized form is
 *    `{ type: <mutatorType>, ...body }`.
 *  - `GeneratorMutator<T>` (`mutatorType` `single` | `random_quantity`) — a
 *    *quantity* wrapper: "run that mutator once", or "run it a random number of
 *    times". Its serialized form is `{ mutator: {...}, type: <quantity> }`.
 *
 * A *step* of a stage is a `GeneratorMutator`; the `indicies`/`symmetry`/… keys the
 * presets show live one level down, inside `mutator`.
 *
 * ## Deliberate divergence: `random_quantity` bounds are written
 *
 * `RandomQuantityMutator` owns `min`/`max` (`SettingVariable`s defaulting to 1 and
 * 100) and Java's `convertToObject` **never writes them** — the base
 * `GeneratorMutator.convertToObject` writes only `mutator`, and neither subclass
 * overrides it. So a user who sets "50 to 200 tries" and saves loses it silently,
 * and all four shipped presets are stuck at the 1..100 default. We write `min` and
 * `max`, and read them when present, which makes a saved generator mean what it
 * says. Loading a preset still yields the Java defaults, so the shipped presets are
 * unaffected.
 *
 * ## Also not serialized in Java: `GeneratorMutator.conditions`
 *
 * `convertFromObject` reads only `mutator`, so per-step conditions never round-trip
 * either. `LiteGenerator` *does* evaluate them (`GeneratorStage.run`), so they are
 * reachable only from the in-memory UI. We keep the field (the stage runner needs
 * it) and inherit Java's behaviour of not writing it, because writing a condition
 * list Java cannot read back would make our files un-openable upstream. That
 * asymmetry is listed in the R4 report.
 */

import { currentRandom, ConstInt, SettingVariable } from './expression.js';
import type { DeferredSink, VariableResolver } from './expression.js';
import type { GeneratorGrid } from './grid.js';
import type { JsonObject } from './json.js';
import { arrayOf, intArrayOf, objectOf, stringOf } from './json.js';
import type { Setting } from './setting.js';
import { expressionSetting, SettingIndicies, SettingSymmetry } from './setting.js';
import { Symmetry } from './symmetry.js';
import type { Condition } from './condition.js';
import { conditionsFromJson } from './condition.js';
import { toInt } from './variable.js';

/** The loosest grid type a `Mutator` implementation is written against. */
export type AnyGrid = GeneratorGrid<unknown>;

/**
 * A mutator that edits a grid.
 *
 * Method syntax (not function-typed properties) is used on purpose: TypeScript
 * checks methods bivariantly, so `Mutator<SfrGeneratorGrid>` is assignable to
 * `Mutator<AnyGrid>` without a cast, which is what lets one registry hold both
 * reactor flavours — Java achieved the same thing with an unchecked
 * `ClassCastException` workaround in `getRegisteredMutators`.
 */
export interface Mutator<TGrid extends AnyGrid = AnyGrid> {
  /** Java `RegisteredNCPFObject.name` — `nuclearcraft:<config>:<mutator>`. */
  readonly mutatorType: string;
  readonly title: string;
  readonly tooltip: string;
  /** Java `ThingWithSettings` — exposed for the UI, never serialized here. */
  readonly settings: readonly Setting[];
  /** Java `Mutator.init` — called by the configuration UI, not by the run loop. */
  init(grid: TGrid): void;
  /** Java `Mutator.setIndicies` — (re)build the label list from the grid's config. */
  setIndicies(grid: TGrid): void;
  /** Java `Mutator.run`. Uses the ambient RNG (`withRandom`). */
  run(grid: TGrid): void;
  /**
   * Java `Mutator.importFrom`: re-derive the stored indices against `source`, the
   * configuration the indices were written for. `source === null` means "the same
   * configuration", which is Java's own no-op case.
   */
  importFrom(grid: TGrid, source: unknown): void;
  toJson(): JsonObject;
  fromJson(json: JsonObject, sink?: DeferredSink): void;
}

/** Shared implementation: mutable `symmetry`/`indicies` settings and their JSON. */
export abstract class BaseMutator<TGrid extends AnyGrid = AnyGrid> implements Mutator<TGrid> {
  abstract readonly mutatorType: string;
  abstract readonly title: string;
  abstract readonly tooltip: string;

  readonly indicies = new SettingIndicies('Blocks');
  readonly symmetry = new SettingSymmetry();

  abstract readonly settings: readonly Setting[];

  init(_grid: TGrid): void {}

  abstract setIndicies(grid: TGrid): void;

  abstract run(grid: TGrid): void;

  importFrom(_grid: TGrid, _source: unknown): void {}

  /** Java `convertToObject` for a `Mutator`: the body, then the `type` key. */
  toJson(): JsonObject {
    return { ...this.bodyJson(), type: this.mutatorType };
  }

  fromJson(json: JsonObject, _sink?: DeferredSink): void {
    this.loadBody(json);
  }

  protected bodyJson(): JsonObject {
    return {
      indicies: [...this.indicies.get()],
      symmetry: this.symmetry.get().toJson(),
    };
  }

  protected loadBody(json: JsonObject): void {
    this.indicies.set(intArrayOf(json.indicies));
    this.symmetry.set(Symmetry.fromJson(objectOf(json.symmetry)));
  }
}

// ---------------------------------------------------------------------------
// quantity wrappers
// ---------------------------------------------------------------------------

/**
 * Java `GeneratorMutator` — a quantity wrapper plus a `Hits` variable.
 *
 * `conditions` are Java-defined and stage-runner-relevant but never serialized; see
 * the module header.
 */
export abstract class GeneratorMutator<TGrid extends AnyGrid = AnyGrid> {
  hits = 0;
  mutator!: Mutator<TGrid>;
  conditions: Condition[] = [];

  protected constructor(readonly mutatorType: string) {}

  abstract readonly title: string;
  abstract readonly tooltip: string;
  abstract readonly settings: readonly Setting[];

  reset(): void {
    this.hits = 0;
    for (const condition of this.conditions) condition.reset();
  }

  setIndicies(grid: TGrid): void {
    this.mutator.setIndicies(grid);
  }

  run(grid: TGrid): void {
    this.hits++;
    this.mutator.run(grid);
  }

  protected bodyJson(resolver: VariableResolver): JsonObject {
    return { mutator: this.mutator.toJson(), type: this.mutatorType, ...this.extraJson(resolver) };
  }

  /** `random_quantity` adds `min`/`max`; see the module header. */
  protected extraJson(_resolver: VariableResolver): JsonObject {
    return {};
  }

  toJson(resolver: VariableResolver): JsonObject {
    return this.bodyJson(resolver);
  }

  protected loadExtra(
    _json: JsonObject,
    _resolver: VariableResolver,
    _sink?: DeferredSink,
  ): void {}

  load(json: JsonObject, resolver: VariableResolver, sink?: DeferredSink): void {
    const mutatorJson = objectOf(json.mutator);
    const type = stringOf(mutatorJson.type);
    const factory = MUTATORS.get(type);
    if (factory === undefined) {
      throw new Error(`failed to load unregistered mutator: ${type}`);
    }
    this.mutator = factory() as unknown as Mutator<TGrid>;
    this.mutator.fromJson(mutatorJson, sink);
    this.conditions = conditionsFromJson(json.conditions, resolver, sink);
    this.loadExtra(json, resolver, sink);
  }
}

/** Java `SingleMutator` — "Runs once per iteration". */
export class SingleMutator<TGrid extends AnyGrid = AnyGrid> extends GeneratorMutator<TGrid> {
  readonly title = 'Single Mutator';
  readonly tooltip = 'Runs once per iteration';
  readonly settings: readonly Setting[] = [];

  constructor() {
    super('single');
  }
}

/** Java `RandomQuantityMutator` — "Evenly distributed between min and max". */
export class RandomQuantityMutator<
  TGrid extends AnyGrid = AnyGrid,
> extends GeneratorMutator<TGrid> {
  readonly title = 'Random Quantity Mutator';
  readonly tooltip =
    'Runs a random number of times per iteration\nEvenly distributed between min and max';

  /**
   * Java declares these as `SettingVariable<Integer>` over a `ConstInt`, not as
   * plain ints — so the UI can bind either bound to another generator variable
   * (`generator.settings.*`, a stage's `Hits`, …). Reproduced as expressions.
   */
  min = new SettingVariable('Minimum tries', new ConstInt(1));
  max = new SettingVariable('Maximum tries', new ConstInt(100));

  constructor() {
    super('random_quantity');
  }

  get settings(): readonly Setting[] {
    return [
      expressionSetting(
        'Minimum tries',
        () => this.min.value,
        (value) => this.min.set(value),
      ),
      expressionSetting(
        'Maximum tries',
        () => this.max.value,
        (value) => this.max.set(value),
      ),
    ];
  }

  override run(grid: TGrid): void {
    this.hits++;
    const random = currentRandom();
    const min = toInt(this.min.get());
    const max = toInt(this.max.get());
    // Java `rand.nextInt(max - min + 1) + min`.
    const tries = random.nextIntBound(max - min + 1) + min;
    for (let i = 0; i < tries; i++) this.mutator.run(grid);
  }

  protected override extraJson(resolver: VariableResolver): JsonObject {
    return { min: this.min.toJson(resolver), max: this.max.toJson(resolver) };
  }

  protected override loadExtra(json: JsonObject, resolver: VariableResolver): void {
    // Absent in every file the frozen Java wrote (it never serialized them); the
    // Java defaults are 1 and 100.
    if (json.min !== undefined) this.min = SettingVariable.fromJson(objectOf(json.min), resolver);
    if (json.max !== undefined) this.max = SettingVariable.fromJson(objectOf(json.max), resolver);
  }
}

// ---------------------------------------------------------------------------
// registries
// ---------------------------------------------------------------------------

/**
 * `Mutator.registeredMutators` — the explicit replacement for Java's classpath scan
 * (rewrite plan §4.4d). Every concrete mutator is registered from
 * `mutators/sfr.ts` / `mutators/usfr.ts`, which `presets.ts` imports for its side
 * effect.
 */
export const MUTATORS = new Map<string, () => Mutator<AnyGrid>>();

/** `GeneratorMutator.registeredMutators`. */
export const GENERATOR_MUTATORS = new Map<string, () => GeneratorMutator<AnyGrid>>([
  ['single', () => new SingleMutator()],
  ['random_quantity', () => new RandomQuantityMutator()],
]);

export function registerMutator<TGrid extends AnyGrid>(
  mutatorType: string,
  factory: () => Mutator<TGrid>,
): void {
  MUTATORS.set(mutatorType, factory as unknown as () => Mutator<AnyGrid>);
}

/** Java `ncpf.getRegisteredNCPFList("steps", …)` for one entry. */
export function generatorMutatorFromJson(
  json: JsonObject,
  resolver: VariableResolver,
  sink?: DeferredSink,
): GeneratorMutator<AnyGrid> {
  const type = stringOf(json.type);
  const factory = GENERATOR_MUTATORS.get(type);
  if (factory === undefined) {
    throw new Error(`failed to load unregistered generator mutator: ${type}`);
  }
  const mutator = factory();
  mutator.load(json, resolver, sink);
  return mutator;
}

export function generatorMutatorsFromJson(
  value: unknown,
  resolver: VariableResolver,
  sink?: DeferredSink,
): GeneratorMutator<AnyGrid>[] {
  return arrayOf(value)
    .filter((v): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v))
    .map((v) => generatorMutatorFromJson(v, resolver, sink));
}

export { conditionsFromJson };
