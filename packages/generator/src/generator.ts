/**
 * `LiteGenerator` / `GeneratorStage` / `Priority` / `StageTransition` — the search
 * framework.
 *
 * The loop below is a faithful port of `LiteGenerator.java:52-127`, collapsing the
 * Java `synchronized(priorityMultiblock)` / `synchronized(stageTransitioner)` blocks
 * into their single-threaded meaning (the lock was only ever held by one thread at a
 * time; see the R4 report on the worker pool, where each worker owns its own
 * scratch). What matters and is preserved exactly:
 *
 *  1. **`hits` and `timestamps` are bumped before the stage runs**, so the progress
 *     rate a user reads is "iterations started per second", not finished.
 *  2. **Priorities short-circuit to the next priority**, not out of the loop, when a
 *     condition fails; a condition's failure still counts as a `hits` increment.
 *  3. **`multiblock2` is a scratch copy fed by `copyVarsFrom`** — it holds the
 *     *candidate's* numbers while `multiblock` still holds the incumbent's, which is
 *     what lets a priority compare "new vs best".
 *  4. **Transition order is conditions → post-processing → `hits` → store →
 *     consolidate → stop/target.** Post-processing runs *before* the transition
 *     counter is bumped, and only for the transition that fires.
 *  5. **`store` snapshots `original`, not the candidate** (Java
 *     `original.copy()`), and `consolidate` then re-scores every stored multiblock
 *     through the *current* stage's priorities.
 *  6. **A stage change resets only the target stage's `hits`**, not its mutators'
 *     counters: `GeneratorStage.reset()` is only reachable through
 *     `LiteGenerator.reset()`, i.e. at the start of a run.
 */

import type { Condition } from './condition.js';
import { conditionsFromJson } from './condition.js';
import type { DeferredSink, SettingVariable } from './expression.js';
import { SettingVariable as SettingVariableImpl, withRandom, type VariableResolver } from './expression.js';
import type { GeneratorGrid } from './grid.js';
import type { JsonObject } from './json.js';
import { arrayOf, booleanOf, numberOf, objectOf, stringOf } from './json.js';
import type { GeneratorMutator } from './mutator.js';
import { generatorMutatorsFromJson } from './mutator.js';
import type { JavaRandom } from './random.js';
import type { Parameter, Setting } from './setting.js';
import { SettingBoolean, SettingInt, parameterFromJson } from './setting.js';
import { intVariable, longVariable, type Variable } from './variable.js';

/** Java `Priority` — conditions, then one expression whose sign decides. */
export class Priority {
  hits = 0;
  conditions: Condition[] = [];
  /** Java `SettingVariable<Float> operator = … new OperatorSubtraction()`. */
  operator: SettingVariable | null = null;

  private readonly hitsVariable = longVariable('Hits', () => this.hits);

  reset(): void {
    this.hits = 0;
    for (const condition of this.conditions) condition.reset();
  }

  variables(): readonly Variable[] {
    return [this.hitsVariable];
  }

  collectConditionVariables(
    prefix: string,
    out: { path: string; variable: Variable }[],
  ): void {
    this.conditions.forEach((condition, i) => {
      condition.collectVariables(
        `${prefix}.conditions[${i}]{Condition ${i + 1} (${condition.title})}`,
        out,
      );
    });
  }

  toJson(resolver: VariableResolver): JsonObject {
    return {
      conditions: this.conditions.map((c) => c.toJson(resolver)),
      operator: this.operator?.toJson(resolver) ?? {},
    };
  }

  /** `SettingVariable<Float>` with no explicit value defaults to Java's `1 - 1`. */
  score(): number {
    if (this.operator === null) throw new Error('priority has no operator');
    return Number(this.operator.get());
  }
}

/** Java `StageTransition`. */
export class StageTransition {
  hits = 0;
  conditions: Condition[] = [];
  targetStage = new SettingInt('Target Stage', 0);
  store = new SettingBoolean('Store Multiblock', false);
  consolidate = new SettingBoolean('Consolidate Stored Multiblocks', false);
  stop = new SettingBoolean('Stop Generation', false);

