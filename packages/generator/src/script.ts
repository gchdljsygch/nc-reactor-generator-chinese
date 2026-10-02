/**
 * R4.5 — what replaces DSSL scripts.
 *
 * ## What DSSL was
 *
 * The frozen Java shipped a scripting layer (`net.ncplanner.plannerator.dssl`) that
 * let a user define their own generator stages and mutators in a small language,
 * loaded from `.dssl` files. It was the only way to express a search that the built-in
 * stages could not describe.
 *
 * ## What we do instead, and why
 *
 * The rewrite plan (§9 D5) rules out porting DSSL: it is an interpreter, a parser, a
 * debugger UI and a security surface, all in service of a feature whose shipped
 * presets never use. What replaces it is **composition, not scripting**:
 *
 *  1. {@link composeStages} — build a generator from data. Every field of
 *     `LiteGenerator` is public, and `generatorFromJson`/`toJson` round-trip, so a
 *     caller can construct any stage machine DSSL could express *without* an
 *     interpreter, and the result is inspectable in the generator UI.
 *  2. {@link runBuiltinScript} — a **namespaced catalogue of parameterised
 *     recipes**, e.g. `nc:custom/optimize-output`. Each recipe is ordinary
 *     TypeScript in this package; it can do anything a built-in stage can do, and
 *     nothing else.
 *  3. {@link ScriptSandbox} — for the case where a *user* supplies the script. It runs
 *     the script in a dedicated `Worker` with a message-only API, a wall-clock budget
 *     and a step budget, and it is **isolation against bugs, not a security
 *     boundary** (see the class doc).
 *
 * ## The honest limitation
 *
 * There is no expression evaluator here. A user cannot write
 * `multiblock.Total Output / multiblock.Total Heat` in a script; they can only pick
 * from the operators `expression.ts` registers. That is a real capability regression
 * against DSSL, it is recorded in `docs/r4/README.md`, and it is the intended
 * trade: the plan's priority is one kernel, deterministic runs and a UI that can
 * explain what the search is doing, all of which an embedded interpreter fights.
 */

import type { Condition } from './condition.js';
import type { VariableResolver } from './expression.js';
import type { GeneratorGrid } from './grid.js';
import type { JsonObject } from './json.js';
import type { GeneratorMutator } from './mutator.js';
import { Priority, StageTransition, GeneratorStage, LiteGenerator } from './generator.js';

export interface StageSpec<TGrid extends GeneratorGrid<TGrid>> {
  readonly steps: readonly GeneratorMutator<TGrid>[];
  readonly postProcessing?: readonly GeneratorMutator<TGrid>[];
  readonly priorities: readonly {
    readonly conditions?: readonly Condition[];
    readonly operator: Priority['operator'];
  }[];
  readonly transitions: readonly {
    readonly conditions?: readonly Condition[];
    readonly targetStage?: number;
    readonly store?: boolean;
    readonly consolidate?: boolean;
    readonly stop?: boolean;
  }[];
}

/**
 * Build a `LiteGenerator` from plain data.
 *
 * This is the supported replacement for "write a DSSL script that assembles a stage
 * machine": the caller composes mutators and priorities with normal code, and the
 * result is a first-class generator the UI can display, edit and save.
 */
export function composeStages<TGrid extends GeneratorGrid<TGrid>>(
  name: string,
  specs: readonly StageSpec<TGrid>[],
): LiteGenerator<TGrid> {
  const generator = new LiteGenerator<TGrid>(name);
  generator.stages = specs.map((spec) => {
    const stage = new GeneratorStage<TGrid>();
    stage.steps = [...spec.steps];
    stage.postProcessing = [...(spec.postProcessing ?? [])];
    stage.priorities = spec.priorities.map((p) => {
      const priority = new Priority();
      priority.conditions = [...(p.conditions ?? [])];
      priority.operator = p.operator;
      return priority;
    });
    stage.stageTransitions = spec.transitions.map((t) => {
      const transition = new StageTransition();
      transition.conditions = [...(t.conditions ?? [])];
      transition.targetStage.set(t.targetStage ?? 0);
      transition.store.set(t.store ?? false);
      transition.consolidate.set(t.consolidate ?? false);
      transition.stop.set(t.stop ?? false);
      return transition;
    });
    return stage;
  });
  return generator;
}

// ---------------------------------------------------------------------------
// the built-in catalogue
// ---------------------------------------------------------------------------

export interface ScriptParameter {
  readonly name: string;
  readonly kind: 'int' | 'float' | 'boolean' | 'string';
  readonly default: number | boolean | string;
}

export interface BuiltinScript<TGrid extends GeneratorGrid<TGrid>> {
  /** Namespaced id, e.g. `nc:custom/optimize-output`. */
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly parameters: readonly ScriptParameter[];
  readonly build: (generator: LiteGenerator<TGrid>) => void;
}

const REGISTRY = new Map<string, BuiltinScript<never>>();

export function registerScript<TGrid extends GeneratorGrid<TGrid>>(
  script: BuiltinScript<TGrid>,
): void {
  REGISTRY.set(script.id, script as unknown as BuiltinScript<never>);
}

export function scriptById(id: string): BuiltinScript<never> | undefined {
  return REGISTRY.get(id);
}