  private readonly hitsVariable = longVariable('Hits', () => this.hits);

  reset(): void {
    this.hits = 0;
    for (const condition of this.conditions) condition.reset();
  }

  settings(): readonly Setting[] {
    return [this.targetStage, this.store, this.consolidate, this.stop];
  }

  variables(): readonly Variable[] {
    return [this.hitsVariable];
  }

  collectConditionVariables(
    prefix: string,
    out: { path: string; variable: Variable }[],
  ): void {
    this.conditions.forEach((condition, i) => {
      condition.collectVariables(
        `${prefix}.conditions[${i}]{Condition ${i + 1} (${condition.title})}`,
        out,
      );
    });
  }

  toJson(resolver: VariableResolver): JsonObject {
    return {
      target_stage: this.targetStage.get(),
      consolidate: this.consolidate.get(),
      stop: this.stop.get(),
      store: this.store.get(),
      conditions: this.conditions.map((c) => c.toJson(resolver)),
    };
  }
}

/** Java `GeneratorStage`. */
export class GeneratorStage<TGrid extends GeneratorGrid<TGrid>> {
  hits = 0;
  steps: GeneratorMutator<TGrid>[] = [];
  stageTransitions: StageTransition[] = [];
  priorities: Priority[] = [];
  postProcessing: GeneratorMutator<TGrid>[] = [];

  private readonly hitsVariable = longVariable('Hits', () => this.hits);

  /** Java `GeneratorStage.run`: bump the stage counter, then run each step. */
  run(grid: TGrid): void {
    this.hits++;
    STEP: for (const step of this.steps) {
      for (const condition of step.conditions) {
        condition.hits++;
        if (!condition.check()) continue STEP;
      }
      step.run(grid);
    }
  }

  runPostProcessing(grid: TGrid): void {
    STEP: for (const step of this.postProcessing) {
      for (const condition of step.conditions) {
        condition.hits++;
        if (!condition.check()) continue STEP;
      }
      step.run(grid);
    }
  }

  reset(): void {
    this.hits = 0;
    for (const step of this.steps) step.reset();
    for (const transition of this.stageTransitions) transition.reset();
    for (const priority of this.priorities) priority.reset();
    for (const step of this.postProcessing) step.reset();
  }

  setIndicies(grid: TGrid): void {
    for (const step of this.steps) step.setIndicies(grid);
    for (const step of this.postProcessing) step.setIndicies(grid);
  }

  variables(): readonly Variable[] {
    return [this.hitsVariable];
  }

  toJson(resolver: VariableResolver): JsonObject {
    return {
      steps: this.steps.map((s) => s.toJson(resolver)),
      stage_transitions: this.stageTransitions.map((t) => t.toJson(resolver)),
      priorities: this.priorities.map((p) => p.toJson(resolver)),
      post_processing: this.postProcessing.map((s) => s.toJson(resolver)),
    };
  }
}

/**
 * Install `rand` as the ambient run RNG used by `condition.check()` and by the
 * mutators' `ConstRandom`.
 *
 * There is exactly **one** ambient slot, set once per `LiteGenerator.run` call and
 * cleared in a `finally`. An earlier revision also re-entered `withRandom` around
 * every condition check; because `withRandom` restores the *previous* value on exit,
 * that inner save/restore made the RNG visible to a condition depend on how deeply
 * the call was nested — the same seed then produced different grids. Keeping a single
 * slot and never re-entering it is what makes a run reproducible.
 */
export function withRunRandom<T>(rand: JavaRandom, body: () => T): T {
  return withRandom(rand, body);
}

/** Callbacks Java passed as four `Consumer`/`Runnable`s. */
export interface GeneratorCallbacks<TGrid> {
  readonly onUpgrade: (grid: TGrid) => void;
  readonly onStore: (grid: TGrid) => void;
  readonly onExit: () => void;
  readonly onConsolidate: () => void;
}

/**
 * Java `LiteGenerator`. `TGrid` is a generator grid; `mutiblock`/`original`/
 * `priorityMultiblock` are the caller's three grids.
 */
export class LiteGenerator<TGrid extends GeneratorGrid<TGrid>> {
  name: string;
  parameters: Parameter[] = [];
  stages: GeneratorStage<TGrid>[] = [];
  stage = 0;
  hits = 0;
  lastUpdate = 0;
  storedMultiblocks: TGrid[] = [];
  timestamps: number[] = [];

  private readonly vars: Variable[];

  constructor(name = 'Custom') {
    this.name = name;
    this.vars = [
      longVariable('Hits', () => this.hits),
      intVariable('Stage', () => this.stage),
      // Java `(System.nanoTime() - lastUpdate) / 1_000_000` — milliseconds since the
      // last improvement. Java always has a clock; here the caller supplies one so a
      // deterministic test can freeze it.
      longVariable('Last Update Nanos', () => Math.trunc((this.now() - this.lastUpdate) / 1e6)),
      intVariable('Stored Multiblocks', () => this.storedMultiblocks.length),
    ];
  }

  /**
   * Injectable clock (nanoseconds). Defaults to `performance.now()` scaled, falling
   * back to `Date.now()` — deliberately *not* `process.hrtime`, so this module runs
   * unchanged in a Web Worker.
   */
  now: () => number = defaultClock;

  settings(): readonly Setting[] {
    return [
      {
        settingKind: 'string',
        kind: 'string',
        name: 'Name',
        get: () => this.name,
        set: (value) => {
          this.name = String(value);
        },
      },
      ...this.parameters,
    ];
  }

  variables(): readonly Variable[] {
    return this.vars;
  }

  reset(): void {
    this.hits = 0;
    this.lastUpdate = 0;
    this.stage = 0;
    for (const stage of this.stages) stage.reset();
  }

  setIndicies(grid: TGrid): void {
    for (const stage of this.stages) stage.setIndicies(grid);
  }

  /**
   * Java `LiteGenerator.run`. One iteration: mutate the candidate, score it, and
   * maybe advance the stage machine.
   */
  run(
    multiblock: TGrid,
    rand: JavaRandom,
    original: TGrid,
    priorityMultiblock: TGrid,
    callbacks: GeneratorCallbacks<TGrid>,
  ): void {
    // One entry point, one ambient install, restored on the way out — see
    // `withRunRandom`.
    withRunRandom(rand, () => {
      this.runInner(multiblock, original, priorityMultiblock, callbacks);
    });
  }

  private runInner(
    multiblock: TGrid,
    original: TGrid,
    priorityMultiblock: TGrid,
    callbacks: GeneratorCallbacks<TGrid>,
  ): void {
    {
      this.hits++;
      this.timestamps.push(this.now());
      const currentStage = this.stages[this.stage];
      if (currentStage === undefined) {
        throw new Error(`generator has no stage ${this.stage}`);
      }

      currentStage.run(multiblock);
      multiblock.calculate();

      PRIORITY: for (const priority of currentStage.priorities) {
        for (const condition of priority.conditions) {
          condition.hits++;
          if (!condition.check()) continue PRIORITY;
        }
        priority.hits++;
        // Java copies the candidate's *variables* into the scratch grid so the
        // incumbent's numbers stay readable under `multiblock.`.
        priorityMultiblock.copyVarsFrom(multiblock);
        const f = priority.score();
        if (f > 0) {
          callbacks.onUpgrade(multiblock);
          this.lastUpdate = this.now();
          break;
        }
        if (f < 0) break;
      }

      const stageAtEntry = this.stage;
      // Java re-checks this under `synchronized(stageTransitioner)`; single-threaded
      // here, so it is exactly the same test.
      if (stageAtEntry !== this.stage) return;

      TRANSITION: for (const transition of currentStage.stageTransitions) {
        for (const condition of transition.conditions) {
          condition.hits++;
          if (!condition.check()) continue TRANSITION;
        }
        currentStage.runPostProcessing(multiblock);
        transition.hits++;
        this.lastUpdate = this.now();
        if (transition.store.get()) {
          const stored = original.copy();
          stored.copyVarsFrom(original);
          this.storedMultiblocks.push(stored);
          callbacks.onStore(stored);
        }
        if (transition.consolidate.get()) {
          callbacks.onConsolidate();
          while (this.storedMultiblocks.length > 0) {
            const mb = this.storedMultiblocks.shift();
            if (mb === undefined) continue;
            PRIORITY: for (const priority of currentStage.priorities) {
              for (const condition of priority.conditions) {
                condition.hits++;
                if (!condition.check()) continue PRIORITY;
              }
              priority.hits++;
              priorityMultiblock.copyVarsFrom(mb);
              const f = priority.score();
              if (f > 0) {
                callbacks.onUpgrade(mb);
                this.lastUpdate = this.now();
                break;
              }
              if (f < 0) break;
            }
          }
        }
        if (transition.stop.get()) {
          callbacks.onExit();
        } else {
          this.stage = transition.targetStage.get();
          const target = this.stages[this.stage];
          if (target !== undefined) target.hits = 0;
        }
        break;
      }
    }
  }