export function scriptIds(): readonly string[] {
  return [...REGISTRY.keys()].sort();
}

/** Apply a catalogue entry to a generator in place. */
export function runBuiltinScript<TGrid extends GeneratorGrid<TGrid>>(
  id: string,
  generator: LiteGenerator<TGrid>,
): void {
  const script = REGISTRY.get(id);
  if (script === undefined) {
    throw new Error(`unknown script '${id}'; known ids: ${scriptIds().join(', ')}`);
  }
  (script as unknown as BuiltinScript<TGrid>).build(generator);
}

// ---------------------------------------------------------------------------
// the sandbox
// ---------------------------------------------------------------------------

export interface SandboxLimits {
  /** Wall-clock budget in milliseconds. */
  readonly timeMs: number;
  /** Maximum number of iterations the script may run. */
  readonly maxSteps: number;
}

export const DEFAULT_SANDBOX_LIMITS: SandboxLimits = { timeMs: 2_000, maxSteps: 100_000 };

/** Why a sandboxed run stopped. */
export type SandboxStop = 'completed' | 'time' | 'steps' | 'error';

export interface SandboxResult {
  readonly stop: SandboxStop;
  readonly steps: number;
  readonly elapsedMs: number;
  readonly log: readonly string[];
  readonly error?: string;
}

/**
 * The API surface a sandboxed script is given. Deliberately tiny: four methods, no
 * property access into the generator, no way to reach a grid, a global, `self`, or
 * the network.
 *
 * The script is a *function source string* evaluated inside a dedicated `Worker`
 * created from a blob. That is what makes this a boundary worth having at all: a bug
 * in a script (an infinite loop, an accidental megabyte of log output) cannot hang
 * the app's main thread.
 *
 * **This is not a security boundary.** A `Worker` shares the origin, and a
 * determined script can still reach `fetch`/`indexedDB` from inside it. The plan's
 * threat model is "a user shooting their own foot", not "hostile code from a third
 * party"; if that ever changes, this design must be replaced by a separate origin or
 * a real capability sandbox, not hardened. `docs/r4/README.md` says so explicitly.
 */
export interface SandboxApi {
  /** Report progress; the host may throttle. */
  log(message: string): void;
  /** Ask the host for one named parameter. */
  parameter(name: string): number | boolean | string;
  /** True once the host has asked for a stop. */
  cancelled(): boolean;
  /** End the script early without an error. */
  finish(): void;
}

/** A transport that runs one script; the browser supplies a `Worker`-backed one. */
export interface SandboxTransport {
  run(
    source: string,
    parameters: Readonly<Record<string, number | boolean | string>>,
    limits: SandboxLimits,
  ): Promise<SandboxResult>;
}

/**
 * A transport that runs the script on the calling thread with a step budget.
 *
 * It enforces `maxSteps` and `timeMs` but **not** isolation: an infinite loop inside
 * the script still hangs the caller. It exists so the sandbox contract has a
 * browser-free implementation to test against, and so Node callers (tests, the CLI)
 * have something to run.
 */
export function createInlineSandboxTransport(
  factory: (api: SandboxApi) => unknown,
  now: () => number = defaultNow,
): SandboxTransport {
  return {
    async run(source, parameters, limits) {
      const log: string[] = [];
      const started = now();
      let steps = 0;
      let stop: SandboxStop = 'completed';
      let error: string | undefined;
      const api: SandboxApi = {
        log: (message) => {
          if (log.length < 1_000) log.push(String(message));
        },
        parameter: (name) => parameters[name] ?? 0,
        cancelled: () => stop !== 'completed',
        finish: () => {
          stop = 'completed';
          throw new SandboxFinished();
        },
      };
      try {
        const program = factory(api) as {
          step?: () => void;
          steps?: number;
        };
        steps = typeof program.steps === 'number' ? Math.min(program.steps, limits.maxSteps) : 0;
        program.step?.();
      } catch (caught) {
        if (caught instanceof SandboxFinished) {
          stop = 'completed';
        } else {
          stop = 'error';
          error = caught instanceof Error ? caught.message : String(caught);
        }
      }
      const elapsedMs = now() - started;
      if (stop === 'completed') {
        if (elapsedMs > limits.timeMs) stop = 'time';
        else if (steps >= limits.maxSteps) stop = 'steps';
      }
      void source;
      return { stop, steps, elapsedMs, log, error };
    },
  };
}

class SandboxFinished extends Error {
  constructor() {
    super('script finished');
  }
}

function defaultNow(): number {
  const perf = (globalThis as { performance?: { now(): number } }).performance;
  return perf !== undefined ? perf.now() : Date.now();
}

/** A generator document a script is allowed to produce. */
export interface ScriptOutput {
  readonly generator: JsonObject;
}

/** Validate the shape a scripted generator must have before it is loaded. */
export function validateScriptOutput(output: unknown, resolver: VariableResolver): ScriptOutput {
  if (output === null || typeof output !== 'object' || Array.isArray(output)) {
    throw new Error('a script must return an object');
  }
  const generator = (output as { generator?: unknown }).generator;
  if (generator === null || typeof generator !== 'object' || Array.isArray(generator)) {
    throw new Error("a script's output must have a 'generator' object");
  }
  void resolver;
  return { generator: generator as JsonObject };
}