  /** Java `getStatus()`: `Stage 2 | 18342 Iterations | 91 per second`. */
  getStatus(now: number = this.now()): string {
    while (this.timestamps.length > 0 && (this.timestamps[0] ?? 0) < now - 1e9) {
      this.timestamps.shift();
    }
    return `Stage ${this.stage + 1} | ${this.hits} Iterations | ${this.timestamps.length} per second`;
  }

  // -- serialization -------------------------------------------------------

  toJson(resolver: VariableResolver): JsonObject {
    return {
      name: this.name,
      parameters: this.parameters.map((p) => p.toJson()),
      stages: this.stages.map((s) => s.toJson(resolver)),
    };
  }
}

function defaultClock(): number {
  const perf = (globalThis as { performance?: { now(): number } }).performance;
  if (perf !== undefined && typeof perf.now === 'function') return Math.trunc(perf.now() * 1e6);
  return Date.now() * 1e6;
}

/** Build the registry-resolving `VariableResolver` for one generator. */
export interface GeneratorVariableContext<TGrid extends GeneratorGrid<TGrid>> {
  generator: LiteGenerator<TGrid>;
  /** Best-so-far grid (Java's `multiblock`). */
  original: TGrid;
  /** Scratch grid whose variables are exposed as `multiblock2` (Java's). */
  priorityMultiblock: TGrid;
}

/**
 * `MenuGenerator.getAllVariables` — the explicit variable-path registry that
 * replaces Java's classpath scan (rewrite plan §4.4d).
 */
export function generatorVariables<TGrid extends GeneratorGrid<TGrid>>(
  context: GeneratorVariableContext<TGrid>,
): { path: string; variable: Variable }[] {
  const out: { path: string; variable: Variable }[] = [];
  const { generator, original, priorityMultiblock } = context;

  for (const setting of generator.settings()) {
    out.push({ path: `generator.settings.${setting.name}`, variable: setting });
  }
  for (const variable of original.variables()) {
    out.push({ path: `multiblock.${variable.name}`, variable });
  }
  for (let i = 0; i < 3; i++) {
    out.push({
      path: `multiblock.dims[${i}]`,
      variable: intVariable(`dims[${i}]`, () => original.dimension(i)),
    });
  }
  for (const variable of priorityMultiblock.variables()) {
    out.push({ path: `multiblock2.${variable.name}`, variable });
  }
  for (let i = 0; i < 3; i++) {
    out.push({
      path: `multiblock2.dims[${i}]`,
      variable: intVariable(`dims[${i}]`, () => priorityMultiblock.dimension(i)),
    });
  }
  for (const variable of generator.variables()) {
    out.push({ path: `generator.${variable.name}`, variable });
  }
  generator.stages.forEach((stage, stageIdx) => {
    const stagePrefix = `generator.stages[${stageIdx}]{Stage ${stageIdx + 1}}`;
    for (const variable of stage.variables()) {
      out.push({ path: `${stagePrefix}.${variable.name}`, variable });
    }
    stage.steps.forEach((step, stepIdx) => {
      const stepPrefix = `${stagePrefix}.steps[${stepIdx}]{Step ${stepIdx + 1} (${step.title})}`;
      out.push({ path: `${stepPrefix}.Hits`, variable: stepHitsVariable(step) });
      step.conditions.forEach((condition, i) => {
        condition.collectVariables(
          `${stepPrefix}.conditions[${i}]{Condition ${i + 1} (${condition.title})}`,
          out,
        );
      });
    });
    stage.stageTransitions.forEach((transition, transitionIdx) => {
      // Java uses `transitionIdx + 1` for **both** the index and the label.
      const transitionPrefix = `${stagePrefix}.transitions[${transitionIdx + 1}]{Transition ${transitionIdx + 1}}`;
      for (const variable of transition.variables()) {
        out.push({ path: `${transitionPrefix}.${variable.name}`, variable });
      }
      transition.collectConditionVariables(transitionPrefix, out);
    });
  });
  return out;
}

function stepHitsVariable(step: GeneratorMutator<never>): Variable {
  return longVariable('Hits', () => step.hits);
}

/** `new VariableResolver(...)` over {@link generatorVariables}. */
export function generatorResolver<TGrid extends GeneratorGrid<TGrid>>(
  context: GeneratorVariableContext<TGrid>,
): VariableResolver {
  const entries = generatorVariables(context);
  const byPath = new Map(entries.map((e) => [e.path, e.variable]));
  return {
    all: () => entries,
    get: (path) => byPath.get(path),
  };
}

// ---------------------------------------------------------------------------
// deserialization
// ---------------------------------------------------------------------------

/** Java `Priority.convertFromObject`. */
export function priorityFromJson(
  json: JsonObject,
  resolver: VariableResolver,
  sink?: DeferredSink,
): Priority {
  const priority = new Priority();
  priority.conditions = conditionsFromJson(json.conditions, resolver, sink);
  priority.operator = SettingVariableImpl.fromJson(objectOf(json.operator), resolver, sink);
  return priority;
}

/** Java `StageTransition.convertFromObject`. */
export function stageTransitionFromJson(
  json: JsonObject,
  sink?: DeferredSink,
): StageTransition {
  const transition = new StageTransition();
  transition.conditions = conditionsFromJson(json.conditions, { all: () => [] }, sink);
  transition.targetStage.set(numberOf(json.target_stage));
  transition.store.set(booleanOf(json.store));
  transition.consolidate.set(booleanOf(json.consolidate));
  transition.stop.set(booleanOf(json.stop));
  return transition;
}

/** Java `LiteGenerator.convertFromObject`. */
export function generatorFromJson<TGrid extends GeneratorGrid<TGrid>>(
  json: JsonObject,
  resolver: VariableResolver,
  sink?: DeferredSink,
): Omit<LiteGenerator<TGrid>, 'run'> {
  const generator = new LiteGenerator<TGrid>(stringOf(json.name, 'Custom'));
  generator.parameters = arrayOf(json.parameters)
    .filter((v): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v))
    .map((v) => parameterFromJson(v));
  generator.stages = arrayOf(json.stages)
    .filter((v): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v))
    .map((stageJson) => {
      const stage = new GeneratorStage<TGrid>();
      stage.priorities = arrayOf(stageJson.priorities)
        .filter((v): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v))
        .map((v) => priorityFromJson(v, resolver, sink));
      stage.stageTransitions = arrayOf(stageJson.stage_transitions)
        .filter((v): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v))
        .map((v) => stageTransitionFromJson(v, sink));
      stage.steps = generatorMutatorsFromJson(
        stageJson.steps,
        resolver,
        sink,
      ) as GeneratorMutator<TGrid>[];
      stage.postProcessing = generatorMutatorsFromJson(
        stageJson.post_processing,
        resolver,
        sink,
      ) as GeneratorMutator<TGrid>[];
      return stage;
    });
  return generator;
}

export type { Parameter };
